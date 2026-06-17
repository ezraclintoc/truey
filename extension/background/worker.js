import ext                          from '../lib/compat.js';
import { getSettings, addHistory }  from '../lib/storage.js';
import { isScientific }             from '../lib/classifier.js';
import { fetchPapers }              from '../lib/sources.js';
import { chat }                     from '../lib/providers.js';

// ── Context menu ──────────────────────────────────────────────────────────────

ext.runtime.onInstalled.addListener(() => {
  ext.contextMenus.create({
    id:       'truey-verify',
    title:    'Verify with Truey',
    contexts: ['selection'],
  });
});

ext.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'truey-verify') return;
  ext.tabs.sendMessage(tab.id, {
    type:      'TRUEY_VERIFY_SELECTION',
    selection: info.selectionText,
  });
});

// ── Message router ────────────────────────────────────────────────────────────

ext.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {
    case 'CLASSIFY_QUERY':
      handleClassify(msg, sendResponse);
      return true;

    case 'RUN_PIPELINE':
      handlePipeline(msg, sender);
      return false;

    case 'GET_SETTINGS':
      getSettings().then(sendResponse);
      return true;

    case 'TEST_CONNECTION':
      handleTestConnection(msg, sendResponse);
      return true;
  }
});

// ── Handlers ──────────────────────────────────────────────────────────────────

async function handleClassify({ query }, sendResponse) {
  const settings = await getSettings();
  if (!settings.enabled || !settings.autoDetectSearch) {
    sendResponse({ relevant: false });
    return;
  }
  const relevant = await isScientific(query, settings);
  sendResponse({ relevant });
}

async function handleTestConnection({ provider, endpointUrl, apiKey, model }, sendResponse) {
  const { testConnection } = await import('../lib/providers.js');
  const result = await testConnection({ provider, endpointUrl, apiKey, model });
  sendResponse(result);
}

/**
 * Full pipeline: fetch papers → stream AI summary → push updates to content script.
 * All progress is sent as messages back to the originating tab.
 */
async function handlePipeline({ query, selectedText, tabId: explicitTabId }, sender) {
  const tabId    = explicitTabId ?? sender.tab?.id;
  const settings = await getSettings();

  const dev = (...args) => { if (settings.devMode) console.log('[Truey dev]', ...args); };
  dev('Pipeline start — query:', query || selectedText);
  dev('Provider:', settings.provider, '| Model:', settings.model, '| Endpoint:', settings.endpointUrl);

  function send(msg) {
    ext.tabs.sendMessage(tabId, { ...msg, _truey: true });
  }

  try {
    // 1. Fetch papers
    send({ type: 'PIPELINE_STATUS', status: 'fetching' });
    const { papers, limitedData } = await fetchPapers(query || selectedText, settings);
    dev('Papers returned to pipeline:', papers.length, limitedData ? '(limited)' : '');

    if (papers.length === 0) {
      send({ type: 'PIPELINE_STATUS', status: 'no-sources' });
      return;
    }

    if (limitedData && settings.limitedDataAction === 'ask') {
      send({ type: 'PIPELINE_STATUS', status: 'limited', papers });
      return; // content script will ask user and reply with RESUME_PIPELINE
    }

    if (limitedData && settings.limitedDataAction === 'expand') {
      // Re-fetch with all filters relaxed, then proceed with whatever we find
      const relaxed = { ...settings, minCitations: 0, dateRangeYears: 0, studyTypes: [] };
      const result  = await fetchPapers(query || selectedText, relaxed);
      papers = result.papers;
      if (!papers.length) { send({ type: 'PIPELINE_STATUS', status: 'no-sources' }); return; }
    }

    await runSummary({ query, selectedText, papers, settings, tabId, send });

  } catch (err) {
    send({ type: 'PIPELINE_STATUS', status: 'error', error: err.message });
  }
}

// Called directly when user clicks "Expand search" or "Summarize anyway"
ext.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type !== 'RESUME_PIPELINE') return;
  resumePipeline(msg, sender);
});

async function resumePipeline({ query, selectedText, papers, relax }, sender) {
  const settings = await getSettings();
  const tabId    = sender.tab?.id;

  function send(payload) {
    ext.tabs.sendMessage(tabId, { ...payload, _truey: true });
  }

  if (relax) {
    // Re-fetch with filters disabled
    send({ type: 'PIPELINE_STATUS', status: 'fetching' });
    const relaxed = { ...settings, minCitations: 0, dateRangeYears: 0, studyTypes: [] };
    const result  = await fetchPapers(query || selectedText, relaxed).catch(() => ({ papers: [] }));
    papers = result.papers;
    if (!papers.length) { send({ type: 'PIPELINE_STATUS', status: 'no-sources' }); return; }
  }

  await runSummary({ query, selectedText, papers, settings, tabId, send });
}

async function runSummary({ query, selectedText, papers, settings, tabId, send }) {
  send({ type: 'PIPELINE_STATUS', status: 'summarising', papers });

  const topic    = query || selectedText;
  const abstracts = papers
    .map((p, i) => `[${i + 1}] "${p.title}" — ${p.authors} (${p.year})\n${p.abstract}`)
    .join('\n\n');

  const sciLevel = buildSciLevelInstruction(settings);

  const systemPrompt = `You are Truey, a science summariser. Your job is to summarise peer-reviewed research accurately and concisely.
${sciLevel}
Rules:
- Only use information from the provided abstracts. Do not add outside knowledge. If no abstract directly addresses the question, say so explicitly — never invent findings.
- Ignore any paper whose abstract is not relevant to the user's question — skip it entirely and do not cite it.
- Write in plain language that a non-scientist can understand.
- Write your summary paragraph first. Then pick exactly ONE phrase already in that paragraph — the single clearest answer to the user's question — and wrap it with <mark> tags. Do NOT add new sentences. The marked phrase must: (1) be self-contained and understandable without surrounding context, (2) state a clear direction using plain words (e.g. "X increases Y" or "X had no effect on Y"), (3) come directly from study findings, never from your own inferences, and (4) be specific — include a concrete detail such as the type of intervention, the population, a dose, or a magnitude rather than a vague generic statement like "X improves Y". NEVER mark your own concluding or summary sentence (e.g. a final "Exercise benefits memory"-style wrap-up) — mark a sentence that reports one specific study's actual result instead.
- End with a one-word evidence confidence: Low, Moderate, or High.
- Format: one paragraph summary, then on a new line: "Confidence: <level>"`;

  const userPrompt = selectedText
    ? `The user selected this text from an article:\n"${selectedText}"\n\nVerify it using these studies:\n\n${abstracts}`
    : `Summarise the research on: "${topic}"\n\nStudies:\n\n${abstracts}`;

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user',   content: userPrompt   },
  ];

  const dev2 = (...args) => { if (settings.devMode) console.log('[Truey dev]', ...args); };
  dev2('Calling AI — provider:', settings.provider, '| model:', settings.model);
  dev2('System prompt preview:', systemPrompt.slice(0, 200) + '…');
  dev2('User prompt preview:',   userPrompt.slice(0, 200)   + '…');

  let fullText = '';
  for await (const token of chat(messages, settings)) {
    fullText += token;
    send({ type: 'PIPELINE_STREAM', token, fullText });
  }

  // Parse confidence from end of response
  const confMatch  = fullText.match(/confidence:\s*(low|moderate|high)/i);
  const confidence = confMatch ? confMatch[1] : 'Unknown';
  const summary    = fullText.replace(/\nconfidence:.*$/i, '').trim();

  send({ type: 'PIPELINE_DONE', summary, confidence, papers, topic });

  // Persist to history
  await addHistory({
    topic,
    confidence,
    studyCount: papers.length,
    sources:    [...new Set(papers.map(p => p.source))],
  });
}

function buildSciLevelInstruction(settings) {
  if (settings.vocabMode === 'advanced') {
    const bands = settings.eqBands ?? {};
    const lines = Object.entries(bands)
      .map(([domain, level]) => `- ${domain}: ${['plain English', 'undergraduate', 'graduate', 'expert'][level - 1] ?? 'undergraduate'}`)
      .join('\n');
    return `Vocabulary level by domain:\n${lines}`;
  }

  const levels = ['plain English (no jargon)', 'undergraduate level', 'graduate level', 'expert/researcher level'];
  return `Use ${levels[(settings.scienceness ?? 2) - 1]} vocabulary throughout.`;
}
