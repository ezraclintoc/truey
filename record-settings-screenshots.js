// Captures static screenshots of the Settings page tabs for the README.
// Run: CHROMIUM_PATH=... node record-settings-screenshots.js

const { chromium } = require('playwright');
const path = require('path');
const os   = require('os');
const fs   = require('fs');

const EXT_PATH  = path.resolve(__dirname, 'extension');
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'truey-shots-'));
const OUT_DIR   = path.resolve(__dirname, 'assets');

async function run() {
  console.log('Launching Chromium…');
  const context = await chromium.launchPersistentContext(USER_DATA, {
    headless: false,
    executablePath: process.env.CHROMIUM_PATH || 'chromium',
    viewport: { width: 1280, height: 860 },
    args: ['--disable-extensions-except=' + EXT_PATH, '--load-extension=' + EXT_PATH,
           '--no-sandbox', '--disable-dev-shm-usage'],
    env: { ...process.env, DISPLAY: process.env.DISPLAY || ':0' },
  });

  await new Promise(r => setTimeout(r, 2000));

  const sw    = context.serviceWorkers().find(w => w.url().includes('/background/worker.js'));
  const extId = sw?.url().match(/chrome-extension:\/\/([a-z]+)\//)?.[1];
  if (!extId) { console.error('Extension not loaded'); process.exit(1); }
  console.log(`Extension id: ${extId}`);

  const page = await context.newPage();
  await page.goto(`chrome-extension://${extId}/settings/settings.html`);
  await page.waitForTimeout(800);

  // Provider tab (default active) — providers/models screenshot
  await page.click('button[data-section="provider"]');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT_DIR, 'settings-provider.png') });
  console.log('Saved settings-provider.png');

  // Sources tab
  await page.click('button[data-section="sources"]');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT_DIR, 'settings-sources.png') });
  console.log('Saved settings-sources.png');

  // Filters tab
  await page.click('button[data-section="filters"]');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT_DIR, 'settings-filters.png') });
  console.log('Saved settings-filters.png');

  await context.close();
}

run();
