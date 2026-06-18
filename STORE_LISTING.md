# Store listing copy

Copy-paste source for the Chrome Web Store and Firefox Add-ons (AMO) listings.

## Short description (Chrome: 132 char max · Firefox "Summary": 250 char max)

```
Science-backed summaries from peer-reviewed research, inline on your search results.
```
(86 characters — fits both limits.)

## Detailed description

```
Truey adds a research summary card to your search results when your question
looks scientific — "does coffee increase blood pressure," "does exercise
improve memory," and so on. Ask a question on Google, Bing, DuckDuckGo,
Brave, Ecosia, Startpage, or Yahoo, and Truey:

1. Fetches relevant peer-reviewed papers from PubMed, Semantic Scholar,
   Europe PMC, arXiv, and/or OpenAlex
2. Filters out anything that doesn't actually match your question — Truey
   would rather show "limited data" than an irrelevant paper
3. Summarizes the evidence using an AI model of your choice, highlighting
   the single clearest finding and rating overall confidence as Low,
   Moderate, or High

KEY FEATURES

• Inline search cards — no extra clicks, the summary appears alongside
  your normal results
• Multi-source retrieval with relevance ranking, so off-topic papers never
  reach the summary
• Bring your own AI provider — Groq, OpenAI, Anthropic (Claude), Grok, or
  run it fully locally with Ollama / llama.cpp (no API key, nothing leaves
  your device)
• Adjustable reading level — plain English up to expert/researcher level,
  globally or per scientific field
• Evidence confidence rating on every summary
• Privacy controls — local-only mode, and you can disable history/caching
  entirely

YOUR DATA

Truey has no backend server of its own. Requests go directly from your
browser to the paper databases and AI provider you choose. Settings,
history, and cached abstracts are stored locally in your browser only —
never sent anywhere except the provider you configure. Full privacy
policy: [link to PRIVACY.md / hosted privacy page]

This is an independent, open-source project — not affiliated with any of
the listed AI providers or research databases.
```

## Category

- Chrome Web Store: **Productivity** (or "Tools" if Productivity isn't a fit)
- Firefox AMO: **Privacy & Security** or **Productivity**

## Permission justifications (Chrome Web Store dashboard asks for these per-permission)

- **`storage`** — "Stores user settings, optional query history, and an optional local abstract cache, entirely on-device."
- **`activeTab` / `scripting`** — "Used to inject the Truey result card into the current search results page when the user runs a search."
- **`contextMenus`** — "Adds a right-click menu entry to look up the selected text."
- **Host permissions — research databases** (`eutils.ncbi.nlm.nih.gov`, `api.semanticscholar.org`, `export.arxiv.org`, `europepmc.org`, `api.openalex.org`) — "Used to fetch peer-reviewed paper metadata and abstracts relevant to the user's query. These are public research APIs; only the search query is sent."
- **Host permissions — AI providers** (`api.groq.com`, `api.x.ai`, `api.openai.com`, `api.anthropic.com`, `localhost`/`127.0.0.1`) — "Used to send the fetched abstracts to the AI provider the user has explicitly configured in Settings, in order to generate the summary. The user selects which provider to use and supplies their own API key; no request is sent to any provider the user hasn't configured."

## Screenshots to capture (recommend 3–5, 1280x800)

1. The Truey card on a DuckDuckGo/Google results page showing a full summary with the highlighted finding and confidence bar (the `assets/demo.gif` frame already shows this layout — grab a static frame or take a fresh screenshot).
2. The Settings → Provider tab showing the provider cards (Ollama, llama.cpp, Groq, OpenAI, Claude, Grok, Custom).
3. The Settings → Sources & Filters tab.
4. The "Limited data" state on a query with no good matches, to show the no-irrelevant-sources behavior.
5. (Optional) The popup UI.

## Other listing fields

- **Website / homepage**: the GitHub repo URL.
- **Privacy policy URL**: host `PRIVACY.md` (e.g. raw GitHub URL or rendered via GitHub Pages) and link it in both dashboards.
- **Single purpose description** (Chrome requires this): "Summarizes peer-reviewed scientific research relevant to the user's search query or selected text."
