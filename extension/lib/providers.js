// Unified AI chat interface.
// All providers are normalised to:
//   chat(messages, settings) → AsyncGenerator<string>  (streamed tokens)

const ANTHROPIC_VERSION = '2023-06-01';

// ── OpenAI-compatible (Ollama, llama.cpp, Grok, OpenAI, custom) ──────────────

async function* openAIChat(messages, settings) {
  const base = settings.endpointUrl.replace(/\/$/, '');
  const url   = `${base}/v1/chat/completions`;

  const headers = { 'Content-Type': 'application/json' };
  if (settings.apiKey) headers['Authorization'] = `Bearer ${settings.apiKey}`;

  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120_000);

  try {
    const res = await fetch(url, {
      method:  'POST',
      headers,
      signal:  ctrl.signal,
      body: JSON.stringify({ model: settings.model, messages, stream: true }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Provider error ${res.status}: ${text}`);
    }

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let   buffer  = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') return;
        try {
          const json  = JSON.parse(data);
          const delta = json.choices?.[0]?.delta?.content;
          if (typeof delta === 'string') yield delta;
        } catch { /* malformed chunk — skip */ }
      }
    }
  } finally {
    clearTimeout(timer);
  }
}

// ── Anthropic (Claude) ────────────────────────────────────────────────────────

async function* anthropicChat(messages, settings) {
  const system  = messages.find(m => m.role === 'system')?.content ?? '';
  const convo   = messages.filter(m => m.role !== 'system');

  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120_000);

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         settings.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      signal: ctrl.signal,
      body: JSON.stringify({
        model:      settings.model || 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system,
        messages:   convo,
        stream:     true,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Anthropic error ${res.status}: ${text}`);
    }

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let   buffer  = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const json = JSON.parse(line.slice(6));
          if (json.type === 'content_block_delta') yield json.delta?.text ?? '';
        } catch { /* skip */ }
      }
    }
  } finally {
    clearTimeout(timer);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Stream a chat completion.
 * @param {Array<{role:string, content:string}>} messages
 * @param {object} settings  from storage.getSettings()
 * @returns {AsyncGenerator<string>}
 */
export async function* chat(messages, settings) {
  if (settings.provider === 'claude') {
    yield* anthropicChat(messages, settings);
  } else {
    yield* openAIChat(messages, settings);
  }
}

/**
 * Convenience: collect the full streamed response into a string.
 */
export async function chatFull(messages, settings) {
  let out = '';
  for await (const token of chat(messages, settings)) out += token;
  return out;
}

/**
 * Test that the configured provider is reachable.
 * Uses a lightweight model-list probe instead of a full completion.
 * Returns { ok: true, latency: ms } or { ok: false, error: string }
 */
export async function testConnection(settings) {
  const base = (settings.endpointUrl || '').replace(/\/$/, '');

  if (settings.provider === 'claude') {
    return { ok: !!settings.apiKey, latency: 0 };
  }

  if (!base) return { ok: false, error: 'No endpoint URL' };

  const url = settings.provider === 'ollama' ? `${base}/api/tags` : `${base}/v1/models`;
  const headers = {};
  if (settings.apiKey) headers['Authorization'] = `Bearer ${settings.apiKey}`;

  const t0 = Date.now();
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return { ok: true, latency: Date.now() - t0 };
  } catch (e) {
    return { ok: false, error: 'Unreachable' };
  }
}

/**
 * Return the default endpoint URL for a given provider id.
 */
export function defaultEndpoint(provider) {
  const map = {
    ollama:  'http://localhost:11434',
    llamacpp:'http://localhost:8080',
    grok:    'https://api.x.ai',
    groq:    'https://api.groq.com/openai',
    openai:  'https://api.openai.com',
    claude:  'https://api.anthropic.com',
    custom:  '',
  };
  return map[provider] ?? '';
}
