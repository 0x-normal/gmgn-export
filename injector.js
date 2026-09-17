// Runs in the page's MAIN world — has access to the real window.fetch and XHR.
// Injected once per tab via chrome.scripting.executeScript({ world: 'MAIN' }).
(function () {
  if (window.__gmgnInjected) return;
  window.__gmgnInjected = true;

  // Match any URL path segment containing "trade" (handles /trades, /token_trades, etc.)
  // Update this pattern if gmgn.ai uses a different path once you inspect Network tab.
  const TRADES_PATTERN = /trade/i;

  function maybeForward(url, getBody) {
    if (!TRADES_PATTERN.test(url)) return;
    getBody().then(function (data) {
      window.postMessage({ type: '__GMGN_TRADES', payload: data }, '*');
    }).catch(function () {});
  }

  // ── Wrap fetch ──────────────────────────────────────────────────────────
  var _fetch = window.fetch;
  window.fetch = function () {
    var args = arguments;
    var url = typeof args[0] === 'string'
      ? args[0]
      : (args[0] && args[0].url) ? args[0].url : '';
    return _fetch.apply(this, args).then(function (response) {
      maybeForward(url, function () { return response.clone().json(); });
      return response;
    });
  };

  // ── Wrap XHR ────────────────────────────────────────────────────────────
  var _open = XMLHttpRequest.prototype.open;
  var _send = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url) {
    this.__gmgnUrl = url || '';
    return _open.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function () {
    var self = this;
    if (self.__gmgnUrl && TRADES_PATTERN.test(self.__gmgnUrl)) {
      self.addEventListener('load', function () {
        try {
          var data = JSON.parse(self.responseText);
          window.postMessage({ type: '__GMGN_TRADES', payload: data }, '*');
        } catch (_) {}
      });
    }
    return _send.apply(this, arguments);
  };
})();
