// Playwright test: loads the Truey extension in Chromium and exercises the main flows.
// Run with: node test-extension.js

const { chromium } = require('playwright');
const path = require('path');
const os   = require('os');
const fs   = require('fs');

const EXT_PATH  = path.resolve(__dirname, 'extension');
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'truey-test-'));

// Minimal Groq settings so the AI pipeline can actually run.
// Set GROQ_API_KEY in your environment to enable live AI tests.
const GROQ_KEY   = process.env.GROQ_API_KEY || '';
const GROQ_MODEL = 'llama-3.3-70b-versatile';
const GROQ_URL   = 'https://api.groq.com/openai';

let pass = 0, fail = 0;
function ok(name)  { console.log(`  ✓ ${name}`); pass++; }
function ko(name, reason) { console.error(`  ✗ ${name}: ${reason}`); fail++; }

async function run() {
  console.log('Launching Chromium with extension…');
  const context = await chromium.launchPersistentContext(USER_DATA, {
    headless: false,
    executablePath: process.env.CHROMIUM_PATH || 'chromium',
    args: [
      `--disable-extensions-except=${EXT_PATH}`,
      `--load-extension=${EXT_PATH}`,
      '--no-sandbox',
      '--disable-dev-shm-usage',
    ],
    env: { ...process.env, DISPLAY: process.env.DISPLAY || ':0' },
  });

  // ── Find the extension ID via service worker URL ──────────────────────────
  let extId;
  await new Promise(r => setTimeout(r, 2000)); // let SW register
  try {
    const workers = context.serviceWorkers();
    const trueyWorker = workers.find(w => w.url().includes('/background/worker.js'));
    if (trueyWorker) {
      extId = trueyWorker.url().match(/chrome-extension:\/\/([a-z]+)\//)?.[1];
    }
    if (extId) ok(`Extension loaded (id: ${extId})`);
    else ko('Extension loaded', `no worker found. Workers: ${workers.map(w=>w.url()).join(', ')}`);
  } catch(e) {
    ko('Extension loaded', e.message);
  }

  // ── Capture service worker console (dev mode logs) ────────────────────────
  const swWorker = context.serviceWorkers().find(w => w.url().includes('/background/worker.js'));
  if (swWorker) {
    swWorker.on('console', msg => {
      console.log(`  SW [${msg.type()}] ${msg.text()}`);
    });
  }

  // ── Configure settings via storage API ────────────────────────────────────
  if (extId && GROQ_KEY) {
    try {
      const bg = await context.newPage();
      await bg.goto(`chrome-extension://${extId}/settings/settings.html`);
      await bg.waitForLoadState('domcontentloaded');
      await bg.evaluate(({ key, model, url }) => {
        return chrome.storage.local.set({
          provider:    'custom',
          apiKey:      key,
          model:       model,
          endpointUrl: url,
          enabled:     true,
          autoDetectSearch: true,
          devMode:     true,
        });
      }, { key: GROQ_KEY, model: GROQ_MODEL, url: GROQ_URL });
      await bg.close();
      ok('Settings written via storage API');
    } catch(e) {
      ko('Settings write', e.message);
    }
  } else {
    console.log('  ℹ  No GROQ_API_KEY — skipping live AI tests');
  }

  // ── Test: DuckDuckGo search injects card ───────────────────────────────────
  {
    const page = await context.newPage();
    try {
      console.log('\n[Test] Search card injection on DuckDuckGo…');
      await page.goto('https://duckduckgo.com/?q=does+vitamin+D+reduce+depression', {
        waitUntil: 'domcontentloaded', timeout: 20000
      });

      // Wait up to 12s for card to appear
      const card = await page.waitForSelector('#truey-card', { timeout: 12000 }).catch(() => null);
      if (card) {
        ok('Card injected into DuckDuckGo results');

        // Check alignment: card left should roughly match sibling result
        const cardBox  = await card.boundingBox();
        const sibling  = await page.$('ol.react-results--main li:not(#truey-card)');
        const sibBox   = sibling ? await sibling.boundingBox() : null;
        if (cardBox && sibBox) {
          const diff = Math.abs(cardBox.x - sibBox.x);
          if (diff < 20) ok(`Card alignment within 20px of results (Δ${diff}px)`);
          else           ko(`Card alignment`, `card x=${cardBox.x}, sibling x=${sibBox.x}, Δ${diff}px`);
        }

        // Check card is visible
        const visible = await card.isVisible();
        if (visible) ok('Card is visible');
        else         ko('Card visibility', 'card exists but not visible');

        // Check loading skeleton or summary appeared
        const skeleton  = await page.$('.tcard-loading');
        const streaming = await page.$('.tcard-streaming');
        const summary   = await page.$('.tcard-summary');
        if (skeleton || streaming || summary) ok('Card entered active state (loading/streaming/loaded)');
        else ko('Card active state', 'no loading/streaming/summary element found');

        if (GROQ_KEY) {
          // Wait up to 90s for any terminal state
          console.log('  … waiting for AI summary (up to 90s)…');

          // Poll for any terminal state every 2s
          let terminalState = null;
          for (let i = 0; i < 45; i++) {
            await page.waitForTimeout(2000);
            const bodyHTML = await page.$eval('.tcard-body', el => el.innerHTML).catch(() => '');
            if (bodyHTML.includes('tcard-summary') && !bodyHTML.includes('tcard-streaming')) {
              terminalState = 'loaded'; break;
            }
            if (bodyHTML.includes('tcard-error'))      { terminalState = 'error';      break; }
            if (bodyHTML.includes('tcard-empty'))      { terminalState = 'no-sources'; break; }
            if (bodyHTML.includes('tcard-limited'))    { terminalState = 'limited';    break; }
            if (i % 5 === 4) {
              const snippet = bodyHTML.replace(/<[^>]+>/g,'').trim().slice(0,120);
              console.log(`  … still waiting (${(i+1)*2}s) — card: "${snippet}"`);
            }
          }
          console.log(`  Card terminal state: ${terminalState}`);

          const summaryEl = terminalState === 'loaded'
            ? await page.$('.tcard-summary')
            : null;

          if (summaryEl) {
            ok('Summary loaded');
            const text    = await summaryEl.textContent();
            const rawHTML = await summaryEl.evaluate(el => el.innerHTML);
            if (text.length > 50) ok(`Summary has content (${text.length} chars)`);
            else ko('Summary content', `too short: "${text}"`);

            console.log('\n  ── Summary text ──');
            console.log('  ' + text.replace(/\n/g, '\n  '));
            const marks = [...rawHTML.matchAll(/<mark>(.*?)<\/mark>/gs)].map(m => m[1].replace(/<[^>]+>/g,''));
            console.log(`\n  ── Highlighted phrases (${marks.length}) ──`);
            marks.forEach((m, i) => console.log(`  [${i+1}] "${m}"`));
            console.log('');

            // Confidence bar
            const confBar = await page.$('.tcard-conf-bar');
            if (confBar) ok('Confidence bar rendered');
            else ko('Confidence bar', 'not found after summary loaded');

            // Citations
            const cites = await page.$$('.tcard-citation');
            if (cites.length > 0) ok(`Citations rendered (${cites.length})`);
            else ko('Citations', 'none rendered');

            // View all button
            const viewAll = await page.$('.tcard-view-all');
            if (viewAll) {
              ok('View all button present');
              await viewAll.click();
              await page.waitForTimeout(300);
              const afterCites = await page.$$('.tcard-citation');
              const expanded   = await viewAll.textContent();
              if (afterCites.length > cites.length || expanded.includes('fewer'))
                ok('View all expands citations');
              else
                ko('View all', `citation count unchanged (${afterCites.length})`);
            }
          } else {
            ko('Summary loaded', 'timed out after 60s');
          }
        }
      } else {
        ko('Card injected', 'timed out waiting for #truey-card after 12s');
      }
    } catch(e) {
      ko('DuckDuckGo test', e.message);
    }
    await page.close();
  }

  // ── Test: Settings page loads all sections ─────────────────────────────────
  if (extId) {
    const page = await context.newPage();
    try {
      console.log('\n[Test] Settings page navigation…');
      await page.goto(`chrome-extension://${extId}/settings/settings.html`);
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      const sections = ['provider', 'output', 'sources', 'filters', 'triggers', 'privacy'];
      for (const sec of sections) {
        const btn = await page.$(`[data-section="${sec}"]`);
        if (!btn) { ko(`Nav button: ${sec}`, 'not found'); continue; }
        await btn.click();
        await page.waitForTimeout(100);
        const active = await page.$(`#sec-${sec}.active`);
        if (active) ok(`Settings nav: ${sec}`);
        else ko(`Settings nav: ${sec}`, `#sec-${sec} not active after click`);
      }

      // Test save button
      const save = await page.$('#btn-save');
      if (save) ok('Save button present');
      else ko('Save button', 'not found');

    } catch(e) {
      ko('Settings page', e.message);
    }
    await page.close();
  }

  // ── Results ────────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(40)}`);
  console.log(`Results: ${pass} passed, ${fail} failed`);

  await context.close();
  fs.rmSync(USER_DATA, { recursive: true, force: true });
  process.exit(fail > 0 ? 1 : 0);
}

run().catch(e => { console.error('Fatal:', e); process.exit(1); });
