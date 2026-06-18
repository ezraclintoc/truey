# Truey Privacy Policy

_Last updated: 2026-06-18_

Truey is designed to keep your data on your device by default. This policy explains exactly what the extension does and does not do with your information.

## What Truey stores

All data Truey stores is kept locally in your browser's extension storage (`chrome.storage.local` / `browser.storage.local`). Nothing is sent to Truey's developer or any analytics service — there is no telemetry, no tracking, and no third-party analytics SDK in this extension.

Locally stored data includes:
- **Settings** — your chosen AI provider, endpoint URL, model name, and (if you supply one) your API key.
- **Query history** (optional, on by default) — the topic, confidence rating, and source list of past lookups, so you can revisit them. Disable anytime in Settings → Privacy, or clear it from the same screen.
- **Abstract cache** (optional, on by default) — paper abstracts already fetched, cached locally to avoid re-fetching. Disable or clear it from Settings → Privacy.

You can clear all stored data at any time from the extension's settings page, or by removing the extension.

## What Truey sends, and to whom

When you ask a question (via search or the popup), Truey sends network requests to two categories of third party, both of which you control:

1. **Scientific paper databases** — to find relevant studies, your query is sent to whichever sources you've enabled in Settings → Sources: PubMed (NCBI), Semantic Scholar, Europe PMC, arXiv, and/or OpenAlex. These are public, free research APIs; Truey sends only the search query, nothing else.
2. **Your chosen AI provider** — to generate the summary, the fetched paper abstracts and your question are sent to the AI provider and endpoint you configured (e.g. Groq, OpenAI, Anthropic, Grok, or a local Ollama/llama.cpp server, or any custom OpenAI-compatible endpoint you specify). If you use a cloud provider, your API key is sent to that provider exactly as it would be from any other application using that key — Truey does not relay it anywhere else. If you use a local provider (Ollama, llama.cpp) on `localhost`, nothing leaves your machine at this step.

Truey itself has no backend server — there is no Truey-operated service in this data path at all. Each request goes directly from your browser to the provider/database you selected.

## Local-only mode

Settings → Privacy → "Local only" restricts Truey to local AI providers (Ollama/llama.cpp) so that abstracts and queries are never sent to a cloud AI provider. Paper-source lookups (PubMed, Semantic Scholar, etc.) still occur over the network, since those databases have no local equivalent.

## Permissions

Truey requests the following browser permissions, used only as described above:
- `storage` — to save your settings, history, and cache locally.
- `activeTab` / `scripting` — to inject the result card on supported search engine pages.
- `contextMenus` — to add the right-click menu entry.
- Host permissions for the paper databases and AI providers listed above — required to make the requests described in this policy. No other hosts are contacted.

## Changes to this policy

If Truey's data handling changes, this file will be updated and the version history is visible in the project's git history.

## Contact

Questions about this policy: open an issue at the project's GitHub repository.
