// Fetches abstracts from multiple academic databases.
// All functions return a normalised Paper[]:
//   { title, authors, journal, year, abstract, url, source, citations? }

const TIMEOUT_MS = 20_000;

function timedFetch(url, opts = {}) {
  const ctrl = new AbortController();
  const tid   = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  return fetch(url, { ...opts, signal: ctrl.signal })
    .finally(() => clearTimeout(tid));
}

function safeFetch(promise, sourceName) {
  return promise.catch(e => {
    console.warn(`Truey [${sourceName}] failed:`, e?.message ?? e);
    return [];
  });
}

function norm(paper) {
  return {
    title:     paper.title     ?? '',
    authors:   paper.authors   ?? '',
    journal:   paper.journal   ?? '',
    year:      paper.year      ?? null,
    abstract:  paper.abstract  ?? '',
    url:       paper.url       ?? '',
    source:    paper.source    ?? '',
    citations: paper.citations ?? null,
  };
}

// ── PubMed ────────────────────────────────────────────────────────────────────

// Lightweight XML helpers — service workers lack DOMParser.
// xmlBlocks: returns raw inner-XML for each matching element (use for nested parsing)
// xmlGet:    returns plain text content of first match (strips child tags)
// xmlGetAll: returns plain text content of all matches

function xmlBlocks(block, tag) {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'gi');
  const out = []; let m;
  while ((m = re.exec(block)) !== null) out.push(m[1]); // inner XML preserved
  return out;
}
function xmlGet(block, tag) {
  const m = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return m ? m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '';
}
function xmlGetAll(block, tag) {
  return xmlBlocks(block, tag).map(inner => inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

async function fetchPubMed(query, settings) {
  const base  = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
  const limit = Math.ceil(settings.maxPapers / 3);

  const searchUrl = `${base}/esearch.fcgi?db=pubmed&term=${encodeURIComponent(query)}&retmax=${limit}&retmode=json`;
  const searchRes = await timedFetch(searchUrl);
  if (settings.devMode) console.log(`[Truey dev]   PubMed esearch HTTP ${searchRes.status} for: ${query}`);
  if (!searchRes.ok) { console.warn(`Truey [PubMed] esearch ${searchRes.status}`); return []; }
  const searchJson = await searchRes.json();
  const ids = searchJson.esearchresult?.idlist ?? [];
  if (settings.devMode) console.log(`[Truey dev]   PubMed IDs found: ${ids.length}`);
  if (!ids.length) return [];

  const fetchUrl = `${base}/efetch.fcgi?db=pubmed&id=${ids.join(',')}&retmode=xml`;
  const fetchRes = await timedFetch(fetchUrl);
  const xml      = await fetchRes.text();

  // Split into per-article blocks and parse with regex (DOMParser unavailable in SW)
  const articles = xmlBlocks(xml, 'PubmedArticle'); // preserve inner XML for nested parsing

  return articles.map(art => {
    const pmid    = xmlGet(art, 'PMID');
    const year    = xmlGet(art, 'Year') || xmlGet(art, 'MedlineDate').slice(0, 4);
    const authors = xmlBlocks(art, 'Author').slice(0, 3)
      .map(a => `${xmlGet(a, 'LastName')} ${xmlGet(a, 'Initials')}`.trim())
      .filter(Boolean).join(', ');
    const abstract = xmlGetAll(art, 'AbstractText').join(' ').trim();

    return norm({
      title:    xmlGet(art, 'ArticleTitle'),
      authors,
      journal:  xmlGet(art, 'Title'),
      year:     year ? parseInt(year) : null,
      abstract,
      url:      `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
      source:   'PubMed',
    });
  }).filter(p => p.title);
}

// ── Semantic Scholar ──────────────────────────────────────────────────────────

async function fetchSemanticScholar(query, settings) {
  const limit = Math.ceil(settings.maxPapers / 3);
  const fields = 'title,authors,year,abstract,externalIds,citationCount,venue';
  const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=${limit}&fields=${fields}`;
  let res = await timedFetch(url);
  if (res.status === 429) {
    // Rate limited — wait 3s and retry once
    await new Promise(r => setTimeout(r, 3000));
    res = await timedFetch(url);
  }
  if (settings.devMode) console.log(`[Truey dev]   Semantic Scholar HTTP ${res.status}`);
  if (!res.ok) { console.warn(`Truey [Semantic Scholar] ${res.status}`); return []; }
  const json = await res.json();

  return (json.data ?? []).map(p => norm({
    title:     p.title,
    authors:   (p.authors ?? []).slice(0, 3).map(a => a.name).join(', '),
    journal:   p.venue,
    year:      p.year,
    abstract:  p.abstract,
    url:       p.externalIds?.DOI
               ? `https://doi.org/${p.externalIds.DOI}`
               : `https://www.semanticscholar.org/paper/${p.paperId}`,
    source:    'Semantic Scholar',
    citations: p.citationCount,
  }));
}

// ── arXiv ─────────────────────────────────────────────────────────────────────

async function fetchArxiv(query, settings) {
  const limit = Math.ceil(settings.maxPapers / 4);
  // Restrict to quantitative biology — prevents finance/physics papers matching
  // medical terms like "risk" or "hair".
  const url = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}+AND+cat:q-bio*&start=0&max_results=${limit}`;
  const res  = await timedFetch(url);
  const xml  = await res.text();

  // Parse with regex — DOMParser unavailable in service workers
  const entries = xmlBlocks(xml, 'entry'); // preserve inner XML
  return entries.map(e => {
    const published = xmlGet(e, 'published');
    const year      = published ? new Date(published).getFullYear() : null;
    // arXiv Atom: <author><name>First Last</name></author>
    const authors   = xmlBlocks(e, 'author').slice(0, 3).map(a => xmlGet(a, 'name')).filter(Boolean).join(', ');

    return norm({
      title:    xmlGet(e, 'title').replace(/\s+/g, ' '),
      authors,
      journal:  'arXiv (preprint)',
      year,
      abstract: xmlGet(e, 'summary').replace(/\s+/g, ' '),
      url:      xmlGet(e, 'id'),
      source:   'arXiv',
    });
  });
}

// ── Europe PMC ────────────────────────────────────────────────────────────────

async function fetchEuropePmc(query, settings) {
  const limit = Math.ceil(settings.maxPapers / 4);
  const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(query)}&resultType=core&pageSize=${limit}&format=json`;
  const res  = await timedFetch(url);
  if (settings.devMode) console.log(`[Truey dev]   Europe PMC HTTP ${res.status}`);
  if (!res.ok) { console.warn(`Truey [Europe PMC] ${res.status}`); return []; }
  const json = await res.json();

  return (json.resultList?.result ?? []).map(p => norm({
    title:     p.title,
    authors:   p.authorString,
    journal:   p.journalTitle,
    year:      p.pubYear ? parseInt(p.pubYear) : null,
    abstract:  p.abstractText,
    url:       p.doi ? `https://doi.org/${p.doi}` : `https://europepmc.org/article/${p.source}/${p.id}`,
    source:    'Europe PMC',
    citations: p.citedByCount,
  }));
}

// ── OpenAlex ──────────────────────────────────────────────────────────────────

async function fetchOpenAlex(query, settings) {
  const limit = Math.ceil(settings.maxPapers / 4);
  const url = `https://api.openalex.org/works?search=${encodeURIComponent(query)}&per-page=${limit}&select=title,authorships,publication_year,abstract_inverted_index,primary_location,cited_by_count,doi`;
  const res  = await timedFetch(url);
  const json = await res.json();

  return (json.results ?? []).map(p => {
    // OpenAlex stores abstracts as inverted index — reconstruct
    let abstract = '';
    if (p.abstract_inverted_index) {
      const words = [];
      for (const [word, positions] of Object.entries(p.abstract_inverted_index)) {
        for (const pos of positions) words[pos] = word;
      }
      abstract = words.join(' ');
    }

    const authors = (p.authorships ?? [])
      .slice(0, 3)
      .map(a => a.author?.display_name ?? '')
      .join(', ');

    return norm({
      title:     p.title,
      authors,
      journal:   p.primary_location?.source?.display_name ?? '',
      year:      p.publication_year,
      abstract,
      url:       p.doi ? `https://doi.org/${p.doi}` : '',
      source:    'OpenAlex',
      citations: p.cited_by_count,
    });
  });
}

// ── Filter helpers ────────────────────────────────────────────────────────────

function applyFilters(papers, settings) {
  const cutoffYear = settings.dateRangeYears
    ? new Date().getFullYear() - settings.dateRangeYears
    : 0;

  return papers.filter(p => {
    if (settings.minCitations && p.citations !== null && p.citations < settings.minCitations) return false;
    if (cutoffYear && p.year && p.year < cutoffYear) return false;
    if (!p.abstract || p.abstract.length < 50) return false;
    return true;
  });
}

// ── Query focusing & relevance scoring ───────────────────────────────────────

// Shared filler pattern (function so the g-flag lastIndex is always fresh).
const FILLER_PAT = '(?:does|do|can|could|is|are|was|were|will|would|should|has|have|had|be|been|being|the|a|an|to|for|of|in|on|at|by|from|with|about|that|this|it|its|and|or|not|no|cause|causes|caused|causing|make|makes|made|result|results|lead|leads|affect|affects|effects|effect|reduce|reduces|reduced|reducing|increase|increases|increased|increasing|prevent|prevents|prevented|preventing|improve|improves|improved|improving|help|helps|helped|helping|promote|promotes|lower|lowers|boost|boosts|risk|risks|link|linked|links|associated|relate|related|between|good|bad|beneficial|harmful|what|why|how|when|where|which|who)';
const fillerRe  = () => new RegExp(`\\b${FILLER_PAT}\\b`, 'gi');

// Strip question words → tight noun phrase for academic database search.
// "does exercise reduce the risk of Alzheimer's" → "exercise Alzheimer's"
function focusQuery(raw) {
  const focused = raw.replace(fillerRe(), '').replace(/\s+/g, ' ').trim();
  return focused.length > 3 ? focused : raw;
}

// Return the meaningful content words from the raw query as an array.
function keyTerms(raw) {
  return [...new Set(
    raw.toLowerCase().replace(fillerRe(), '').trim()
       .split(/\s+/).filter(t => t.length > 2)
  )];
}

// Count how many key terms appear anywhere in the paper's title + abstract.
// Also tries the term without a trailing 's' so "colds"→"cold", "teenagers"→"teenager".
function relevanceScore(paper, terms) {
  if (!terms.length) return 1;
  const hay = (paper.title + ' ' + paper.abstract).toLowerCase();
  return terms.filter(t => hay.includes(t) || (t.endsWith('s') && hay.includes(t.slice(0, -1)))).length;
}

// ── Dev logging ───────────────────────────────────────────────────────────────

function devLog(settings, ...args) {
  if (settings?.devMode) console.log('[Truey dev]', ...args);
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Fetch papers from all enabled sources in parallel.
 * Returns { papers: Paper[], total: number, limitedData: boolean }
 */
export async function fetchPapers(query, settings) {
  const searchTerm = focusQuery(query);

  const enabledSources = Object.entries(settings.sources ?? {})
    .filter(([, v]) => v).map(([k]) => k);

  devLog(settings, '─── fetchPapers ───');
  devLog(settings, 'Original query  :', query);
  devLog(settings, 'Focused query   :', searchTerm);
  devLog(settings, 'Enabled sources :', enabledSources.join(', '));
  devLog(settings, 'Filters         :', {
    minCitations:    settings.minCitations,
    dateRangeYears:  settings.dateRangeYears,
    maxPapers:       settings.maxPapers,
    limitedThreshold:settings.limitedThreshold,
  });

  const sourceMap = {};
  const tasks = [];

  function addSource(key, name, fetchFn) {
    tasks.push(
      safeFetch(fetchFn, name).then(papers => {
        sourceMap[name] = papers.length;
        devLog(settings, `  ${name}: ${papers.length} papers returned`);
        return papers;
      })
    );
  }

  if (settings.sources.pubmed)           addSource('pubmed',          'PubMed',           fetchPubMed(searchTerm, settings));
  if (settings.sources.semanticScholar)  addSource('semanticScholar', 'Semantic Scholar',  fetchSemanticScholar(searchTerm, settings));
  if (settings.sources.arxiv)            addSource('arxiv',           'arXiv',             fetchArxiv(searchTerm, settings));
  if (settings.sources.europePmc)        addSource('europePmc',       'Europe PMC',        fetchEuropePmc(searchTerm, settings));
  if (settings.sources.openAlex)         addSource('openAlex',        'OpenAlex',          fetchOpenAlex(searchTerm, settings));

  const results = await Promise.all(tasks);
  const all     = results.flat();

  // Deduplicate by title similarity (lowercase, trimmed)
  const seen  = new Set();
  const unique = all.filter(p => {
    const key = p.title.toLowerCase().replace(/\s+/g, ' ').trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  devLog(settings, 'Total raw       :', all.length, '→ after dedup:', unique.length);

  // Rank papers by keyword relevance — surfaces best matches first, drops off-topic papers.
  // Threshold: for multi-term queries require ≥2 matching terms so a paper containing
  // only one incidental word (e.g. "creatine kinase" in a lupus paper) is rejected.
  const terms    = keyTerms(query);
  const minScore = terms.length >= 2 ? 2 : 1;
  devLog(settings, 'Key terms        :', terms.join(', '), '| min score:', minScore);
  const ranked = unique
    .map(p => ({ p, score: relevanceScore(p, terms) }))
    .filter(({ score }) => score >= minScore)   // prefer no sources over irrelevant ones
    .sort((a, b) => b.score - a.score)          // best matches first
    .map(({ p }) => p);
  devLog(settings, 'After relevance  :', ranked.length, '(dropped', unique.length - ranked.length, 'off-topic)');

  // Apply date, citation, and abstract filters.
  // A paper older than the date cutoff can still survive if it has a high citation
  // velocity (citations/year) — this is what lets a 2007 Cochrane review with hundreds
  // of citations through instead of being dropped purely for being old.
  const HIGH_IMPACT_VELOCITY = 5; // sustained citations per year — landmark-paper threshold
  const cutoffYear = settings.dateRangeYears
    ? new Date().getFullYear() - settings.dateRangeYears : 0;
  let noCitations = 0, tooOld = 0, noAbstract = 0;
  const filtered = ranked.filter(p => {
    if (settings.minCitations && (p.citations === null || p.citations < settings.minCitations)) { noCitations++; return false; }
    if (cutoffYear && p.year && p.year < cutoffYear) {
      const age      = Math.max(1, new Date().getFullYear() - p.year);
      const velocity = (p.citations ?? 0) / age;
      if (velocity < HIGH_IMPACT_VELOCITY) { tooOld++; return false; }
    }
    if (!p.abstract || p.abstract.length < 50) { noAbstract++; return false; }
    return true;
  });

  devLog(settings, 'Filter removed  :', { tooOld, noAbstract, belowMinCitations: noCitations });
  devLog(settings, 'After filters   :', filtered.length, '(threshold:', settings.limitedThreshold, ')');

  const limitedData = filtered.length < settings.limitedThreshold;

  return {
    papers:      filtered.slice(0, settings.maxPapers),
    rawCount:    unique.length,
    limitedData,
  };
}
