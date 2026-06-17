const ext = (typeof browser !== 'undefined') ? browser : chrome;

const PROVIDER_LABELS = { ollama:'Ollama', llamacpp:'llama.cpp', grok:'Grok', openai:'OpenAI', claude:'Claude', custom:'Custom' };

function openSettings() {
  ext.runtime.openOptionsPage().catch(() => {
    ext.tabs.create({ url: ext.runtime.getURL('settings/settings.html') });
  });
}

// Bind settings buttons immediately — before any async so they work right away
document.getElementById('btn-settings').addEventListener('click', openSettings);
document.getElementById('btn-settings-icon').addEventListener('click', openSettings);

async function init() {
  const settings = await ext.storage.local.get(null);
  const enabled  = settings.enabled ?? true;
  const provider = PROVIDER_LABELS[settings.provider] ?? settings.provider ?? 'Ollama';
  const model    = settings.model ?? '';
  const history  = settings.history ?? [];

  // Header
  document.getElementById('global-toggle').checked = enabled;
  document.getElementById('dot').className  = 'dot'  + (enabled ? '' : ' off');
  document.getElementById('name').className = 'name' + (enabled ? '' : ' off');

  // Status bar — test connection
  const sdot   = document.getElementById('sdot');
  const stText = document.getElementById('status-text');
  const stRight= document.getElementById('status-right');

  stText.innerHTML = `<span class="status-label">${esc(provider)}</span>${model ? ' · ' + esc(model) : ''}`;

  if (!enabled) {
    sdot.className      = 'sdot';
    stRight.textContent = 'Disabled';
  } else {
    sdot.className      = 'sdot ok';
    stRight.textContent = 'Checking…';
    try {
      const result = await ext.runtime.sendMessage({
        type: 'TEST_CONNECTION',
        provider: settings.provider, endpointUrl: settings.endpointUrl,
        apiKey: settings.apiKey, model: settings.model,
      });
      if (result?.ok) {
        sdot.className      = 'sdot ok';
        stRight.textContent = `Connected · ${result.latency}ms`;
      } else {
        sdot.className      = 'sdot err';
        stRight.textContent = 'Unreachable';
      }
    } catch (_) {
      sdot.className      = 'sdot err';
      stRight.textContent = 'Unreachable';
    }
  }

  // Body
  if (!enabled) {
    renderOff();
  } else if (stRight.textContent === 'Unreachable' || stRight.textContent === 'Checking…') {
    renderDisconnected(provider, settings.endpointUrl);
  } else {
    renderBody(history, null);
  }

}

function renderBody(history, activeSummary) {
  const body = document.getElementById('body');

  let html = '';

  if (activeSummary) {
    html += `
      <div class="section-label">On this page</div>
      <div class="active-card">
        <div style="flex:1;min-width:0">
          <div class="active-topic">${esc(activeSummary.topic)}</div>
          <div class="active-meta">
            <span class="conf-pill">${esc(activeSummary.confidence)}</span>
            <span>${activeSummary.studyCount} studies</span>
          </div>
        </div>
        <button class="btn-view" id="btn-view">View</button>
      </div>
      <hr class="divider" />`;
  }

  if (history.length === 0) {
    html += `
      <div class="empty">
        <div class="empty-icon">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
        </div>
        <div class="empty-title">No searches yet</div>
        <div class="empty-hint">Search something science-related and Truey will automatically surface relevant studies.</div>
      </div>`;
  } else {
    html += `<div class="section-label">Recent</div>`;
    html += history.slice(0, 5).map(h => `
      <a class="recent-item" href="#" data-topic="${esc(h.topic)}">
        <div class="recent-icon">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
        </div>
        <div style="flex:1;min-width:0">
          <div class="recent-topic">${esc(h.topic)}</div>
          <div class="recent-meta">${esc(h.confidence)} · ${h.studyCount} studies · ${timeAgo(h.ts)}</div>
        </div>
        <svg class="chevron" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
      </a>`).join('');
  }

  body.innerHTML = html;
}

function renderDisconnected(provider, url) {
  document.getElementById('body').innerHTML = `
    <div class="disc-banner">
      <div class="disc-title">Provider unreachable</div>
      <div class="disc-hint">${esc(provider)} isn't responding at ${esc(url ?? 'the configured URL')}. Make sure it's running and a model is loaded.</div>
      <button class="btn-retry" id="btn-retry">Retry connection</button>
    </div>`;
  document.getElementById('btn-retry').addEventListener('click', init);
}

function renderOff() {
  document.getElementById('body').innerHTML = `
    <div class="off-msg">Truey is turned off.<br/>Toggle it on to start verifying searches and selected text.</div>`;
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function esc(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

document.getElementById('global-toggle').addEventListener('change', async (e) => {
  await ext.storage.local.set({ enabled: e.target.checked });
  init();
});

init();
