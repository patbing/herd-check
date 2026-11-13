/* All network access lives here.
 *   GET  https://gen.pollinations.ai/v1/models            (text models, prices, free or paid-only)
 *   POST https://gen.pollinations.ai/v1/chat/completions  (one call per model per question)
 * The visitor's sk_ key is passed in as an argument; this app never logs or stores it.
 */
(function () {
  'use strict';
  var C = window.HC.config;

  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }

  function listModels() {
    return fetch(C.API + '/v1/models', { credentials: 'omit', cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (j) {
      var arr = (j && (j.data || j.models)) || [];
      return arr.filter(function (m) {
        var eps = m.supported_endpoints || [], p = m.pricing || {};
        return m.category === 'text' && !m.community && eps.indexOf('/v1/chat/completions') >= 0 &&
          p.completionTextTokens && !(m.health && m.health.status === 'down');
      }).map(function (m) {
        var p = m.pricing, sp = m.supported_parameters || [];
        return {
          id: m.id, title: m.title || m.id,
          inPrice: num(p.promptTextTokens), outPrice: num(p.completionTextTokens),
          paidOnly: !!m.paid_only, effort: sp.indexOf('reasoning_effort') >= 0, json: sp.indexOf('response_format') >= 0
        };
      }).sort(function (a, b) { return (a.paidOnly - b.paidOnly) || ((a.inPrice + a.outPrice) - (b.inPrice + b.outPrice)); });
    });
  }

  function costOf(model, usage) {
    if (!model || !usage) return null;
    var pt = usage.prompt_tokens, ct = usage.completion_tokens;
    if (!Number.isFinite(pt) || !Number.isFinite(ct)) return null;
    return pt * model.inPrice + ct * model.outPrice;
  }

  function once(key, body, signal) {
    // A retry must not go out after Stop: an already-aborted signal never fires 'abort' again.
    if (signal && signal.aborted) return Promise.resolve({ ok: false, status: 0, ms: 0, error: 'cancelled', cancelled: true });
    var ctrl = new AbortController(), timedOut = false, t0 = Date.now();
    var timer = setTimeout(function () { timedOut = true; ctrl.abort(); }, C.TIMEOUT_MS);
    function stop() { ctrl.abort(); }
    if (signal) signal.addEventListener('abort', stop, { once: true });
    return fetch(C.API + '/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: JSON.stringify(body), credentials: 'omit', cache: 'no-store', signal: ctrl.signal
    }).then(function (res) {
      return res.text().then(function (txt) {
        var j = null; try { j = JSON.parse(txt); } catch (e) { /* not JSON */ }
        var ms = Date.now() - t0;
        if (!res.ok) {
          var msg = (j && j.error && (j.error.message || j.error)) || txt.slice(0, 200) || ('HTTP ' + res.status);
          return { ok: false, status: res.status, ms: ms, error: 'HTTP ' + res.status + ': ' + String(msg).slice(0, 200), retryAfter: num(res.headers.get('Retry-After')) };
        }
        var choice = j && j.choices && j.choices[0];
        var text = choice && choice.message && typeof choice.message.content === 'string' ? choice.message.content : '';
        return { ok: true, status: res.status, ms: ms, text: text, usage: j && j.usage };
      });
    }).catch(function (e) {
      var ms = Date.now() - t0;
      if (signal && signal.aborted && !timedOut) return { ok: false, status: 0, ms: ms, error: 'cancelled', cancelled: true };
      return { ok: false, status: 0, ms: ms, error: timedOut ? 'timed out' : String((e && e.message) || e) };
    }).then(function (r) {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', stop);
      return r;
    });
  }

  // One retry for network errors, timeouts, 429 and 5xx. Resolves to { text } or { error }, plus the request, ms, usage and cost.
  function ask(key, model, messages, signal) {
    // Same body as tools/record.mjs; a fresh seed because Pollinations caches identical bodies.
    var body = window.HC.quiz.request(model, messages, Math.floor(Math.random() * 2147483647));
    return once(key, body, signal).then(function (r) {
      var retry = !r.ok && !r.cancelled && (r.status === 0 || r.status === 429 || r.status >= 500);
      r.tries = 1;
      if (!retry) return r;
      var wait = r.status === 429 ? Math.min((r.retryAfter || 3) * 1000, 15000) : 1500;
      return new Promise(function (ok) { setTimeout(ok, wait); }).then(function () { return once(key, body, signal); }).then(function (r2) { r2.tries = 2; return r2; });
    }).then(function (r) {
      if (!r.ok) return { error: r.error, ms: r.ms, cancelled: !!r.cancelled, status: r.status, request: body, tries: r.tries || 1 };
      var cost = costOf(model, r.usage);
      return { text: r.text, ms: r.ms, cost: cost, request: body, usage: r.usage };
    });
  }

  window.HC.net = { listModels: listModels, ask: ask, costOf: costOf };
})();
