const ext = (typeof browser !== 'undefined') ? browser : chrome;

const DEFAULTS = {
  enabled: true, provider: 'llamacpp', endpointUrl: 'http://localhost:8080',
  apiKey: '', model: 'llama3.2', vocabMode: 'simple', scienceness: 2,
  eqBands: { medicine:2, statistics:2, nutrition:2, psychology:2, biology:2, physics:2, climate:2 },
  fieldPresets: [], summaryLength: 'standard', showHighlights: true, showConfidence: true, maxCitations: 3,
  sources: { pubmed:true, semanticScholar:true, arxiv:false, cochrane:false, europePmc:true, openAlex:true, biorxiv:false },
  minCitations: 0, dateRangeYears: 10, maxPapers: 12,
  limitedDataAction: 'ask', limitedThreshold: 3, studyTypes: ['meta','systematic','rct'],
  autoDetectSearch: true, contextMenu: true, sensitivity: 'balanced',
  searchEngines: ['google','bing','duckduckgo','brave'],
  localOnly: false, saveHistory: true, cacheAbstracts: true,
};

const PROVIDER_ENDPOINTS = {
  ollama: 'http://localhost:11434', llamacpp: 'http://localhost:8080',
  grok: 'https://api.x.ai', groq: 'https://api.groq.com/openai',
  openai: 'https://api.openai.com',
  claude: 'https://api.anthropic.com', custom: '',
};

let settings = { ...DEFAULTS };
let dirty    = false;

// ── Nav & modal ───────────────────────────────────────────────────────────────

function show(id, btn) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  document.getElementById('sec-' + id)?.classList.add('active');
  btn.classList.add('active');
}

function openModal()  { document.getElementById('local-modal')?.classList.add('open'); }
function closeModal() { document.getElementById('local-modal')?.classList.remove('open'); }

function switchInstallTab(id, btn) {
  document.querySelectorAll('.install-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.install-content').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('install-' + id)?.classList.add('active');
}

// ── Boot ──────────────────────────────────────────────────────────────────────

async function init() {
  const stored = await ext.storage.local.get(null);
  settings = { ...DEFAULTS, ...stored };
  populateAll();
  bindAll();
  updateStorageCounts(stored);
  refreshProviderStatus();
}

async function probeProvider(provider, endpointUrl, apiKey) {
  const base = (endpointUrl || '').replace(/\/+$/, '');
  if (!base) return { ok: false, error: 'No endpoint URL set', models: [] };

  if (provider === 'claude') {
    return { ok: !!apiKey, latency: 0, models: [
      'claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001',
    ]};
  }

  const headers = {};
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  const t0  = Date.now();
  const url = provider === 'ollama'
    ? `${base}/api/tags`
    : `${base}/v1/models`;

  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}`, models: [] };
    const data    = await res.json();
    const latency = Date.now() - t0;
    const models  = provider === 'ollama'
      ? (data.models ?? []).map(m => m.name)
      : (data.data   ?? []).map(m => m.id);
    return { ok: true, latency, models };
  } catch (e) {
    return { ok: false, error: 'Unreachable', models: [] };
  }
}

async function refreshProviderStatus() {
  const statusEl = q('#conn-status');
  if (statusEl) statusEl.innerHTML = '<span class="status-dot unknown"></span>Checking…';

  const { ok, latency, models, error } = await probeProvider(
    settings.provider, settings.endpointUrl, settings.apiKey
  );

  if (statusEl) {
    statusEl.innerHTML = ok
      ? `<span class="status-dot ok"></span>Connected · ${latency}ms`
      : `<span class="status-dot err"></span>${error || 'Unreachable'}`;
  }

  const msEl = q('#model-select');
  if (msEl && models.length > 0) {
    const current = settings.model || '';
    const list    = models.includes(current) ? models : [...new Set([current, ...models])].filter(Boolean);
    msEl.innerHTML = list.map(m =>
      `<option value="${escAttr(m)}"${m === current ? ' selected' : ''}>${escAttr(m)}</option>`
    ).join('');
  }
}

function escAttr(s) { return String(s).replace(/"/g, '&quot;').replace(/</g, '&lt;'); }

function updateStorageCounts(stored) {
  const history = stored?.history ?? [];
  const cache   = stored?.abstractCache ?? {};
  const el1 = document.getElementById('history-count');
  const el2 = document.getElementById('cache-size');
  if (el1) el1.textContent = `${history.length} quer${history.length === 1 ? 'y' : 'ies'} stored locally`;
  if (el2) {
    const bytes = JSON.stringify(cache).length;
    el2.textContent = bytes > 1024 ? `${(bytes / 1024).toFixed(1)} KB cached` : `${bytes} bytes cached`;
  }
}

// ── Populate form from settings ────────────────────────────────────────────────

function populateAll() {
  // Provider
  const provCard = document.querySelector(`input[name="provider"][id="p-${settings.provider}"]`);
  if (provCard) provCard.checked = true;

  const euEl = q('#endpoint-url'); if (euEl) euEl.value = settings.endpointUrl ?? '';
  const akEl = q('#api-key');      if (akEl) akEl.value = settings.apiKey       ?? '';
  const msEl = q('#model-select'); if (msEl) msEl.value = settings.model        ?? '';

  // Output
  setVocabMode(settings.vocabMode);
  const scEl = q('#scienceness'); if (scEl) scEl.value = settings.scienceness;
  updateScienceness(settings.scienceness);

  const eqSliders = document.querySelectorAll('.eq-slider');
  const eqKeys    = Object.keys(settings.eqBands);
  eqSliders.forEach((s, i) => {
    s.value = settings.eqBands[eqKeys[i]] ?? 2;
    const valEl = document.getElementById('eq-val-' + i);
    if (valEl) valEl.textContent = EQ_LABELS[s.value - 1];
  });

  document.querySelectorAll('.field-chip').forEach(chip => {
    chip.classList.toggle('active', settings.fieldPresets.includes(chip.textContent.trim()));
  });

  const slEl = q('#summary-length'); if (slEl) slEl.value = settings.summaryLength;
  setToggle('highlights-toggle', settings.showHighlights);
  setToggle('confidence-toggle', settings.showConfidence);
  const mcEl = q('#max-citations'); if (mcEl) mcEl.value = settings.maxCitations;

  // Sources
  const srcMap = { pubmed:'src-pubmed', semanticScholar:'src-semantic', arxiv:'src-arxiv',
    cochrane:'src-cochrane', europePmc:'src-europepmc', openAlex:'src-openalex', biorxiv:'src-biorxiv' };
  Object.entries(srcMap).forEach(([key, id]) => setToggle(id, settings.sources[key]));

  // Filters
  const minEl = q('#min-citations');    if (minEl) minEl.value = settings.minCitations;
  const drEl  = q('#date-range');       if (drEl)  drEl.value  = settings.dateRangeYears === 0 ? 'all' : String(settings.dateRangeYears);
  const mpEl  = q('#max-papers');       if (mpEl)  mpEl.value  = settings.maxPapers;
  const ltEl  = q('#limited-threshold'); if (ltEl) ltEl.value  = settings.limitedThreshold;
  selectLimitedOption(settings.limitedDataAction);

  document.querySelectorAll('.pill-check input[data-type="study"]').forEach(cb => {
    cb.checked = settings.studyTypes.includes(cb.value);
  });

  // Triggers
  setToggle('trigger-auto',        settings.autoDetectSearch);
  setToggle('trigger-context',     settings.contextMenu);
  const ssEl = q('#sensitivity-select'); if (ssEl) ssEl.value = settings.sensitivity;

  document.querySelectorAll('.pill-check input[data-type="engine"]').forEach(cb => {
    cb.checked = settings.searchEngines.includes(cb.value);
  });

  // Privacy
  setToggle('local-only-toggle',    settings.localOnly);
  setToggle('history-toggle',       settings.saveHistory);
  setToggle('cache-toggle',         settings.cacheAbstracts);
}

// ── Bind events ────────────────────────────────────────────────────────────────

function bindAll() {
  // Provider radio
  document.querySelectorAll('input[name="provider"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const p = radio.id.replace('p-', '');
      settings.provider = p;
      const auto = PROVIDER_ENDPOINTS[p];
      if (auto !== undefined) {
        settings.endpointUrl = auto;
        const euEl = q('#endpoint-url'); if (euEl) euEl.value = auto;
      }
      markDirty();
      refreshProviderStatus();
    });
  });

  bind('#endpoint-url',  'input',  v => { settings.endpointUrl = v; });
  bind('#api-key',       'input',  v => { settings.apiKey      = v; });
  bind('#model-select',  'change', v => { settings.model       = v; });

  // Test connection
  q('#btn-test')?.addEventListener('click', async () => {
    const btn = q('#btn-test');
    btn.textContent = 'Testing…';
    btn.disabled    = true;
    await refreshProviderStatus();
    btn.textContent = 'Test';
    btn.disabled    = false;
  });

  // Output
  document.getElementById('btn-simple')?.addEventListener('click',   () => { setVocabMode('simple');   settings.vocabMode = 'simple';   markDirty(); });
  document.getElementById('btn-advanced')?.addEventListener('click', () => { setVocabMode('advanced'); settings.vocabMode = 'advanced'; markDirty(); });

  q('#scienceness')?.addEventListener('input', e => {
    settings.scienceness = parseInt(e.target.value);
    updateScienceness(settings.scienceness);
    markDirty();
  });

  const eqKeys = Object.keys(settings.eqBands);
  document.querySelectorAll('.eq-slider').forEach((s, i) => {
    s.addEventListener('input', () => {
      settings.eqBands[eqKeys[i]] = parseInt(s.value);
      const valEl = document.getElementById('eq-val-' + i);
      if (valEl) valEl.textContent = EQ_LABELS[s.value - 1];
      markDirty();
    });
  });

  document.querySelectorAll('.field-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      chip.classList.toggle('active');
      settings.fieldPresets = [...document.querySelectorAll('.field-chip.active')].map(c => c.textContent.trim());
      markDirty();
    });
  });

  bind('#summary-length', 'change', v => settings.summaryLength  = v);
  bindToggle('highlights-toggle', v => settings.showHighlights   = v);
  bindToggle('confidence-toggle', v => settings.showConfidence   = v);
  bind('#max-citations',  'input', v => settings.maxCitations    = parseInt(v));

  // Sources
  const srcMap = { 'src-pubmed':'pubmed', 'src-semantic':'semanticScholar', 'src-arxiv':'arxiv',
    'src-cochrane':'cochrane', 'src-europepmc':'europePmc', 'src-openalex':'openAlex', 'src-biorxiv':'biorxiv' };
  Object.entries(srcMap).forEach(([id, key]) => {
    bindToggle(id, v => { settings.sources = { ...settings.sources, [key]: v }; });
  });

  // Filters
  bind('#min-citations',    'input',  v => settings.minCitations    = parseInt(v));
  bind('#date-range',       'change', v => settings.dateRangeYears  = v === 'all' ? 0 : parseInt(v));
  bind('#max-papers',       'input',  v => settings.maxPapers       = parseInt(v));
  bind('#limited-threshold','input',  v => settings.limitedThreshold = parseInt(v));

  document.querySelectorAll('.limited-option').forEach(opt => {
    opt.addEventListener('click', () => {
      settings.limitedDataAction = opt.querySelector('input')?.value ?? 'ask';
      selectLimitedOption(settings.limitedDataAction);
      markDirty();
    });
  });

  document.querySelectorAll('.pill-check input[data-type="study"]').forEach(cb => {
    cb.addEventListener('change', () => {
      settings.studyTypes = [...document.querySelectorAll('.pill-check input[data-type="study"]:checked')].map(c => c.value);
      markDirty();
    });
  });

  // Triggers
  bindToggle('trigger-auto',    v => settings.autoDetectSearch = v);
  bindToggle('trigger-context', v => settings.contextMenu      = v);
  bind('#sensitivity-select', 'change', v => settings.sensitivity = v);

  document.querySelectorAll('.pill-check input[data-type="engine"]').forEach(cb => {
    cb.addEventListener('change', () => {
      settings.searchEngines = [...document.querySelectorAll('.pill-check input[data-type="engine"]:checked')].map(c => c.value);
      markDirty();
    });
  });

  // Privacy
  bindToggle('local-only-toggle', v => settings.localOnly       = v);
  bindToggle('history-toggle',    v => settings.saveHistory     = v);
  bindToggle('cache-toggle',      v => settings.cacheAbstracts  = v);

  q('#btn-clear-history')?.addEventListener('click', async () => {
    settings.history = [];
    await ext.storage.local.set({ history: [] });
    q('#history-count').textContent = '0 queries stored locally';
  });

  q('#btn-clear-cache')?.addEventListener('click', async () => {
    settings.abstractCache = {};
    await ext.storage.local.set({ abstractCache: {} });
    q('#cache-size').textContent = '0 bytes cached';
  });

  // Save / Discard
  q('#btn-save')?.addEventListener('click',    save);
  q('#btn-discard')?.addEventListener('click', discard);

  // EQ reset — updates settings too
  q('.eq-reset')?.addEventListener('click', () => {
    document.querySelectorAll('.eq-slider').forEach((s, i) => {
      s.value = 2;
      settings.eqBands[eqKeys[i]] = 2;
      const valEl = document.getElementById('eq-val-' + i);
      if (valEl) valEl.textContent = 'Undergrad';
    });
    markDirty();
  });

  // Nav — prompt if dirty, otherwise navigate immediately
  document.querySelectorAll('.nav-item[data-section]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (dirty) {
        showUnsavedDialog(btn.dataset.section, btn);
      } else {
        show(btn.dataset.section, btn);
      }
    });
  });

  // Help modal
  document.getElementById('btn-local-help')?.addEventListener('click', openModal);
  document.querySelector('.modal-close')?.addEventListener('click', closeModal);
  document.getElementById('local-modal')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal();
  });

  // Install tabs — each carries data-tab="<id>"
  document.querySelectorAll('.install-tab[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => switchInstallTab(btn.dataset.tab, btn));
  });
}

// ── Save / Discard ────────────────────────────────────────────────────────────

async function save() {
  await ext.storage.local.set(settings);
  dirty = false;
  const btn = q('#btn-save');
  btn.textContent = 'Saved ✓';
  setTimeout(() => { btn.textContent = 'Save changes'; }, 1500);
}

function discard() {
  init();
  dirty = false;
}

function markDirty() {
  dirty = true;
}

function showUnsavedDialog(targetSection, targetBtn) {
  const dialog = document.getElementById('unsaved-dialog');
  document.getElementById('unsaved-save').onclick = async () => {
    dialog.close();
    await save();
    show(targetSection, targetBtn);
  };
  document.getElementById('unsaved-discard').onclick = () => {
    dialog.close();
    discard();
    show(targetSection, targetBtn);
  };
  document.getElementById('unsaved-stay').onclick = () => dialog.close();
  dialog.showModal();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const EQ_LABELS = ['Plain', 'Undergrad', 'Graduate', 'Expert'];

const sciTexts = {
  1: { label:'Plain English', text:"Creatine probably doesn't cause hair loss. There's only one small study suggesting it might raise a hormone linked to hair loss, but nothing has actually proven it makes people go bald." },
  2: { label:'Undergrad', text:"Creatine may slightly elevate DHT levels based on limited evidence, but a direct link to hair loss hasn't been confirmed in clinical studies." },
  3: { label:'Graduate', text:"One RCT reported a statistically significant increase in the DHT:testosterone ratio following creatine loading; however, no controlled trials have demonstrated androgenetic alopecia as a clinical outcome." },
  4: { label:'Expert', text:"Current literature lacks adequately powered RCTs demonstrating a causal relationship between creatine monohydrate supplementation and androgenetic alopecia, despite transient elevations in 5α-DHT observed in one rugby cohort (van der Merwe et al., 2009)." },
};

function updateScienceness(val) {
  const { label, text } = sciTexts[val] ?? sciTexts[2];
  const el = document.getElementById('scienceness-preview');
  if (el) el.innerHTML = `<strong>Preview — ${label}</strong>${text}`;
}

function setVocabMode(mode) {
  document.getElementById('vocab-simple').style.display   = mode === 'simple'   ? 'block' : 'none';
  document.getElementById('vocab-advanced').style.display = mode === 'advanced' ? 'block' : 'none';
  document.getElementById('btn-simple').classList.toggle('active',   mode === 'simple');
  document.getElementById('btn-advanced').classList.toggle('active', mode === 'advanced');
}

function selectLimitedOption(value) {
  document.querySelectorAll('.limited-option').forEach(opt => {
    const match = opt.querySelector('input')?.value === value;
    opt.classList.toggle('active', match);
  });
}

function setToggle(id, val) {
  const el = document.getElementById(id);
  if (el) el.checked = !!val;
}

function bindToggle(id, fn) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('change', () => { fn(el.checked); markDirty(); });
}

function bind(sel, event, fn) {
  const el = q(sel);
  if (!el) return;
  el.addEventListener(event, () => { fn(el.value); markDirty(); });
}

function q(sel) { return document.querySelector(sel); }

window.addEventListener('beforeunload', e => {
  if (dirty) e.preventDefault();
});

init();
