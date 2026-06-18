# Truey

A browser extension that summarizes peer-reviewed research inline on your search results. Ask a question on Google, Bing, DuckDuckGo, Brave, Ecosia, Startpage, or Yahoo, and Truey fetches relevant papers from PubMed, Semantic Scholar, Europe PMC, arXiv, and/or OpenAlex, then summarizes the evidence with an AI model of your choice — highlighting the single clearest finding and showing a confidence level.

![Truey answering "does vitamin C prevent colds" on DuckDuckGo](assets/demo.gif)

## Features

- **Inline search cards** — a "Truey" result card appears alongside your normal search results when your query looks scientific.
- **Multi-source paper retrieval** — PubMed, Semantic Scholar, Europe PMC, arXiv, and OpenAlex, with keyword-relevance ranking so off-topic papers get filtered out before reaching the AI.
- **Bring your own AI provider** — Groq, Ollama, llama.cpp, Grok, OpenAI, Anthropic (Claude), or any OpenAI-compatible custom endpoint.
- **Configurable vocabulary level** — plain English up to expert/researcher level, globally or per scientific domain.
- **Evidence confidence bar** — every summary ends with a Low/Moderate/High confidence rating based on the underlying studies.
- **Privacy controls** — local-only mode, optional history/abstract caching, all configurable from the settings page.

## Installation

Truey is not yet published to an extension store — install it as an unpacked extension:

### Chrome / Edge / Brave (Chromium-based)

1. Clone or download this repository.
2. Open `chrome://extensions`.
3. Enable **Developer mode** (top right toggle).
4. Click **Load unpacked** and select the `extension/` folder inside this repo.
5. Pin the Truey icon to your toolbar.

### Firefox

1. Clone or download this repository.
2. Open `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on…** and select `extension/manifest.json`.
   (Temporary add-ons are removed when Firefox restarts — for a persistent install you'll need to sign the extension via [AMO](https://addons.mozilla.org/).)

## Setup — configure an AI provider

After installing, click the Truey icon → **Settings** (or the gear icon) and configure a provider under the **Provider** tab:

| Provider | Endpoint | API key needed? |
|---|---|---|
| Ollama | `http://localhost:11434` | No |
| llama.cpp | `http://localhost:8080` | No |
| Groq | `https://api.groq.com/openai` | Yes — [get one here](https://console.groq.com/keys) |
| OpenAI | `https://api.openai.com` | Yes |
| Anthropic (Claude) | `https://api.anthropic.com` | Yes |
| Grok | `https://api.x.ai` | Yes |
| Custom (any other OpenAI-compatible API) | your endpoint URL | Depends on provider |

Pick a model name your provider supports, save, and use **Test connection** to confirm it's reachable.

## Configuring sources & filters

From the **Sources** and **Filters** tabs you can:
- Toggle which databases are queried (PubMed, Semantic Scholar, Europe PMC, arXiv, OpenAlex; Cochrane and bioRxiv are not yet implemented).
- Set a minimum citation count, a publication date range, and preferred study types (meta-analyses, systematic reviews, RCTs).
- Choose what happens when too few papers pass the filters: ask before proceeding, expand the search automatically, or summarize with whatever was found.

## Project structure

```
extension/
  background/   service worker — message routing, pipeline orchestration
  content/      injected into search result pages
  lib/          shared logic: paper fetchers, AI provider adapters, storage, classifier
  popup/        toolbar popup UI
  settings/     full settings page
```

## License

[CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/) — free to use, modify, and share for non-commercial purposes, with attribution. Contact for commercial licensing.
