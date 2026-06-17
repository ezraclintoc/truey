// Decides whether a search query is science-relevant.
// Two-pass: fast regex heuristic first, optional AI fallback for borderline cases.

import { chatFull } from './providers.js';

// ── Heuristic patterns ────────────────────────────────────────────────────────

const STRONG_SIGNALS = [
  // Causal / efficacy questions
  /\b(does|do|can|will|is|are)\b.{0,40}\b(cause|prevent|treat|cure|affect|increase|decrease|reduce|improve|worsen|linked to|associated with)\b/i,
  // Health & medical
  /\b(symptom|diagnosis|treatment|therapy|medication|drug|dose|dosage|side effect|clinical|trial|study|research|evidence)\b/i,
  // Nutrition & supplementation
  /\b(supplement|vitamin|mineral|protein|carb|fat|calorie|nutrient|diet|nutrition|deficiency|omega|probiotic|antioxidant)\b/i,
  // Psychology & neuroscience
  /\b(anxiety|depression|adhd|autism|cognition|memory|sleep|stress|cortisol|serotonin|dopamine|mental health|therapy)\b/i,
  // Biology & physiology
  /\b(hormone|gene|dna|rna|cell|protein|enzyme|metabolism|immune|inflammation|oxidative|mitochondria|microbiome)\b/i,
  // Physics, chemistry, climate
  /\b(radiation|quantum|molecule|compound|element|climate change|carbon|emission|greenhouse|ecosystem)\b/i,
  // Study-type terms
  /\b(meta.?analysis|systematic review|randomized|rct|placebo|double.?blind|cohort|longitudinal)\b/i,
  // "how does X work" patterns
  /\bhow (does|do|did).{0,30}(work|function|affect|impact)\b/i,
  // "what is the evidence" patterns
  /\b(evidence|proof|proven|studies show|science (says|behind)|research (on|into|shows))\b/i,
];

const WEAK_SIGNALS = [
  /\b(health|healthy|medical|medicine|biology|chemistry|physics|science|scientific)\b/i,
  /\b(effective|efficacy|benefit|risk|safe|safety|toxic|toxicity)\b/i,
  /\b(how (much|many|long|often)|what (amount|dose|level))\b/i,
];

const NOISE = [
  /\b(recipe|restaurant|movie|song|game|sport|celebrity|news|weather|stock|price|buy|shop|store|amazon|netflix)\b/i,
  /\b(how to (install|setup|fix|use|make|build|download|update)).{0,20}(software|app|computer|windows|mac|phone)\b/i,
];

/**
 * Fast local classification.
 * Returns 'yes' | 'no' | 'maybe'
 */
export function classifyHeuristic(query, sensitivity = 'balanced') {
  if (NOISE.some(r => r.test(query))) return 'no';

  const strongHits = STRONG_SIGNALS.filter(r => r.test(query)).length;
  const weakHits   = WEAK_SIGNALS.filter(r => r.test(query)).length;

  if (sensitivity === 'aggressive') {
    if (strongHits >= 1 || weakHits >= 2) return 'yes';
    if (weakHits >= 1) return 'maybe';
  } else if (sensitivity === 'conservative') {
    if (strongHits >= 2) return 'yes';
    if (strongHits === 1) return 'maybe';
  } else { // balanced
    if (strongHits >= 1) return 'yes';
    if (weakHits >= 2)   return 'maybe';
  }

  return 'no';
}

/**
 * AI-assisted classification for 'maybe' results.
 * Returns true if the query is science-relevant.
 */
async function classifyWithAI(query, settings) {
  const prompt = `Is the following search query asking about something that peer-reviewed scientific research could help answer? Answer only "yes" or "no".\n\nQuery: "${query}"`;
  try {
    const result = await chatFull(
      [{ role: 'user', content: prompt }],
      settings,
    );
    return result.trim().toLowerCase().startsWith('yes');
  } catch {
    return false;
  }
}

/**
 * Full classifier. Returns true if the query should trigger Truey.
 * @param {string} query
 * @param {object} settings  from storage.getSettings()
 */
export async function isScientific(query, settings) {
  if (!query || query.trim().length < 4) return false;

  const heuristic = classifyHeuristic(query, settings.sensitivity);
  if (heuristic === 'yes') return true;
  if (heuristic === 'no')  return false;

  // 'maybe' — use AI if available and not local-only without a running model
  try {
    return await classifyWithAI(query, settings);
  } catch {
    // If AI is unreachable, fall back to treating 'maybe' as true on balanced/aggressive
    return settings.sensitivity !== 'conservative';
  }
}
