// Injected on search engine results pages.
// Detects the query, classifies it, and renders the Truey card.

(async () => {

// ── Query extraction ──────────────────────────────────────────────────────────

const EXTRACTORS = {
  'www.google.com':     () => new URLSearchParams(location.search).get('q'),
  'www.bing.com':       () => new URLSearchParams(location.search).get('q'),
  'duckduckgo.com':     () => new URLSearchParams(location.search).get('q'),
  'search.brave.com':   () => new URLSearchParams(location.search).get('q'),
  'www.ecosia.org':     () => new URLSearchParams(location.search).get('q'),
  'www.startpage.com':  () => new URLSearchParams(location.search).get('q'),
  'search.yahoo.com':   () => new URLSearchParams(location.search).get('p'),
};

function getQuery() {
  const extractor = EXTRACTORS[location.hostname];
  return extractor ? extractor()?.trim() : null;
}

// ── Insertion point ───────────────────────────────────────────────────────────

function findInsertionPoint() {
  const selectors = [
    '#rso',                      // Google — organic results section
    '#search',                   // Google — broader column fallback
    'ol#b_results',              // Bing
    '#b_results',                // Bing fallback
    'ol.react-results--main',    // DuckDuckGo (new)
    '#links',                    // DuckDuckGo (old)
    '[data-key="web"]',          // Brave Search
    '.mainline-results',         // Ecosia
    '#main-results',             // Ecosia / Startpage fallback
    '#web',                      // Yahoo
    '.results',                  // generic fallback
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) return el;
  }
  return null;
}

// ── Card DOM ──────────────────────────────────────────────────────────────────

let card = null;
let currentState = null;

function ensureCard() {
  if (card) return card;
  const anchor = findInsertionPoint();
  if (!anchor) return null;

  card = document.createElement(anchor.tagName === 'OL' ? 'li' : 'div');
  card.id = 'truey-card';
  card.innerHTML = cardHTML();
  anchor.insertBefore(card, anchor.firstChild);
  bindCardEvents();

  // After layout is calculated, nudge left-edge to match sibling results
  requestAnimationFrame(() => alignCard(anchor));
  return card;
}

function alignCard(anchor) {
  // Mirror the sibling <li>'s computed spacing so our card sits flush with results.
  // Copying computed styles is more reliable than pixel math, which fires before
  // DuckDuckGo's React layout has settled.
  const sibling = [...anchor.children].find(el => el !== card);
  if (!sibling) return;

  const s = window.getComputedStyle(sibling);
  card.style.paddingLeft  = s.paddingLeft;
  card.style.paddingRight = s.paddingRight;
  card.style.marginLeft   = s.marginLeft;
  card.style.marginRight  = s.marginRight;
  card.style.boxSizing    = 'border-box';
}

function cardHTML() {
  return `
<div class="tcard">
  <div class="tcard-header">
    <div class="tcard-header-left">
      <div class="tcard-dot"></div>
      <span class="tcard-label">Truey</span>
      <span class="tcard-topic"></span>
    </div>
    <div class="tcard-header-right">
      <span class="tcard-provider-badge"></span>
      <button class="tcard-btn-icon tcard-refresh" title="Refresh" style="display:none">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
      </button>
      <button class="tcard-btn-icon tcard-collapse" title="Collapse">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="18 15 12 9 6 15"/></svg>
      </button>
    </div>
  </div>
  <div class="tcard-body"></div>
</div>`;
}

function bindCardEvents() {
  card.querySelector('.tcard-collapse').addEventListener('click', toggleCollapse);
  card.querySelector('.tcard-refresh').addEventListener('click', () => runPipeline(lastQuery));
}

let collapsed  = false;
let lastQuery  = null;
let lastPapers = null;

function toggleCollapse() {
  collapsed = !collapsed;
  const body = card.querySelector('.tcard-body');
  const icon = card.querySelector('.tcard-collapse svg polyline');
  body.style.display = collapsed ? 'none' : '';
  icon.setAttribute('points', collapsed ? '6 9 12 15 18 9' : '18 15 12 9 6 15');
}

// ── State renderers ───────────────────────────────────────────────────────────

function setState(state, data = {}) {
  currentState = state;
  const body    = card.querySelector('.tcard-body');
  const topic   = card.querySelector('.tcard-topic');
  const badge   = card.querySelector('.tcard-provider-badge');
  const refresh = card.querySelector('.tcard-refresh');

  refresh.style.display = ['loaded', 'limited', 'error'].includes(state) ? '' : 'none';

  if (data.topic)    topic.textContent  = `· ${data.topic}`;
  if (data.provider) badge.textContent  = data.provider;

  switch (state) {
    case 'loading':
      body.innerHTML = `
        <div class="tcard-loading">
          <div class="tcard-skeleton line-full"></div>
          <div class="tcard-skeleton line-80"></div>
          <div class="tcard-skeleton line-full"></div>
          <div class="tcard-skeleton line-60"></div>
        </div>`;
      break;

    case 'streaming':
      body.innerHTML = `<div class="tcard-summary tcard-streaming">${renderSummary(data.fullText || '')}</div>`;
      break;

    case 'loaded':
      body.innerHTML = renderLoaded(data);
      body.querySelector('.tcard-view-all')?.addEventListener('click', () => {
        const btn       = body.querySelector('.tcard-view-all');
        const allPapers = data.papers || [];
        const max       = settings?.maxCitations ?? 3;
        const expanded  = btn.dataset.expanded === 'true';
        const toShow    = expanded ? allPapers.slice(0, max) : allPapers;

        body.querySelectorAll('.tcard-citation').forEach(el => el.remove());
        body.querySelector('.tcard-footer')
            ?.insertAdjacentHTML('beforebegin', toShow.map((p, i) => citationHTML(p, i)).join(''));

        btn.textContent    = expanded ? `View all ${allPapers.length} studies →` : 'Show fewer ↑';
        btn.dataset.expanded = String(!expanded);
      });
      break;

    case 'limited': {
      lastPapers = data.papers;
      body.innerHTML = `
        <div class="tcard-limited-banner">
          <div class="tcard-limited-text">
            <div class="tcard-limited-title">Only ${data.papers.length} ${data.papers.length === 1 ? 'study' : 'studies'} matched your filters</div>
            <div class="tcard-limited-desc">Your active filters are restricting results. Expand the search to find more studies, or summarise using what was found.</div>
            <div class="tcard-limited-actions">
              <button class="tcard-btn-relax">Expand search</button>
              <button class="tcard-btn-keep">Summarise with ${data.papers.length} ${data.papers.length === 1 ? 'study' : 'studies'}</button>
            </div>
          </div>
        </div>`;

      body.querySelector('.tcard-btn-relax').addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: 'RESUME_PIPELINE', query: lastQuery, papers: lastPapers, relax: true });
        setState('loading', { topic: card.querySelector('.tcard-topic').textContent.replace('· ', '') });
      });
      body.querySelector('.tcard-btn-keep').addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: 'RESUME_PIPELINE', query: lastQuery, papers: lastPapers, relax: false });
        setState('loading', { topic: card.querySelector('.tcard-topic').textContent.replace('· ', '') });
      });
      break;
    }

    case 'no-sources':
      body.innerHTML = `
        <div class="tcard-empty">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/><line x1="9" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="9" y2="15"/></svg>
          <div class="tcard-empty-title">No studies found</div>
          <div class="tcard-empty-hint">No papers matched this query across all configured databases. Try different wording or check your filter settings.</div>
          <div class="tcard-limited-actions">
            <button class="tcard-btn-relax tcard-btn-retry">Remove filters &amp; retry</button>
          </div>
        </div>`;
      body.querySelector('.tcard-btn-retry').addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: 'RESUME_PIPELINE', query: lastQuery, papers: [], relax: true });
        setState('loading');
      });
      break;

    case 'error':
      body.innerHTML = `<div class="tcard-error">Something went wrong: ${escHtml(data.error || 'Unknown error')}. <button class="tcard-link tcard-retry-err">Retry</button></div>`;
      body.querySelector('.tcard-retry-err').addEventListener('click', () => runPipeline(lastQuery));
      break;
  }
}

function renderLoaded({ summary, confidence, papers, topic }) {
  const confClass = confidence?.toLowerCase() === 'high' ? 'conf-high'
                  : confidence?.toLowerCase() === 'low'  ? 'conf-low'
                  : 'conf-mid';
  const confPct   = confidence?.toLowerCase() === 'high' ? '78%'
                  : confidence?.toLowerCase() === 'low'  ? '18%' : '42%';

  const max     = settings?.maxCitations ?? 3;
  const visible = (papers || []).slice(0, max);
  const hidden  = (papers || []).length - visible.length;
  const sources = [...new Set((papers || []).map(p => p.source))].join(' · ');

  return `
    <p class="tcard-summary">${renderSummary(summary || '')}</p>
    <div class="tcard-confidence">
      <span class="tcard-conf-label">Evidence confidence</span>
      <div class="tcard-conf-bar-wrap"><div class="tcard-conf-bar ${confClass}" style="width:${confPct}"></div></div>
      <span class="tcard-conf-value ${confClass}">${confidence || '—'}</span>
    </div>
    <div class="tcard-citations-label">Sources</div>
    ${visible.map((p, i) => citationHTML(p, i)).join('')}
    <div class="tcard-footer">
      <span class="tcard-footer-note">${escHtml(sources)} · Not medical advice</span>
      ${hidden > 0 ? `<button class="tcard-link tcard-view-all">View all ${papers.length} studies →</button>` : ''}
    </div>`;
}

function renderSummary(text) {
  return escHtml(text).replace(/&lt;mark&gt;(.*?)&lt;\/mark&gt;/gs, '<mark>$1</mark>');
}

function citationHTML(p, i) {
  return `
    <a class="tcard-citation" href="${escHtml(p.url)}" target="_blank" rel="noopener">
      <div class="tcard-cite-num">${i + 1}</div>
      <div class="tcard-cite-content">
        <div class="tcard-cite-title">${escHtml(p.title)}</div>
        <div class="tcard-cite-meta">
          <span class="tcard-source-badge">${escHtml(p.source)}</span>
          ${escHtml([p.authors, p.journal, p.year].filter(Boolean).join(' · '))}
        </div>
      </div>
    </a>`;
}

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Pipeline trigger ──────────────────────────────────────────────────────────

async function runPipeline(query) {
  lastQuery = query;
  ensureCard();
  setState('loading', { topic: query });
  collapsed = false;
  card.querySelector('.tcard-body').style.display = '';

  chrome.runtime.sendMessage({ type: 'RUN_PIPELINE', query, tabId: null });
}

// ── Message listener (pipeline updates) ──────────────────────────────────────

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg._truey) return;

  switch (msg.type) {
    case 'PIPELINE_STATUS':
      if (msg.status === 'fetching')    setState('loading');
      if (msg.status === 'limited')     setState('limited',    { papers: msg.papers });
      if (msg.status === 'no-sources')  setState('no-sources');
      if (msg.status === 'error')       setState('error',      { error: msg.error });
      if (msg.status === 'summarising') lastPapers = msg.papers;
      break;

    case 'PIPELINE_STREAM':
      setState('streaming', { fullText: msg.fullText });
      break;

    case 'PIPELINE_DONE':
      setState('loaded', {
        summary:    msg.summary,
        confidence: msg.confidence,
        papers:     msg.papers,
        topic:      msg.topic,
      });
      break;
  }
});

// ── Boot ──────────────────────────────────────────────────────────────────────

const query = getQuery();
if (!query) return;

let res, settings;
try {
  res      = await chrome.runtime.sendMessage({ type: 'CLASSIFY_QUERY', query });
  settings = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
} catch (_) {
  return;
}
if (!res?.relevant) return;

// Search results are rendered dynamically — wait up to 10 s for the container.
await new Promise(resolve => {
  if (findInsertionPoint()) { resolve(); return; }
  const obs = new MutationObserver(() => {
    if (findInsertionPoint()) { obs.disconnect(); resolve(); }
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(() => { obs.disconnect(); resolve(); }, 10_000);
});

card = ensureCard();
if (!card) return;

// Set provider badge
const providerLabel = {
  ollama:   'Ollama',
  llamacpp: 'llama.cpp',
  grok:     'Grok',
  openai:   'OpenAI',
  claude:   'Claude',
  custom:   'Custom',
}[settings.provider] ?? settings.provider;
card.querySelector('.tcard-provider-badge').textContent = `${providerLabel} · ${settings.model}`;

runPipeline(query);

// Handle navigation (SPA search engines update the URL without full reload)
let lastUrl = location.href;
new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    const newQuery = getQuery();
    if (newQuery && newQuery !== lastQuery) runPipeline(newQuery);
  }
}).observe(document.body, { childList: true, subtree: true });

})();
