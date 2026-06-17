// Handles "Verify with Truey" context menu → floating popup above selected text.

(async () => {

let popup            = null;
let anchorEl         = null;
let lastRange        = null;
let currentSelection = null; // the original text that triggered the popup
let popupPapers      = null; // papers from last limited result

// Track the user's selection range so we can position the popup
document.addEventListener('mouseup', () => {
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0 && sel.toString().trim().length > 0) {
    lastRange = sel.getRangeAt(0).cloneRange();
  }
});

// ── Message from background ────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'TRUEY_VERIFY_SELECTION') {
    openPopup(msg.selection);
  }

  if (!msg._truey || !popup) return;

  switch (msg.type) {
    case 'PIPELINE_STATUS':
      if (msg.status === 'fetching')    setPopupState('loading');
      if (msg.status === 'no-sources')  setPopupState('no-sources');
      if (msg.status === 'error')       setPopupState('error', { error: msg.error });
      if (msg.status === 'limited') {
        popupPapers = msg.papers ?? [];
        // For the popup, ask for context if limited — show AI question
        setPopupState('ai-asks', { question: `Only ${msg.papers?.length ?? 0} studies matched. Could you clarify what aspect you'd like to verify so I can broaden the search appropriately?` });
      }
      break;
    case 'PIPELINE_STREAM':
      setPopupState('streaming', { fullText: msg.fullText });
      break;
    case 'PIPELINE_DONE':
      setPopupState('loaded', {
        summary:    msg.summary,
        confidence: msg.confidence,
        papers:     msg.papers,
        topic:      msg.topic,
      });
      break;
  }
});

// ── Popup creation ─────────────────────────────────────────────────────────────

function openPopup(selectedText) {
  currentSelection = selectedText;
  popupPapers      = null;
  if (popup) popup.remove();

  popup = document.createElement('div');
  popup.id = 'truey-popup';
  popup.innerHTML = popupHTML(selectedText);
  document.body.appendChild(popup);

  positionPopup();
  bindPopupEvents(selectedText);
  setPopupState('loading');

  chrome.runtime.sendMessage({ type: 'RUN_PIPELINE', selectedText });
}

function popupHTML(selectedText) {
  const excerpt = selectedText.length > 120
    ? selectedText.slice(0, 120) + '…'
    : selectedText;

  return `
<style>${popupCSS()}</style>
<div class="tpop">
  <div class="tpop-header">
    <div class="tpop-header-left">
      <div class="tpop-dot"></div>
      <span class="tpop-label">Truey</span>
      <span class="tpop-topic"></span>
    </div>
    <div class="tpop-header-right">
      <span class="tpop-provider"></span>
      <button class="tpop-close">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
  </div>

  <div class="tpop-quote">
    <div class="tpop-quote-bar"></div>
    <div class="tpop-quote-text">${escHtml(excerpt)}</div>
  </div>

  <div class="tpop-body"></div>

  <div class="tpop-followup" id="tpop-followup" style="display:none">
    <div class="tpop-followup-collapsed" id="tpop-fu-collapsed">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
      Ask a follow-up
    </div>
    <div class="tpop-followup-expanded" id="tpop-fu-expanded" style="display:none">
      <div class="tpop-input-row">
        <textarea placeholder="e.g. Does this apply to women too?" rows="2"></textarea>
        <button class="tpop-send-btn">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        </button>
      </div>
    </div>
  </div>

  <div class="tpop-footer">
    <span class="tpop-footer-note">Not medical advice</span>
    <button class="tpop-view-all" style="display:none">View all →</button>
  </div>
</div>
<div class="tpop-caret"></div>`;
}

function bindPopupEvents(selectedText) {
  popup.querySelector('.tpop-close').addEventListener('click', () => popup.remove());

  const fuCollapsed = popup.querySelector('#tpop-fu-collapsed');
  const fuExpanded  = popup.querySelector('#tpop-fu-expanded');
  fuCollapsed.addEventListener('click', () => {
    fuCollapsed.style.display = 'none';
    fuExpanded.style.display  = '';
    positionPopup();
  });

  popup.querySelector('.tpop-send-btn').addEventListener('click', () => {
    const ta  = popup.querySelector('textarea');
    const ctx = ta.value.trim();
    if (!ctx) return;
    setPopupState('loading');
    chrome.runtime.sendMessage({ type: 'RUN_PIPELINE', selectedText, context: ctx });
  });

  // Close on outside click — persistent listener, cleaned up when popup is removed
  function onOutsideClick(e) {
    if (!popup) { document.removeEventListener('mousedown', onOutsideClick); return; }
    if (!popup.contains(e.target)) {
      popup.remove();
      popup = null;
      document.removeEventListener('mousedown', onOutsideClick);
    }
  }
  document.addEventListener('mousedown', onOutsideClick);
}

// ── State renderers ────────────────────────────────────────────────────────────

function setPopupState(state, data = {}) {
  if (!popup) return;
  const body     = popup.querySelector('.tpop-body');
  const topic    = popup.querySelector('.tpop-topic');
  const footer   = popup.querySelector('.tpop-footer');
  const followup = popup.querySelector('#tpop-followup');

  followup.style.display = state === 'loaded' ? '' : 'none';
  footer.style.display   = state === 'loaded' ? '' : 'none';
  if (data.topic) topic.textContent = `· ${data.topic}`;

  switch (state) {
    case 'loading':
      body.innerHTML = `
        <div class="tpop-loading">
          <div class="tpop-skel full"></div>
          <div class="tpop-skel w80"></div>
          <div class="tpop-skel full"></div>
          <div class="tpop-skel w60"></div>
        </div>`;
      break;

    case 'streaming':
      body.innerHTML = `<p class="tpop-summary tpop-streaming">${renderSummary(data.fullText || '')}</p>`;
      break;

    case 'loaded': {
      const confClass = data.confidence?.toLowerCase() === 'high' ? 'conf-high'
                      : data.confidence?.toLowerCase() === 'low'  ? 'conf-low' : 'conf-mid';
      const confPct   = data.confidence?.toLowerCase() === 'high' ? '78%'
                      : data.confidence?.toLowerCase() === 'low'  ? '18%' : '38%';
      body.innerHTML = `
        <p class="tpop-summary">${renderSummary(data.summary || '')}</p>
        <div class="tpop-conf-row">
          <span class="tpop-conf-label">Evidence</span>
          <div class="tpop-conf-wrap"><div class="tpop-conf-bar ${confClass}" style="width:${confPct}"></div></div>
          <span class="tpop-conf-value ${confClass}">${data.confidence || '—'}</span>
        </div>
        <div class="tpop-cites-label">Sources</div>
        ${(data.papers || []).slice(0, 2).map((p, i) => `
          <a class="tpop-cite" href="${escHtml(p.url)}" target="_blank" rel="noopener">
            <div class="tpop-cite-num">${i + 1}</div>
            <div class="tpop-cite-inner">
              <div class="tpop-cite-title">${escHtml(p.title)}</div>
              <div class="tpop-cite-meta"><span class="tpop-badge">${escHtml(p.source)}</span>${escHtml([p.authors?.split(',')[0], p.year].filter(Boolean).join(' · '))}</div>
            </div>
          </a>`).join('')}`;

      const viewAll = popup.querySelector('.tpop-view-all');
      if (data.papers?.length > 2) {
        viewAll.style.display  = '';
        viewAll.textContent    = `View all ${data.papers.length} →`;
      }
      break;
    }

    case 'ai-asks':
      body.innerHTML = `
        <div class="tpop-ai-asks">
          <div class="tpop-ai-question">
            <div class="tpop-ai-dot"></div>
            <div>${escHtml(data.question || 'Could you clarify what you\'d like to verify?')}</div>
          </div>
          <div class="tpop-input-row">
            <textarea placeholder="Clarify your question…" rows="2" id="tpop-clarify-ta"></textarea>
            <button class="tpop-send-btn tpop-clarify-send">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
            </button>
          </div>
        </div>`;
      popup.querySelector('.tpop-clarify-send').addEventListener('click', () => {
        const ta  = popup.querySelector('#tpop-clarify-ta');
        const ctx = ta.value.trim();
        if (!ctx) return;
        setPopupState('loading');
        // Re-run with the original selection + clarification, relaxing filters
        chrome.runtime.sendMessage({
          type:         'RESUME_PIPELINE',
          selectedText: currentSelection,
          query:        ctx,
          papers:       popupPapers ?? [],
          relax:        true,
        });
      });
      break;

    case 'no-sources':
      body.innerHTML = `<div class="tpop-empty">No studies found for this selection. Try rephrasing or selecting a broader passage.</div>`;
      break;

    case 'error':
      body.innerHTML = `<div class="tpop-error">Error: ${escHtml(data.error)}</div>`;
      break;
  }

  positionPopup();
}

// ── Positioning ────────────────────────────────────────────────────────────────

function positionPopup() {
  if (!popup || !lastRange) return;
  const rect    = lastRange.getBoundingClientRect();
  const popW    = 400;
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;

  const popupEl = popup.querySelector('.tpop');
  const popH    = popupEl ? popupEl.offsetHeight : 300;

  // Place above selection, clamped to viewport
  let top  = rect.top  + scrollY - popH - 14;
  let left = rect.left + scrollX + rect.width / 2 - popW * 0.4;
  left     = Math.max(scrollX + 8, Math.min(left, scrollX + window.innerWidth - popW - 8));
  if (top < scrollY + 8) top = rect.bottom + scrollY + 14; // flip below if no room above

  popup.style.cssText = `position:absolute;top:${top}px;left:${left}px;width:${popW}px;z-index:2147483647;`;
}

function renderSummary(text) {
  return escHtml(text).replace(/&lt;mark&gt;(.*?)&lt;\/mark&gt;/gs, '<mark>$1</mark>');
}

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Popup CSS (injected into shadow-DOM-lite via <style> in innerHTML) ─────────

function popupCSS() {
  return `
#truey-popup { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
.tpop {
  background: #fff; border: 1px solid #e0e0e0; border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.14), 0 2px 8px rgba(0,0,0,0.08);
  overflow: hidden; font-size: 14px; position: relative;
}
@media (prefers-color-scheme: dark) {
  .tpop { background: #1e1e1e; border-color: #3a3a3a; color: #e8eaed; }
}
.tpop-header { display:flex; align-items:center; justify-content:space-between; padding:10px 13px 8px; border-bottom:1px solid #e0e0e0; }
.tpop-header-left { display:flex; align-items:center; gap:7px; }
.tpop-dot { width:6px; height:6px; border-radius:50%; background:#1a73e8; }
.tpop-label { font-size:12px; font-weight:700; color:#1a73e8; }
.tpop-topic { font-size:12px; color:#6b7280; }
.tpop-header-right { display:flex; align-items:center; gap:6px; }
.tpop-provider { font-size:10px; color:#6b7280; background:#f1f3f4; padding:2px 6px; border-radius:4px; }
.tpop-close { background:none; border:none; cursor:pointer; color:#6b7280; display:flex; align-items:center; justify-content:center; width:24px; height:24px; border-radius:5px; }
.tpop-close:hover { background:#f1f3f4; }
.tpop-quote { display:flex; gap:8px; align-items:flex-start; padding:10px 13px 0; }
.tpop-quote-bar { width:3px; flex-shrink:0; align-self:stretch; background:#1a73e8; border-radius:99px; opacity:0.4; }
.tpop-quote-text { font-size:12px; color:#6b7280; line-height:1.5; font-style:italic; }
.tpop-body { padding:10px 13px 12px; }
.tpop-summary { font-size:13.5px; line-height:1.62; margin-bottom:10px; }
.tpop-summary mark { background:#e8f0fe; color:#1a73e8; border-radius:3px; padding:0 3px; }
@media (prefers-color-scheme: dark) { .tpop-summary mark { background:#1e3a5f; color:#8ab4f8; } }
.tpop-streaming { opacity:0.8; }
.tpop-loading { padding:4px 0 2px; }
.tpop-skel { height:12px; border-radius:4px; margin-bottom:9px; background:linear-gradient(90deg,#e0e0e0 25%,#f1f3f4 50%,#e0e0e0 75%); background-size:200% 100%; animation:tpop-shimmer 1.4s infinite; }
.tpop-skel.full{width:100%} .tpop-skel.w80{width:80%} .tpop-skel.w60{width:60%}
@keyframes tpop-shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
.tpop-conf-row { display:flex; align-items:center; gap:7px; margin-bottom:10px; }
.tpop-conf-label { font-size:11px; color:#6b7280; }
.tpop-conf-wrap { flex:1; height:3px; background:#e0e0e0; border-radius:99px; overflow:hidden; }
.tpop-conf-bar { height:100%; border-radius:99px; }
.tpop-conf-value { font-size:11px; font-weight:600; }
.conf-high { background:#16a34a; color:#16a34a; } .conf-mid { background:#d97706; color:#d97706; } .conf-low { background:#dc2626; color:#dc2626; }
.tpop-cites-label { font-size:10px; font-weight:600; letter-spacing:0.05em; text-transform:uppercase; color:#6b7280; margin-bottom:5px; }
.tpop-cite { display:flex; gap:8px; align-items:flex-start; padding:6px 0; border-top:1px solid #e0e0e0; text-decoration:none; }
.tpop-cite:hover .tpop-cite-title { text-decoration:underline; }
.tpop-cite-num { flex-shrink:0; width:18px; height:18px; border-radius:50%; background:#e8f0fe; color:#1a73e8; font-size:9px; font-weight:700; display:flex; align-items:center; justify-content:center; margin-top:1px; }
.tpop-cite-inner { flex:1; min-width:0; }
.tpop-cite-title { font-size:12px; color:#1a73e8; line-height:1.35; margin-bottom:1px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.tpop-cite-meta { font-size:10px; color:#6b7280; display:flex; align-items:center; gap:5px; }
.tpop-badge { font-size:9px; font-weight:600; padding:1px 4px; border-radius:3px; background:#f1f3f4; text-transform:uppercase; letter-spacing:0.03em; }
.tpop-followup { border-top:1px solid #e0e0e0; padding:9px 13px; }
.tpop-followup-collapsed { display:flex; align-items:center; gap:7px; cursor:pointer; font-size:12.5px; color:#6b7280; }
.tpop-followup-collapsed:hover { color:#1a73e8; }
.tpop-input-row { display:flex; gap:7px; align-items:flex-end; margin-top:7px; }
.tpop-input-row textarea { flex:1; background:#f8f9fa; border:1px solid #e0e0e0; border-radius:6px; font-size:12.5px; font-family:inherit; padding:7px 9px; resize:none; line-height:1.5; }
.tpop-input-row textarea:focus { outline:none; border-color:#1a73e8; }
.tpop-send-btn { background:#1a73e8; border:none; border-radius:6px; color:#fff; cursor:pointer; display:flex; align-items:center; justify-content:center; width:32px; height:32px; flex-shrink:0; }
.tpop-send-btn:hover { opacity:0.85; }
.tpop-ai-asks { padding:2px 0; }
.tpop-ai-question { display:flex; gap:8px; align-items:flex-start; margin-bottom:10px; font-size:13px; line-height:1.55; }
.tpop-ai-dot { width:6px; height:6px; border-radius:50%; background:#1a73e8; flex-shrink:0; margin-top:5px; }
.tpop-empty,.tpop-error { font-size:13px; color:#6b7280; padding:4px 0 6px; line-height:1.5; }
.tpop-error { color:#dc2626; }
.tpop-footer { display:flex; align-items:center; justify-content:space-between; padding:8px 13px; border-top:1px solid #e0e0e0; background:#f8f9fa; }
.tpop-footer-note { font-size:10px; color:#6b7280; }
.tpop-view-all { font-size:11px; color:#1a73e8; background:none; border:none; cursor:pointer; font-weight:500; }
`;
}

})();
