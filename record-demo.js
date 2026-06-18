// Records a short video of Truey answering a search query, for the README demo GIF.
// Run: CHROMIUM_PATH=... GROQ_API_KEY=... node record-demo.js

const { chromium } = require('playwright');
const path = require('path');
const os   = require('os');
const fs   = require('fs');

const EXT_PATH   = path.resolve(__dirname, 'extension');
const USER_DATA  = fs.mkdtempSync(path.join(os.tmpdir(), 'truey-demo-'));
const VIDEO_DIR   = process.env.VIDEO_DIR || '/tmp/truey-demo-video';
const GROQ_KEY   = process.env.GROQ_API_KEY || '';
const GROQ_URL   = 'https://api.groq.com/openai';
const MODEL      = 'llama-3.3-70b-versatile';
const QUERY      = process.env.DEMO_QUERY || 'does vitamin C prevent colds';

async function run() {
  if (!GROQ_KEY) { console.error('Set GROQ_API_KEY'); process.exit(1); }

  console.log('Launching Chromium…');
  const context = await chromium.launchPersistentContext(USER_DATA, {
    headless: false,
    executablePath: process.env.CHROMIUM_PATH || 'chromium',
    viewport: { width: 1280, height: 800 },
    recordVideo: { dir: VIDEO_DIR, size: { width: 1280, height: 800 } },
    args: ['--disable-extensions-except=' + EXT_PATH, '--load-extension=' + EXT_PATH,
           '--no-sandbox', '--disable-dev-shm-usage'],
    env: { ...process.env, DISPLAY: process.env.DISPLAY || ':0' },
  });

  await new Promise(r => setTimeout(r, 2000));

  const sw    = context.serviceWorkers().find(w => w.url().includes('/background/worker.js'));
  const extId = sw?.url().match(/chrome-extension:\/\/([a-z]+)\//)?.[1];
  if (!extId) { console.error('Extension not loaded'); process.exit(1); }
  console.log(`Extension id: ${extId}`);

  const bg = await context.newPage();
  await bg.goto(`chrome-extension://${extId}/settings/settings.html`);
  await bg.evaluate(({ key, model, url }) =>
    chrome.storage.local.set({
      provider: 'custom', apiKey: key, model, endpointUrl: url,
      enabled: true, autoDetectSearch: true, devMode: false,
    }),
    { key: GROQ_KEY, model: MODEL, url: GROQ_URL }
  );
  await bg.close();

  const page = await context.newPage();
  console.log(`Searching: "${QUERY}"`);
  await page.goto(`https://duckduckgo.com/?q=${encodeURIComponent(QUERY)}`, { waitUntil: 'domcontentloaded' });

  const card = await page.waitForSelector('#truey-card', { timeout: 14000 }).catch(() => null);
  if (!card) { console.error('Card never appeared'); }

  let done = false;
  for (let i = 0; i < 45 && !done; i++) {
    await page.waitForTimeout(2000);
    const bodyHTML = await page.$eval('.tcard-body', el => el.innerHTML).catch(() => '');
    done = bodyHTML.includes('tcard-summary') && !bodyHTML.includes('tcard-streaming') ||
           bodyHTML.includes('tcard-error') || bodyHTML.includes('tcard-empty') ||
           bodyHTML.includes('tcard-limited');
  }

  await card?.scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(4000); // hold on the finished card for the recording

  const videoPath = await page.video()?.path();
  await page.close();
  await context.close();

  console.log('Video saved to (pre-finalize path may differ):', videoPath);
  // List the actual file written to VIDEO_DIR
  const files = fs.readdirSync(VIDEO_DIR).filter(f => f.endsWith('.webm'));
  console.log('Files in VIDEO_DIR:', files);
}

run();
