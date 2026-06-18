import ext from './compat.js';

const SETTINGS_VERSION = 3;

export const DEFAULTS = {
  enabled:        true,
  provider:       'llamacpp',
  endpointUrl:    'http://localhost:8080',
  apiKey:         '',
  model:          'llama3.2',

  // Output
  vocabMode:      'simple',   // 'simple' | 'advanced'
  scienceness:    2,          // 1–4
  eqBands:        { medicine: 2, statistics: 2, nutrition: 2, psychology: 2, biology: 2, physics: 2, climate: 2 },
  fieldPresets:   [],
  summaryLength:  'standard', // 'brief' | 'standard' | 'detailed'
  showHighlights: true,
  showConfidence: true,
  maxCitations:   3,

  // Sources
  sources: {
    pubmed:          true,
    semanticScholar: true,
    arxiv:           false,   // mostly physics/CS/math — rarely useful for health queries
    cochrane:        false,  // not yet implemented
    europePmc:       true,
    openAlex:        true,   // catches landmark/old papers other sources miss (e.g. Cochrane reviews)
    biorxiv:         false,
  },

  // Filters
  minCitations:       0,
  dateRangeYears:     10,
  maxPapers:          12,
  limitedDataAction:  'ask',  // 'summarize' | 'ask' | 'expand'
  limitedThreshold:   3,
  studyTypes:         ['meta', 'systematic', 'rct'],

  // Triggers
  autoDetectSearch:   true,
  contextMenu:        true,
  sensitivity:        'balanced', // 'conservative' | 'balanced' | 'aggressive'
  searchEngines:      ['google', 'bing', 'duckduckgo', 'brave'],

  // Privacy
  localOnly:          false,
  saveHistory:        true,
  cacheAbstracts:     true,

  // Developer
  devMode:            false,

  // Internal
  settingsVersion:    0,    // bumped by migrations; must be in DEFAULTS so get() fetches it
  history:            [],   // [{ topic, confidence, studyCount, sources, ts }]
  abstractCache:      {},   // { queryHash: { ts, papers[] } }
};

export async function getSettings() {
  const stored = await ext.storage.local.get(DEFAULTS);
  const settings = { ...DEFAULTS, ...stored };

  // Run migrations when stored version is behind current.
  if ((stored.settingsVersion ?? 0) < SETTINGS_VERSION) {
    // v2: disable arXiv (physics/CS junk), enable Europe PMC, disable cochrane (not implemented yet).
    // v3: enable OpenAlex — surfaces landmark/old papers (e.g. Cochrane reviews) other sources miss.
    settings.sources = { ...settings.sources, arxiv: false, europePmc: true, cochrane: false, openAlex: true };
    settings.settingsVersion = SETTINGS_VERSION;
    await ext.storage.local.set({ sources: settings.sources, settingsVersion: SETTINGS_VERSION });
  }

  return settings;
}

export async function setSetting(key, value) {
  await ext.storage.local.set({ [key]: value });
}

export async function setSettings(patch) {
  await ext.storage.local.set(patch);
}

export async function addHistory(entry) {
  const { history } = await ext.storage.local.get({ history: [] });
  const next = [{ ...entry, ts: Date.now() }, ...history].slice(0, 50);
  await ext.storage.local.set({ history: next });
}

export async function clearHistory() {
  await ext.storage.local.set({ history: [] });
}

export async function clearCache() {
  await ext.storage.local.set({ abstractCache: {} });
}
