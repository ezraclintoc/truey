// Quality evaluation test for Truey.
// Runs a set of diverse queries and prints full summaries + highlights for manual scoring.
// Run: DISPLAY=:99 CHROMIUM_PATH=... GROQ_API_KEY=... node test-quality.js

const { chromium } = require('playwright');
const path = require('path');
const os   = require('os');
const fs   = require('fs');

const EXT_PATH  = path.resolve(__dirname, 'extension');
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'truey-quality-'));
const GROQ_KEY  = process.env.GROQ_API_KEY || '';
const GROQ_URL  = 'https://api.groq.com/openai';
const MODEL     = 'llama-3.3-70b-versatile';

const QUERIES = [
  { q: 'does creatine cause hair loss',                  category: 'health/fitness' },
  { q: 'does coffee increase blood pressure',            category: 'nutrition/cardiology' },
  { q: 'does social media cause depression in teenagers',category: 'psychology' },
  { q: 'does exercise improve memory',                   category: 'neuroscience' },
  { q: 'does vitamin C prevent colds',                   category: 'immunology' },
  { q: 'is breakfast the most important meal of the day',category: 'nutrition (contested)' },
  { q: 'does alcohol in moderation benefit heart health', category: 'cardiology (controversial)' },
];

async function runQuery(context, extId, query) {
  const page = await context.newPage();
  const result = { query, summary: null, marks: [], papers: 0, error: null, paperTitles: [] };

  // Capture SW logs for this query
  const swLogs = [];
  const sw = context.serviceWorkers().find(w => w.url().includes('/background/worker.js'));
  const logHandler = msg => swLogs.push(msg.text());
  if (sw) sw.on('console', logHandler);

  try {
    const encoded = encodeURIComponent(query);
    await page.goto(`https://duckduckgo.com/?q=${encoded}`, { waitUntil: 'domcontentloaded', timeout: 25000 });

    const card = await page.waitForSelector('#truey-card', { timeout: 14000 }).catch(() => null);
    if (!card) { result.error = 'Card never appeared'; return result; }

    // Wait up to 90s for terminal state
    let done = false;
    for (let i = 0; i < 45 && !done; i++) {
      await page.waitForTimeout(2000);
      const bodyHTML = await page.$eval('.tcard-body', el => el.innerHTML).catch(() => '');
      done = bodyHTML.includes('tcard-summary') && !bodyHTML.includes('tcard-streaming') ||
             bodyHTML.includes('tcard-error') || bodyHTML.includes('tcard-empty') ||
             bodyHTML.includes('tcard-limited');
    }

    const summaryEl = await page.$('.tcard-summary');
    if (!summaryEl) {
      const bodyHTML = await page.$eval('.tcard-body', el => el.innerHTML).catch(() => '');
      result.error = bodyHTML.includes('tcard-empty')   ? 'No papers found'
                   : bodyHTML.includes('tcard-limited') ? 'Limited data (no sources passed relevance filter)'
                   : bodyHTML.includes('tcard-error')   ? 'Pipeline error' : 'Summary never loaded';
      return result;
    }

    result.summary = await summaryEl.evaluate(el => el.textContent?.trim() ?? '');
    const html     = await summaryEl.evaluate(el => el.innerHTML);
    result.marks   = [...html.matchAll(/<mark>(.*?)<\/mark>/gs)]
      .map(m => m[1].replace(/<[^>]+>/g, '').trim());

    // Count citations
    const cites = await page.$$('.tcard-citation');
    result.papers = cites.length;

    // Get paper titles from DOM
    for (const cite of cites) {
      const title = await cite.$eval('.tcard-cite-title', el => el.textContent).catch(() => '');
      if (title) result.paperTitles.push(title);
    }

  } catch (e) {
    result.error = e.message;
  } finally {
    if (sw) sw.off('console', logHandler);
    await page.close();
  }

  return result;
}

async function run() {
  if (!GROQ_KEY) { console.error('Set GROQ_API_KEY'); process.exit(1); }

  console.log('Launching Chromium…');
  const context = await chromium.launchPersistentContext(USER_DATA, {
    headless: false,
    executablePath: process.env.CHROMIUM_PATH || 'chromium',
    args: ['--disable-extensions-except=' + EXT_PATH, '--load-extension=' + EXT_PATH,
           '--no-sandbox', '--disable-dev-shm-usage'],
    env: { ...process.env, DISPLAY: process.env.DISPLAY || ':0' },
  });

  await new Promise(r => setTimeout(r, 2000));

  // Detect extension ID
  const sw  = context.serviceWorkers().find(w => w.url().includes('/background/worker.js'));
  const extId = sw?.url().match(/chrome-extension:\/\/([a-z]+)\//)?.[1];
  if (!extId) { console.error('Extension not loaded'); process.exit(1); }
  console.log(`Extension id: ${extId}\n`);

  // Write settings (plus any config-specific overrides, e.g. SETTINGS_OVERRIDE='{"dateRangeYears":0}')
  const override = process.env.SETTINGS_OVERRIDE ? JSON.parse(process.env.SETTINGS_OVERRIDE) : {};
  const configName = process.env.CONFIG_NAME || 'default';
  console.log(`Config: ${configName}`, override);

  const bg = await context.newPage();
  await bg.goto(`chrome-extension://${extId}/settings/settings.html`);
  await bg.evaluate(({ key, model, url, override }) =>
    chrome.storage.local.set({
      provider: 'custom', apiKey: key, model, endpointUrl: url,
      enabled: true, autoDetectSearch: true, devMode: false,
      ...override,
    }),
    { key: GROQ_KEY, model: MODEL, url: GROQ_URL, override }
  );
  await bg.close();

  const results = [];
  for (const { q, category } of QUERIES) {
    console.log(`Running: "${q}"  [${category}]`);
    const r = await runQuery(context, extId, q);
    results.push({ ...r, category });
    console.log(r.error ? `  ERROR: ${r.error}` : `  OK — ${r.papers} papers, ${r.marks.length} marks`);
    // Brief pause between queries to avoid rate limits
    await new Promise(r => setTimeout(r, 3000));
  }

  await context.close();
  fs.rmSync(USER_DATA, { recursive: true, force: true });

  // ── Print full report ─────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(70));
  console.log(`QUALITY EVALUATION REPORT — config: ${configName}`);
  console.log('═'.repeat(70));

  results.forEach((r, idx) => {
    console.log(`\n${'─'.repeat(70)}`);
    console.log(`Q${idx + 1} [${r.category}]: "${r.query}"`);
    console.log(`${'─'.repeat(70)}`);

    if (r.error) {
      console.log(`  ERROR: ${r.error}`);
      return;
    }

    console.log(`\nPAPERS (${r.papers} shown):`);
    r.paperTitles.forEach((t, i) => console.log(`  ${i+1}. ${t}`));

    console.log(`\nSUMMARY:\n${r.summary}`);

    console.log(`\nHIGHLIGHTED PHRASES (${r.marks.length}):`);
    if (r.marks.length === 0) console.log('  (none)');
    r.marks.forEach((m, i) => console.log(`  [${i+1}] "${m}"`));
  });

  console.log('\n' + '═'.repeat(70));
  console.log('End of report — evaluate each result above for scoring.');
  console.log('═'.repeat(70) + '\n');
}

run().catch(e => { console.error('Fatal:', e); process.exit(1); });
