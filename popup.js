var activeTabId = null;
var activeTabUrl = null;
var pollTimer = null;

var elTokenInfo     = document.getElementById('token-info');
var elBtnRefresh    = document.getElementById('btn-refresh');
var elBtnStart      = document.getElementById('btn-start');
var elBtnPause      = document.getElementById('btn-pause');
var elBtnResume     = document.getElementById('btn-resume');
var elBtnExport     = document.getElementById('btn-export');
var elStatus        = document.getElementById('status');
var elFilenameRow   = document.getElementById('filename-row');
var elFilenameInput = document.getElementById('filename-input');
var elHoldHint      = document.getElementById('hold-hint');

// ── URL parser (token & wallet pages; EVM 0x… + Solana base58) ──────────────
function matchAddr(seg) {
  var evm = seg.match(/0x[a-fA-F0-9]{40}/);
  if (evm) return evm[0].toLowerCase();
  var sol = seg.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/);
  return sol ? sol[0] : null;
}
function parseGmgnPage(url) {
  var s = String(url || '');
  var m = s.match(/gmgn\.ai\/([^/?#]+)\/token\/([^/?#]+)/);
  if (m) { var a = matchAddr(m[2]); if (a) return { kind: 'token', chain: m[1], addr: a }; }
  m = s.match(/gmgn\.ai\/([^/?#]+)\/address\/([^/?#]+)/);
  if (m) { var a2 = matchAddr(m[2]); if (a2) return { kind: 'address', chain: m[1], addr: a2 }; }
  return null;
}

// ── UI state ────────────────────────────────────────────────────────────────
function renderStatus(s) {
  if (!s) return;
  var hasData = s.count > 0;
  var tokensTxt = s.tokens ? (' · ' + s.tokens + ' tokens') : '';

  if (s.scraping) {
    elBtnStart.style.display    = 'none';
    elBtnResume.style.display   = 'none';
    elHoldHint.style.display    = 'none';
    elBtnPause.style.display    = 'block';
    elBtnExport.style.display   = hasData ? 'block' : 'none';
    elFilenameRow.style.display = hasData ? 'block' : 'none';
    if (hasData && !elFilenameInput.value && s.suggestedFilename) elFilenameInput.value = s.suggestedFilename;
    elStatus.textContent = 'Collecting… ' + s.count + ' rows' + tokensTxt;
  } else if (hasData) {
    // Paused with data held — keep adding (Resume) or finish (Export).
    elBtnStart.style.display    = 'none';
    elBtnPause.style.display    = 'none';
    elBtnResume.style.display   = 'block';
    elBtnExport.style.display   = 'block';
    elHoldHint.style.display    = 'block';
    elFilenameRow.style.display = 'block';
    if (!elFilenameInput.value && s.suggestedFilename) elFilenameInput.value = s.suggestedFilename;
    elStatus.textContent = 'Paused — ' + s.count + ' rows' + tokensTxt +
      '. Open another token then Resume, or Export.';
  } else {
    elBtnStart.style.display    = 'block';
    elBtnPause.style.display    = 'none';
    elBtnResume.style.display   = 'none';
    elBtnExport.style.display   = 'none';
    elHoldHint.style.display    = 'block';
    elFilenameRow.style.display = 'none';
    elStatus.textContent = s.done
      ? 'No trades found — open a trade table, then Start'
      : 'Ready — open a token/drawer, then Start';
  }
}

// ── Polling while scraping ───────────────────────────────────────────────────
function startPolling() {
  stopPolling();
  pollTimer = setInterval(function () {
    chrome.tabs.sendMessage(activeTabId, { action: 'status' }, function (s) {
      if (chrome.runtime.lastError || !s) { stopPolling(); return; }
      renderStatus(s);
      if (!s.scraping) stopPolling();
    });
  }, 500);
}
function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

// ── Button handlers ───────────────────────────────────────────────────────────
elBtnStart.addEventListener('click', function () {
  elBtnStart.disabled = true;
  elFilenameInput.value = '';
  elStatus.textContent = 'Starting…';
  chrome.tabs.sendMessage(activeTabId, { action: 'start' }, function (s) {
    elBtnStart.disabled = false;
    if (chrome.runtime.lastError || !s) { elStatus.textContent = 'Start failed — reload the page and try again'; return; }
    renderStatus(s);
    startPolling();
  });
});

elBtnResume.addEventListener('click', function () {
  chrome.tabs.sendMessage(activeTabId, { action: 'resume' }, function (s) {
    if (chrome.runtime.lastError || !s) { elStatus.textContent = 'Resume failed — reload the page'; return; }
    renderStatus(s);
    startPolling();
  });
});

elBtnPause.addEventListener('click', function () {
  stopPolling();
  chrome.tabs.sendMessage(activeTabId, { action: 'pause' }, function (s) {
    if (chrome.runtime.lastError) return;
    renderStatus(s);
  });
});

elBtnExport.addEventListener('click', function () {
  chrome.tabs.sendMessage(activeTabId, { action: 'export' }, function (res) {
    if (chrome.runtime.lastError || !res || !res.csv) { elStatus.textContent = 'Export failed — no data'; return; }
    var raw = elFilenameInput.value.trim() || res.filename;
    var filename = raw.toLowerCase().endsWith('.csv') ? raw : raw + '.csv';
    var blob = new Blob(['﻿' + res.csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    chrome.downloads.download({ url: url, filename: filename, saveAs: false }, function () {
      URL.revokeObjectURL(url);
      elStatus.textContent = 'Saved: ' + filename;
    });
  });
});

// ── Content-script connection ─────────────────────────────────────────────────
// Pings the content script; if missing (SPA navigation never triggered injection),
// inject it on demand and retry — no full page reload required.
function ensureContentScript(opts, cb) {
  var pingAction = opts.reset ? 'reset' : 'status';
  chrome.tabs.sendMessage(activeTabId, { action: pingAction }, function (s) {
    if (!chrome.runtime.lastError && s) { cb(s); return; }
    chrome.scripting.executeScript(
      { target: { tabId: activeTabId }, files: ['lib/utils.js', 'content.js'] },
      function () {
        if (chrome.runtime.lastError) { cb(null); return; }
        setTimeout(function () {
          chrome.tabs.sendMessage(activeTabId, { action: pingAction }, function (s2) {
            cb(chrome.runtime.lastError ? null : s2);
          });
        }, 150);
      }
    );
  });
}

// ── Detect the active tab's page and sync UI ──────────────────────────────────
function refresh(opts) {
  opts = opts || {};
  stopPolling();

  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    var tab = tabs[0];
    if (!tab) return;
    activeTabId  = tab.id;
    activeTabUrl = tab.url;

    var page = parseGmgnPage(tab.url);
    if (!page) {
      elTokenInfo.textContent     = 'Not a token or wallet page';
      elBtnStart.disabled         = true;
      elBtnPause.style.display    = 'none';
      elBtnResume.style.display   = 'none';
      elBtnExport.style.display   = 'none';
      elFilenameRow.style.display = 'none';
      elHoldHint.style.display    = 'none';
      elStatus.textContent        = 'Open a gmgn.ai token or wallet page, then Refresh';
      return;
    }

    elTokenInfo.textContent = page.chain + ' · ' + (page.kind === 'address' ? 'wallet ' : '') +
      page.addr.slice(0, 8) + '…' + page.addr.slice(-6);
    elStatus.textContent = opts.reset ? 'Re-detecting…' : 'Detecting…';

    ensureContentScript(opts, function (s) {
      if (!s) {
        elStatus.textContent = 'Could not connect — try reloading the page';
        elBtnStart.disabled  = true;
        return;
      }
      elBtnStart.disabled = false;
      if (opts.reset) elFilenameInput.value = '';
      renderStatus(s);
      if (s.scraping) startPolling();
    });
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────
elBtnRefresh.addEventListener('click', function () { refresh({ reset: true }); });
refresh();
