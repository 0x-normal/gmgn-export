// Pure utility functions shared between content.js (browser) and test (Node).
// UMD-lite: exports via module.exports in Node, sets GmgnUtils global in browser.
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.GmgnUtils = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  // ── CSV ────────────────────────────────────────────────────────────────

  function csvEscape(v) {
    if (v === null || v === undefined) return '';
    const s = String(v);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  const CSV_HEADER = 'timestamp,type,mc,amount,totalUSD,gas,trader';

  function formatCSV(trades) {
    const lines = trades.map(t =>
      [t.timestamp, t.type, t.mc, t.amount, t.totalUSD, t.gas, t.trader]
        .map(csvEscape)
        .join(',')
    );
    return [CSV_HEADER, ...lines].join('\n');
  }

  // ── Addresses ──────────────────────────────────────────────────────────
  // EVM: 0x + 40 hex chars (case-insensitive, normalized to lowercase).
  // Solana: base58 string 32-44 chars (case-sensitive, no 0 O I l).

  const EVM_ADDR_RE = /0x[a-fA-F0-9]{40}/;
  const SOL_ADDR_RE = /[1-9A-HJ-NP-Za-km-z]{32,44}/;

  // Pulls the first address (EVM or Solana) out of a string such as an href
  // or URL path. EVM addresses are lowercased; Solana addresses are returned
  // verbatim because base58 is case-sensitive. Returns null if none found.
  function extractAddress(str) {
    if (str === null || str === undefined) return null;
    const s = String(str);
    const evm = s.match(EVM_ADDR_RE);
    if (evm) return evm[0].toLowerCase();
    const sol = s.match(SOL_ADDR_RE);
    return sol ? sol[0] : null;
  }

  // ── URL ────────────────────────────────────────────────────────────────

  function parseTokenUrl(url) {
    const m = String(url).match(/gmgn\.ai\/([^/?#]+)\/token\/([^/?#]+)/);
    if (!m) return null;
    const addr = extractAddress(m[2]);
    if (!addr) return null;
    return { chain: m[1], addr: addr };
  }

  // Profile / wallet page, e.g. gmgn.ai/sol/address/<wallet>
  function parseAddressUrl(url) {
    const m = String(url).match(/gmgn\.ai\/([^/?#]+)\/address\/([^/?#]+)/);
    if (!m) return null;
    const addr = extractAddress(m[2]);
    if (!addr) return null;
    return { chain: m[1], addr: addr };
  }

  // ── Field extraction ───────────────────────────────────────────────────

  function extractField(row, aliases) {
    for (const key of aliases) {
      const v = row[key];
      if (v !== null && v !== undefined) return v;
    }
    return null;
  }

  function findTradeArray(payload) {
    if (Array.isArray(payload)) {
      return payload.length > 0 ? payload : null;
    }
    if (payload && typeof payload === 'object') {
      for (const key of Object.keys(payload)) {
        const result = findTradeArray(payload[key]);
        if (result !== null) return result;
      }
    }
    return null;
  }

  // ── Deduplication ──────────────────────────────────────────────────────

  function tradeKey(t) {
    return `${t.timestamp}|${t.trader}|${t.type}|${t.amount}`;
  }

  return { csvEscape, formatCSV, extractAddress, parseTokenUrl, parseAddressUrl, extractField, findTradeArray, tradeKey };
}));
