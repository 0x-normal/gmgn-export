// content.js — runs in the isolated extension world on gmgn.ai token & wallet pages.
// Scrapes trade rows from three places:
//   • token page  — the virtual-list activity table
//   • wallet page  — the profile activity table
//   • side-panel drawer — a single token's trades for one wallet (preferred when open)

(function () {
  // Guard against duplicate injection (popup can re-inject on Refresh).
  if (window.__gmgnContentLoaded) return;
  window.__gmgnContentLoaded = true;

  // ── State ────────────────────────────────────────────────────────────────
  var trades = [];
  var seen = new Set();
  var scraping = false;
  var done = false;
  var scrollTimer = null;
  var observer = null;
  var scrapeStartTime = 0;
  var paused = false;         // user paused; data is held until Resume
  var tokenSet = new Set();   // distinct token mints captured (progress display)

  var SCROLL_INTERVAL_MS = 700;
  var SCROLL_STEP_PX = 300;
  var MAX_SCRAPE_MS = 30 * 60 * 1000;
  var NO_TRADES_TIMEOUT_MS = 15 * 1000;

  // ── DOM helpers ──────────────────────────────────────────────────────────
  function textOf(el) { return el ? el.textContent.trim() : null; }
  function addrFromHref(href) { return GmgnUtils.extractAddress(href); }

  // ── Page / drawer detection ──────────────────────────────────────────────
  function isProfilePage() { return !!GmgnUtils.parseAddressUrl(window.location.href); }
  function profileAddr() {
    var p = GmgnUtils.parseAddressUrl(window.location.href);
    return p ? p.addr : null;
  }
  // The single-token side panel.
  function drawerRoot() { return document.querySelector('.pi-drawer-content'); }
  function isDrawerOpen() {
    var d = drawerRoot();
    return !!(d && d.querySelector('.g-table-tbody tr.g-table-row'));
  }
  function drawerToken() {
    var d = drawerRoot();
    var a = d && d.querySelector('a[href*="/token/"]');
    if (!a) return null;
    return { mint: GmgnUtils.extractAddress(a.getAttribute('href')), symbol: textOf(a) };
  }
  function drawerWallet() {
    var d = drawerRoot();
    var a = d && d.querySelector('a[href*="/address/"]');
    return a ? GmgnUtils.extractAddress(a.getAttribute('href')) : null;
  }

  // ── Header-driven table scraping (drawer + profile) ──────────────────────
  // Locate columns by their <thead> label so we survive GMGN reordering columns
  // or adding extra ones (Profit, Token, …) between views.
  function columnMap(root) {
    var ths = root.querySelectorAll('.g-table-thead th');
    var map = {};
    ths.forEach(function (th, i) {
      var t = (th.textContent || '').trim().toLowerCase();
      if (map.type   === undefined && /type/.test(t)) map.type = i;
      if (map.mc     === undefined && /(^mc|market|price)/.test(t)) map.mc = i;
      if (map.amount === undefined && /amount/.test(t)) map.amount = i;
      if (map.total  === undefined && /total/.test(t)) map.total = i;
      if (map.gas    === undefined && /gas/.test(t)) map.gas = i;
      if (map.time   === undefined && /(time|age)/.test(t)) map.time = i;
    });
    return map;
  }
  function cellText(tds, i) {
    if (i === undefined || !tds[i]) return null;
    var td = tds[i];
    var v = td.querySelector('[data-sentry-component="ColumnMCPriceView"]') ||
            td.querySelector('[data-sentry-component="TotalCellView"]') ||
            td.querySelector('[data-sentry-component="GasView"]') ||
            td.querySelector('div');
    return textOf(v || td);
  }
  function scrapeTable(root, trader) {
    var map = columnMap(root);
    if (map.type === undefined) return; // headers not rendered yet
    var rows = root.querySelectorAll('.g-table-tbody tr.g-table-row');
    rows.forEach(function (row) {
      var tds = row.querySelectorAll(':scope > td');
      if (!tds.length) return;
      var timestamp = cellText(tds, map.time);
      var type      = cellText(tds, map.type);
      var amount    = cellText(tds, map.amount);
      var totalUSD  = cellText(tds, map.total);
      // Each trade has a unique solscan tx link → stable dedup key.
      var txLink = row.querySelector('a[href*="/tx/"]');
      var key = txLink ? ('tx:' + txLink.getAttribute('href'))
                       : ('row:' + [timestamp, type, amount, totalUSD].join('|'));
      if (seen.has(key)) return;
      if (!type && !timestamp) return;
      seen.add(key);
      trades.push({ timestamp: timestamp, type: type, mc: cellText(tds, map.mc),
                    amount: amount, totalUSD: totalUSD, gas: cellText(tds, map.gas), trader: trader });
    });
  }
  function scrapeDrawerRows() {
    var root = drawerRoot();
    if (!root) return;
    scrapeTable(root, drawerWallet() || profileAddr());
    var t = drawerToken();
    if (t && t.mint) tokenSet.add(t.mint);
  }
  function scrapeProfileRows() {
    scrapeTable(document, profileAddr());
  }

  // ── Token-page virtual-list scraping ─────────────────────────────────────
  function scrapeTokenRows() {
    var wrappers = document.querySelectorAll('.g-table-body [data-index]');
    wrappers.forEach(function (wrapper) {
      var seenKey = 'idx:' + wrapper.getAttribute('data-index');
      if (seen.has(seenKey)) return;
      var row = wrapper.querySelector('[data-testid="token-detail-activity-row"]');
      if (!row) return;
      var flexRow = row.querySelector('.flex.flex-row');
      if (!flexRow) return;
      var cols = flexRow.children;
      if (cols.length < 6) return;

      var timestamp = textOf(cols[0].querySelector('.flex'));
      var type = textOf(cols[1].querySelector('div'));
      var mc = textOf(cols[2].querySelector('[data-sentry-component="ColumnMCPriceView"]') || cols[2].querySelector('div'));
      var amount = textOf(cols[3].querySelector('div'));
      var totalUSD = textOf(cols[4].querySelector('[data-sentry-component="TotalCellView"]') || cols[4].querySelector('div'));
      var gas = textOf(cols[5].querySelector('[data-sentry-component="GasView"]') || cols[5].querySelector('div'));
      var traderLink = cols[6] ? cols[6].querySelector('a[href*="/address/"]') : null;
      var trader = traderLink ? addrFromHref(traderLink.getAttribute('href')) : null;
      if (!timestamp && !trader) return;

      seen.add(seenKey);
      trades.push({ timestamp: timestamp, type: type, mc: mc,
                    amount: amount, totalUSD: totalUSD, gas: gas, trader: trader });
    });
  }

  // Pick the right scraper for what's on screen (drawer wins when open).
  function scrapeVisibleRows() {
    if (isDrawerOpen()) scrapeDrawerRows();
    else if (isProfilePage()) scrapeProfileRows();
    else scrapeTokenRows();
  }

  // ── Scroll container ─────────────────────────────────────────────────────
  function scrollableAncestor(seed, fallback) {
    var el = seed ? seed.parentElement : null;
    while (el && el !== document.body) {
      var s = window.getComputedStyle(el);
      if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 4) return el;
      el = el.parentElement;
    }
    return fallback || document.scrollingElement || document.documentElement;
  }
  function findScrollContainer() {
    if (isDrawerOpen()) {
      var root = drawerRoot();
      var seed = root.querySelector('.g-table-tbody tr.g-table-row');
      return scrollableAncestor(seed, root.querySelector('.pi-drawer-body') || root);
    }
    var el = document.querySelector('.g-table-body');
    if (el) return el; // token page virtual list
    var seedP = document.querySelector('[data-testid="token-detail-activity-row"]') ||
                document.querySelector('.g-table-tbody tr.g-table-row');
    return scrollableAncestor(seedP, document.scrollingElement || document.documentElement);
  }

  // Some lists paginate behind a "show more" footer instead of infinite scroll.
  function clickShowMore() {
    var scope = isDrawerOpen() ? drawerRoot() : document;
    var foot = scope.querySelector('[data-sentry-component="ListFooter"]');
    if (!foot || foot.classList.contains('hidden') || foot.offsetParent === null) return false;
    var btn = foot.querySelector('.cursor-pointer') || foot;
    btn.click();
    return true;
  }

  // ── Observer + scroll listener ───────────────────────────────────────────
  function setupObserver() {
    var ct = findScrollContainer();
    if (!ct) return;
    ct.addEventListener('scroll', scrapeVisibleRows);

    observer = new MutationObserver(scrapeVisibleRows);
    if (isDrawerOpen()) {
      observer.observe(drawerRoot().querySelector('.g-table-tbody') || ct, { childList: true, subtree: true });
    } else if (isProfilePage()) {
      observer.observe(document.querySelector('.g-table-tbody') || ct, { childList: true, subtree: true });
    } else {
      observer.observe(ct.firstElementChild || ct, { childList: true, subtree: false });
    }
  }
  function teardownObserver() {
    var ct = findScrollContainer();
    if (ct) ct.removeEventListener('scroll', scrapeVisibleRows);
    if (observer) { observer.disconnect(); observer = null; }
  }

  // ── Scrape session: Start / Pause / Resume / Reset ───────────────────────
  // Collecting stays alive (never auto-stops) so you can keep opening token
  // drawers and accumulate into one dataset. Pause holds the data; Resume
  // continues into the same dataset; Start begins a fresh one.

  function startScraping() {
    if (scraping) return;
    trades = [];
    seen = new Set();
    tokenSet = new Set();
    scraping = true;
    paused = false;
    done = false;
    runLoop();
  }

  function resumeScraping() {
    if (scraping) return;          // already running
    scraping = true;
    paused = false;
    done = false;
    runLoop();                     // keep existing trades/seen → accumulate
  }

  function pauseScraping() {
    if (scrollTimer) { clearInterval(scrollTimer); scrollTimer = null; }
    teardownObserver();
    scraping = false;
    paused = true;
  }

  function resetScraping() {
    pauseScraping();
    trades = [];
    seen = new Set();
    tokenSet = new Set();
    paused = false;
    done = false;
  }

  function runLoop() {
    scrapeStartTime = Date.now();
    setupObserver();

    var ct = findScrollContainer();
    if (ct) ct.scrollTop = 0;
    var prevScrollHeight = 0;

    scrollTimer = setInterval(function () {
      var elapsed = Date.now() - scrapeStartTime;
      if (elapsed > MAX_SCRAPE_MS) { pauseScraping(); return; }
      if (elapsed > NO_TRADES_TIMEOUT_MS && trades.length === 0) { pauseScraping(); return; }

      scrapeVisibleRows();

      var ct = findScrollContainer();
      var sh = ct.scrollHeight;
      var atBottom = ct.scrollTop >= sh - ct.clientHeight - 5;

      if (!atBottom) {
        prevScrollHeight = sh;
        ct.scrollTop += SCROLL_STEP_PX;
        return;
      }
      // At the bottom — load more if there's a "show more", else chase lazy rows.
      if (clickShowMore()) return;
      if (sh > prevScrollHeight) {
        prevScrollHeight = sh;
        ct.scrollTop += SCROLL_STEP_PX;
      }
      // Otherwise idle here and stay alive — opening another drawer keeps adding.
    }, SCROLL_INTERVAL_MS);
  }

  // ── Status / filename ────────────────────────────────────────────────────
  function getStatus() {
    return { count: trades.length, scraping: scraping, paused: paused, done: done,
             tokens: tokenSet.size, suggestedFilename: buildFilename() };
  }
  function buildFilename() {
    var page = GmgnUtils.parseTokenUrl(window.location.href) || GmgnUtils.parseAddressUrl(window.location.href);
    var chain = page ? page.chain : 'sol';
    var date = new Date().toISOString().slice(0, 10);
    if (tokenSet.size > 1) {
      // Accumulated many tokens for one wallet → name by wallet.
      var w = drawerWallet() || (page ? page.addr : null);
      return (w ? ('trades_' + chain + '_' + w + '_multi') : 'trades_multi') + '_' + date + '.csv';
    }
    var tok = isDrawerOpen() ? drawerToken() : null;        // single drawer → name by token
    var addr = (tok && tok.mint) ? tok.mint : (page ? page.addr : null);
    return (addr ? ('trades_' + chain + '_' + addr) : 'trades') + '_' + date + '.csv';
  }

  // ── Respond to popup messages ────────────────────────────────────────────
  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (msg.action === 'start') {
      startScraping();
      sendResponse(getStatus());
    } else if (msg.action === 'pause' || msg.action === 'stop') {
      pauseScraping();
      sendResponse(getStatus());
    } else if (msg.action === 'resume') {
      resumeScraping();
      sendResponse(getStatus());
    } else if (msg.action === 'reset') {
      resetScraping();
      sendResponse(getStatus());
    } else if (msg.action === 'status') {
      sendResponse(getStatus());
    } else if (msg.action === 'export') {
      sendResponse({ csv: GmgnUtils.formatCSV(trades), filename: buildFilename() });
    }
    return true;
  });
})();
