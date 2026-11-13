/* Herd Check: the page. Model text is only ever inserted with textContent. */
(function () {
  'use strict';
  var C = window.HC.config, Q = window.HC.quiz, N = window.HC.net;
  var STORE = 'herd-check-v1';
  var FAMILY = { weekday: 'Weekday', letters: 'Letter count', product: 'Multiplication', count: 'Counting', reverse: 'Backwards', lure: 'Trick question' };
  var STATUS = { right: 'right', wrong: 'wrong', empty: 'empty reply', format: 'no ANSWER line', error: 'request failed' };

  var app = {
    rec: null, evals: [], byRound: {}, cur: null, notice: '',
    key: null, models: [], byId: {}, modelsError: null,
    live: { families: Q.FAMILIES.slice(), models: null, n: 3, level: 2, rounds: [], evals: [] },
    busy: false, stopAsked: false, ctrl: null, spent: 0, capSpent: 0
  };

  function $(id) { return document.getElementById(id); }
  function h(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function fmtP(x) { return (x < 0.001 ? x.toFixed(5) : x.toFixed(4)) + ' P'; }
  function fmtV(v) { return typeof v === 'number' ? String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',') : String(v); }
  function title(id) {
    var m = (app.rec && app.rec.models.filter(function (x) { return x.id === id; })[0]) || app.byId[id];
    return (m && m.title) || id;
  }
  function store() { try { var s = JSON.parse(localStorage.getItem(STORE)); return s && s.picks && typeof s.picks === 'object' ? s : { picks: {} }; } catch (e) { return { picks: {} }; } }
  function save(s) { try { localStorage.setItem(STORE, JSON.stringify(s)); } catch (e) { /* private mode: nothing kept */ } }
  function getJSON(url) { return fetch(url, { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error(url + ': HTTP ' + r.status); return r.json(); }); }

  // ---------- recorded rounds ----------
  function load() {
    return getJSON('recordings/rounds.json').then(function (rec) {
      app.rec = rec;
      app.evals = rec.rounds.map(Q.evaluate);
      app.evals.forEach(function (e) { app.byRound[e.id] = e; });
      // ?round=q07 opens one recorded round.
      var want = /[?&]round=([qh]\d+)/.exec(location.search);
      if (want && app.byRound[want[1]]) start(app.byRound[want[1]]); else deal();
    }).catch(function (e) { app.notice = 'Could not load the recorded rounds: ' + e.message; });
  }

  // Live rounds waiting for a pick come first, then unseen recorded rounds.
  function deal() {
    var picks = store().picks;
    var waiting = app.live.evals.filter(function (e) { return !e.picked; });
    if (waiting.length) return start(waiting[0]);
    var fresh = app.evals.filter(function (e) { return !picks[e.id]; });
    // Close votes first: most rounds are near-unanimous, so a random pick would rarely show a split.
    var pool = (fresh.length ? fresh : app.evals).slice().sort(function (a, b) { return a.herd.size - b.herd.size; }).slice(0, 6);
    if (pool.length) start(pool[Math.floor(Math.random() * pool.length)]);
  }
  function start(e) {
    var p = !e.live && store().picks[e.id];
    app.cur = { e: e, pick: p ? p.pick : null, revealed: !!p };
    $('play').hidden = false;
  }
  function nextRound(ev) { if (!ev.isTrusted) return; deal(); render(); $('play').scrollIntoView({ block: 'start' }); }

  function truthGiven(e) { return e.verdicts.some(function (v) { return v.status === 'right'; }); }
  function pickRight(e, pick) { return pick === '__none' ? !truthGiven(e) : pick === e.q.truth; }

  function choose(value) {
    return function (ev) {
      var c = app.cur;
      if (!ev.isTrusted || !c || c.revealed) return;
      c.pick = value; c.revealed = true;
      if (c.e.live) { c.e.picked = { pick: value, right: pickRight(c.e, value) }; }
      else { var s = store(); s.picks[c.e.id] = { pick: value, right: pickRight(c.e, value) }; save(s); }
      render();
    };
  }

  // ---------- the round ----------
  function renderRound() {
    var c = app.cur; if (!c) return;
    var e = c.e, q = e.q, t = Q.tally(e.verdicts);
    var picks = store().picks, seen = app.evals.filter(function (x) { return picks[x.id]; }).length;
    $('roundmeta').textContent = (e.live ? 'Your live question ' + e.id.slice(1) + ' · seed ' + e.round.seed : 'Round ' + e.id) + ' · ' + FAMILY[q.family] + (q.level === 3 ? (e.live ? ' · level 3' : ' (harder set)') : '') +
      ' · ' + e.verdicts.length + ' models, one call each' + (e.live ? '' : ' · you have played ' + seen + ' of ' + app.evals.length);
    $('question').textContent = q.prompt;
    $('message').textContent = q.message;
    $('votehead').textContent = c.revealed ? 'The vote, with names' : 'How the models voted (names hidden). Which answer do you trust?';
    var list = $('vote'); list.textContent = '';
    var max = t.rows.reduce(function (m, r) { return Math.max(m, r.count); }, 1);
    var rows = t.rows.slice();
    if (c.revealed && !truthGiven(e)) rows.push({ value: q.truth, count: 0, missing: true });
    rows.forEach(function (r) {
      var li = h('li', 'vrow');
      var isTruth = r.value === q.truth, isHerd = e.herd.value != null && r.value === e.herd.value;
      if (c.revealed) li.classList.add(isTruth ? 'truth' : 'nottruth');
      var btn = h('button', 'vbtn'); btn.type = 'button'; btn.disabled = c.revealed;
      btn.appendChild(h('span', 'vval', fmtV(r.value)));
      var bar = h('span', 'vbar'); var fill = h('span', 'vfill'); fill.style.width = (100 * r.count / max) + '%'; bar.appendChild(fill); btn.appendChild(bar);
      btn.appendChild(h('span', 'vcount', r.missing ? 'nobody' : String(r.count)));
      btn.setAttribute('aria-label', fmtV(r.value) + ', ' + r.count + ' vote' + (r.count === 1 ? '' : 's'));
      if (!c.revealed) btn.addEventListener('click', choose(r.value));
      li.appendChild(btn);
      if (c.revealed) {
        var tags = h('p', 'vtags');
        if (isTruth) tags.appendChild(h('span', 'chip ok', 'the truth'));
        if (isHerd) tags.appendChild(h('span', 'chip herd', 'the herd'));
        if (c.pick === r.value) tags.appendChild(h('span', 'chip you', 'your pick'));
        var lure = e.verdicts.filter(function (v) { return v.value === r.value && v.lure; })[0];
        if (lure) tags.appendChild(h('span', 'chip lure', 'shortcut: ' + lure.lure));
        var who = e.verdicts.filter(function (v) { return (v.status === 'right' || v.status === 'wrong') && v.value === r.value; }).map(function (v) { return title(v.model); });
        if (who.length) tags.appendChild(h('span', 'who', who.join(' · ')));
        li.appendChild(tags);
      }
      list.appendChild(li);
    });
    if (t.none) {
      var nli = h('li', 'vrow none');
      nli.appendChild(h('span', 'vnone', 'no answer: ' + t.none + (c.revealed ? ' · ' + e.verdicts.filter(function (v) { return v.status !== 'right' && v.status !== 'wrong'; }).map(function (v) { return title(v.model) + ' (' + STATUS[v.status] + ')'; }).join(' · ') : ' (empty, no ANSWER line, or a failed request)')));
      list.appendChild(nli);
    }
    if (!c.revealed) {
      var li2 = h('li', 'vrow'); var nb = h('button', 'ghost', 'None of these is right'); nb.type = 'button'; nb.addEventListener('click', choose('__none')); li2.appendChild(nb); list.appendChild(li2);
    }
    renderReveal(c);
    $('roundlink').hidden = !!e.live;
    $('roundlink').href = '?round=' + e.id;
    renderScore();
  }

  function renderReveal(c) {
    var box = $('reveal'); box.textContent = '';
    if (!c.revealed) return;
    var e = c.e, q = e.q;
    var right = pickRight(e, c.pick);
    var line = h('p', 'big');
    line.textContent = (c.pick === '__none' ? 'You said none of these is right: ' : 'You picked ' + fmtV(c.pick) + ': ') + (right ? 'right.' : 'not right.') + ' ' +
      (e.herdStatus === 'right' ? 'The herd was right (' + e.herd.size + ' of ' + e.herd.n + ').' :
        e.herdStatus === 'wrong' ? 'The herd was wrong: ' + e.herd.size + ' of ' + e.herd.n + ' said ' + fmtV(e.herd.value) + ', the answer is ' + fmtV(q.truth) + '.' :
          (e.herd.size >= 2 ? 'There was no herd: two answers tied at ' + e.herd.size + ' votes each.' : 'There was no herd: no answer had two votes.'));
    box.appendChild(line);
    box.appendChild(h('p', 'show', 'Working: ' + q.show));
    var alone = e.verdicts.filter(function (v) { return v.status === 'right'; });
    if (e.herdStatus !== 'right' && alone.length) box.appendChild(h('p', null, 'Right without the herd: ' + alone.map(function (v) { return title(v.model); }).join(', ') + '.'));
    var shared = new Map();
    e.verdicts.forEach(function (v) { if (v.status === 'wrong') shared.set(v.value, (shared.get(v.value) || []).concat([title(v.model)])); });
    shared.forEach(function (who, val) { if (who.length > 1) box.appendChild(h('p', null, 'Same wrong answer, ' + fmtV(val) + ': ' + who.join(', ') + '.')); });

    var d = h('details', 'req'); d.appendChild(h('summary', null, 'The actual requests (' + e.round.calls.length + ')'));
    e.round.calls.forEach(function (call, i) {
      var v = e.verdicts[i], r = call.request || {}, u = call.usage || {};
      var item = h('div', 'call');
      item.appendChild(h('p', 'callhead', title(call.model) + ' · ' + STATUS[v.status] + (v.value != null ? ' · ' + fmtV(v.value) : '')));
      item.appendChild(h('p', 'fine', 'model ' + call.model + ' · max_tokens ' + r.max_tokens + (r.reasoning_effort ? ' · reasoning_effort ' + r.reasoning_effort : '') + ' · seed ' + r.seed +
        (u.in != null ? ' · tokens in ' + u.in + ', out ' + u.out + (u.reasoning ? ' (reasoning ' + u.reasoning + ')' : '') : '') +
        (call.cost != null ? ' · ' + fmtP(call.cost) : '') + (call.ms ? ' · ' + (call.ms / 1000).toFixed(1) + ' s' : '')));
      item.appendChild(h('pre', 'prompt', call.error != null ? call.error : (call.raw === '' ? '(empty reply)' : call.raw)));
      d.appendChild(item);
    });
    box.appendChild(d);
  }

  function renderScore() {
    var picks = store().picks, ids = Object.keys(picks).filter(function (id) { return app.byRound[id]; });
    var el = $('score');
    if (!ids.length) { el.textContent = ''; return; }
    var you = ids.filter(function (id) { return picks[id].right; }).length;
    var herd = ids.filter(function (id) { return app.byRound[id].herdStatus === 'right'; }).length;
    var s = Q.stats(ids.map(function (id) { return app.byRound[id]; }), app.rec.models.map(function (m) { return m.id; }));
    el.textContent = 'You ' + you + '/' + ids.length + ' · Herd ' + herd + '/' + ids.length + ' · best single model ' + s.bestRight + '/' + ids.length +
      (s.best.length ? ' (' + s.best.slice(0, 2).map(title).join(', ') + (s.best.length > 2 ? ' and ' + (s.best.length - 2) + ' more' : '') + ')' : '');
  }

  // ---------- results ----------
  function table(head, rows, cls) {
    var t = h('table', cls || 'stats'), tr = h('tr');
    head.forEach(function (x) { tr.appendChild(h('th', null, x)); }); t.appendChild(tr);
    rows.forEach(function (r) { var row = h('tr'); r.forEach(function (x) { var td = h('td'); if (x && x.nodeType) td.appendChild(x); else td.textContent = x; row.appendChild(td); }); t.appendChild(row); });
    var wrap = h('div', 'scroll'); wrap.appendChild(t); return wrap;
  }
  function roundLink(id) { var a = h('a', null, id); a.href = '?round=' + id; return a; }
  function pct(k, n) { return n ? Math.round(100 * k / n) + '%' : '-'; }

  function renderStats(box, evals, models, live) {
    box.textContent = '';
    if (!evals.length) return;
    var s = Q.stats(evals, models);
    // 1. Does agreement predict accuracy?
    box.appendChild(h('h4', null, 'Does agreement predict accuracy?'));
    var bars = h('div', 'bars');
    [['high', 'agreement 75% or more'], ['mid', '50 to 74%'], ['low', 'under 50%, or no herd']].forEach(function (b) {
      var x = s.buckets[b[0]], row = h('div', 'brow');
      row.appendChild(h('span', 'blabel', b[1]));
      var bar = h('span', 'vbar'); var f = h('span', 'vfill ok'); f.style.width = (x.n ? 100 * x.right / x.n : 0) + '%'; bar.appendChild(f); row.appendChild(bar);
      row.appendChild(h('span', 'bcount', 'herd right ' + x.right + ' of ' + x.n));
      bars.appendChild(row);
    });
    box.appendChild(bars);
    var missed = evals.filter(function (e) { return e.herdStatus !== 'right'; });
    var p = h('p', 'hint');
    p.appendChild(document.createTextNode('The herd was right on ' + s.herdRight + ' of ' + s.n + ' questions' +
      (s.best.length ? '; the best single model' + (s.best.length > 1 ? 's, ' + s.best.map(title).join(' and ') + ',' : ', ' + title(s.best[0]) + ',') + ' on ' + s.bestRight + '. ' : '. ')));
    if (missed.length) {
      p.appendChild(document.createTextNode('Where the herd was wrong or missing: '));
      missed.forEach(function (e, i) {
        if (i) p.appendChild(document.createTextNode(', '));
        if (live) p.appendChild(document.createTextNode(e.id + ' (' + e.herdStatus + ')'));
        else { p.appendChild(roundLink(e.id)); p.appendChild(document.createTextNode(e.herdStatus === 'wrong' ? '' : ' (no herd)')); }
        var right = e.verdicts.filter(function (v) { return v.status === 'right'; }).map(function (v) { return title(v.model); });
        p.appendChild(document.createTextNode(right.length ? ' — right: ' + right.join(', ') : ' — nobody right'));
      });
      p.appendChild(document.createTextNode('.'));
    }
    box.appendChild(p);

    // 2. Shared mistakes per family.
    box.appendChild(h('h4', null, 'Shared mistakes'));
    var fams = Q.FAMILIES.filter(function (f) { return s.families[f]; });
    box.appendChild(table(['question', 'rounds', 'answers', 'right', 'wrong', 'same as another model\'s wrong answer', 'a named shortcut', 'no answer'],
      fams.map(function (f) { var x = s.families[f]; return [FAMILY[f], x.rounds, x.answers, x.right, x.wrong, x.shared + ' of ' + x.wrong, x.lure + ' of ' + x.wrong, x.none]; })));
    var tw = fams.reduce(function (a, f) { return a + s.families[f].wrong; }, 0), ts = fams.reduce(function (a, f) { return a + s.families[f].shared; }, 0);
    box.appendChild(h('p', 'hint', tw ? ts + ' of ' + tw + ' wrong answers were the identical wrong value another model gave on the same question.' : 'No wrong answers.'));

    // 3. Model x model grid.
    var used = models.filter(function (m) { return s.perModel[m] && s.perModel[m].n; });
    box.appendChild(h('h4', null, 'Who makes the same mistake as whom'));
    box.appendChild(h('p', 'fine', 'Each cell: questions where both models gave the identical wrong answer / questions where both were wrong. Rows and columns: reasoning models first, then one-shot models.'));
    var grid = used.map(function (a) {
      return [title(a)].concat(used.map(function (b) { if (a === b) return '·'; var x = s.pair[a][b]; return x.both ? x.same + ' / ' + x.both : ''; }));
    });
    box.appendChild(table([''].concat(used.map(title)), grid, 'grid'));

    // 4. Per model.
    box.appendChild(h('h4', null, 'Per model'));
    box.appendChild(table(['model', 'kind', 'right', 'wrong', 'no answer'].concat(fams.map(function (f) { return FAMILY[f]; }), ['mean reasoning tokens', 'right against the herd']),
      used.map(function (a) {
        var x = s.perModel[a], m = modelMeta(a);
        return [title(a), m.effort ? 'reasoning' : 'one-shot', x.right + '/' + x.n, x.wrong, x.none].concat(
          fams.map(function (f) { var y = x.fam[f]; return y ? y.right + '/' + y.n : '-'; }), [x.meanReasoning == null ? 'not reported' : x.meanReasoning, x.againstHerd]);
      })));
  }
  function modelMeta(id) { return (app.rec && app.rec.models.filter(function (m) { return m.id === id; })[0]) || app.byId[id] || {}; }

  function renderResults() {
    if (!app.rec) return;
    var box = $('results'); box.textContent = '';
    var ids = app.rec.models.map(function (m) { return m.id; });
    var main = app.evals.filter(function (e) { return e.id.charAt(0) === 'q'; }), hard = app.evals.filter(function (e) { return e.id.charAt(0) === 'h'; });
    [[main, 'The main set: ' + main.length + ' questions, six kinds', ''],
      [hard, 'The harder set: ' + hard.length + ' questions, level 3', 'Recorded after the main set, because the herd never lost there: 8 words to count letters in, 5-digit by 5-digit products, 30 numbers to count, 20 letters to reverse. Same models, same message, same rules.']].forEach(function (part) {
      if (!part[0].length) return;
      var sec = h('section', 'set'); sec.appendChild(h('h3', 'sethead', part[1]));
      if (part[2]) sec.appendChild(h('p', 'fine', part[2]));
      var inner = h('div'); sec.appendChild(inner); box.appendChild(sec);
      renderStats(inner, part[0], ids, false);
    });
  }

  // ---------- sign-in and live questions ----------
  function readKey(c, e) {
    var k = (c && c.apiKey) || (e && e.detail && (e.detail.apiKey || e.detail.key)) || null;
    return typeof k === 'string' && k ? k : null;
  }
  function wireConnect() {
    var c = $('connect');
    c.setAttribute('app-key', C.APP_KEY);
    Promise.race([customElements.whenDefined('polli-connect'), new Promise(function (r) { setTimeout(r, 8000); })]).then(function () {
      if (!customElements.get('polli-connect')) { c.hidden = true; $('connect-fallback').hidden = false; }
      onKey(readKey(c));
    });
    c.addEventListener('change', function (e) { onKey(readKey(c, e)); });
  }
  function onKey(k) {
    if (k === app.key) return;
    app.key = k;
    if (!k && app.ctrl) { app.stopAsked = true; app.ctrl.abort(); }
    render();
  }
  function loadModels() {
    return N.listModels().then(function (list) {
      app.models = list.filter(function (m) { return !m.paidOnly; });
      app.byId = {}; list.forEach(function (m) { app.byId[m.id] = m; });
    }).catch(function (e) { app.modelsError = e.message; });
  }
  function liveModels() {
    if (!app.live.models) {
      var rec = app.rec ? app.rec.models.map(function (m) { return m.id; }) : [];
      app.live.models = rec.filter(function (id) { return app.byId[id] && !app.byId[id].paidOnly; });
      if (!app.live.models.length) app.live.models = app.models.slice(0, 5).map(function (m) { return m.id; });
    }
    return app.live.models.filter(function (id) { return app.byId[id] && !app.byId[id].paidOnly; });
  }
  function maxTok(m) { return m.effort ? 1500 : 100; }
  function worst(m) { return C.WORST_IN_TOKENS * m.inPrice + maxTok(m) * m.outPrice; }
  function typical(m) { return 110 * m.inPrice + (m.effort ? 500 : 15) * m.outPrice; }

  async function runLive(ev) {
    if (!ev.isTrusted || app.busy || !app.key) return;
    var ms = liveModels().map(function (id) { return app.byId[id]; });
    var fams = app.live.families.slice();
    if (ms.length < 2 || !fams.length) return;
    app.busy = true; app.stopAsked = false; app.ctrl = new AbortController(); app.capSpent = 0; app.notice = '';
    render();
    for (var i = 0; i < app.live.n && !app.stopAsked; i++) {
      // Two calls per model at worst (one retry), each charged at worst case if it fails.
      var need = ms.reduce(function (a, m) { return a + 2 * worst(m); }, 0);
      if (app.capSpent + need > C.MAX_SPEND) { app.notice = 'Stopped before a question whose calls could take this run past ' + C.MAX_SPEND + ' Pollen.'; break; }
      app.capSpent += need;
      var seedArr = new Uint32Array(1); crypto.getRandomValues(seedArr);
      var seed = seedArr[0] >>> 1, family = fams[Math.floor(Math.random() * fams.length)];
      var q = Q.gen(family, seed, app.live.level), msgs = Q.messages(q);
      var res = await Promise.all(ms.map(function (m) { return N.ask(app.key, m, msgs, app.ctrl.signal); }));
      var calls = res.map(function (r, j) {
        // Failed and cancelled calls can still be billed: count them at the worst case, once per attempt.
        app.spent += r.cost != null ? r.cost : (r.tries || 1) * worst(ms[j]);
        if (r.status === 401 || r.status === 402) app.notice = (r.status === 402 ? 'Out of Pollen: ' : 'Sign-in problem: ') + r.error;
        var u = r.usage, call = { model: ms[j].id, request: r.request, usage: u && { in: u.prompt_tokens, out: u.completion_tokens, reasoning: u.completion_tokens_details && u.completion_tokens_details.reasoning_tokens }, cost: r.cost, ms: r.ms };
        if (r.cancelled) call.error = 'cancelled'; else if (r.error) call.error = r.error; else call.raw = r.text;
        return call;
      });
      // Settle the reservation to what was really charged (failed calls at worst case).
      app.capSpent -= need;
      app.capSpent += res.reduce(function (a, r, j) { return a + (r.cost != null ? r.cost : (r.tries || 1) * worst(ms[j])); }, 0);
      if (res.every(function (r) { return r.cancelled; })) break;
      var fatal = res.some(function (r) { return r.status === 401 || r.status === 402; });
      var round = { id: 'L' + (app.live.rounds.length + 1), family: family, level: q.level, seed: seed, calls: calls };
      app.live.rounds.push(round);
      var e = Q.evaluate(round); e.live = true;
      app.live.evals.push(e);
      // Show the first live question at once; later ones wait their turn behind "Next round".
      if (!app.cur || !app.cur.e.live) start(e);
      render();
      if (fatal) break;
    }
    app.busy = false; app.ctrl = null;
    render();
  }
  function stop(ev) { if (!ev.isTrusted || !app.busy) return; app.stopAsked = true; if (app.ctrl) app.ctrl.abort(); }

  function check(label, checked, onChange) {
    var l = h('label', 'check'); var i = h('input'); i.type = 'checkbox'; i.checked = checked; i.disabled = app.busy;
    i.addEventListener('change', function () { onChange(i.checked); render(); });
    l.appendChild(i); l.appendChild(document.createTextNode(' ' + label)); return l;
  }

  function renderLive() {
    var box = $('livebody'); box.textContent = '';
    if (!app.key) { box.appendChild(h('p', 'hint', 'Sign in with Pollinations to ask brand-new questions (a fresh random seed each) to the same nine models or any free ones, paid with your own Pollen: under 0.01 Pollen for 5 questions, and a run stops itself at ' + C.MAX_SPEND + '.')); return; }
    if (!app.models.length) { box.appendChild(h('p', app.modelsError ? 'hint warn' : 'hint', app.modelsError ? 'Could not load the model list: ' + app.modelsError : 'Loading the model list…')); return; }
    var sel = liveModels();
    var fr = h('fieldset', 'pick'); fr.appendChild(h('legend', null, 'Questions'));
    Q.FAMILIES.forEach(function (f) {
      fr.appendChild(check(FAMILY[f], app.live.families.indexOf(f) >= 0, function (on) {
        app.live.families = Q.FAMILIES.filter(function (x) { return x === f ? on : app.live.families.indexOf(x) >= 0; });
      }));
    });
    box.appendChild(fr);
    var mr = h('fieldset', 'pick'); mr.appendChild(h('legend', null, 'Models (free, up to ' + C.MAX_MODELS + ')'));
    app.models.forEach(function (m) {
      var on = sel.indexOf(m.id) >= 0;
      var c = check(m.title + (m.effort ? ' · reasoning' : ''), on, function (v) {
        if (v && app.live.models.length >= C.MAX_MODELS) return;
        app.live.models = v ? app.live.models.concat([m.id]) : app.live.models.filter(function (x) { return x !== m.id; });
      });
      if (!on && sel.length >= C.MAX_MODELS) c.querySelector('input').disabled = true;
      mr.appendChild(c);
    });
    box.appendChild(mr);
    var row = h('div', 'liverow');
    var lab = h('label', 'field'); lab.appendChild(h('span', null, 'How many questions'));
    var s = h('select'); s.disabled = app.busy;
    [1, 3, 5].forEach(function (n) { var o = h('option', null, String(n)); o.value = n; o.selected = n === app.live.n; s.appendChild(o); });
    s.addEventListener('change', function () { app.live.n = Number(s.value); render(); });
    lab.appendChild(s); row.appendChild(lab);
    var lab2 = h('label', 'field'); lab2.appendChild(h('span', null, 'Difficulty'));
    var s2 = h('select'); s2.disabled = app.busy;
    [[2, 'Level 2 (the main set)'], [3, 'Level 3 (the harder set)']].forEach(function (o) { var op = h('option', null, o[1]); op.value = o[0]; op.selected = o[0] === app.live.level; s2.appendChild(op); });
    s2.addEventListener('change', function () { app.live.level = Number(s2.value); render(); });
    lab2.appendChild(s2); row.appendChild(lab2);
    var ms = sel.map(function (id) { return app.byId[id]; });
    var est = ms.reduce(function (a, m) { return a + typical(m); }, 0) * app.live.n;
    if (app.busy) { var sb = h('button', 'stop', 'Stop'); sb.type = 'button'; sb.addEventListener('click', stop); row.appendChild(sb); }
    else {
      var b = h('button', 'primary', 'Ask ' + app.live.n + ' new question' + (app.live.n === 1 ? '' : 's') + ' · ' + ms.length + ' models');
      b.type = 'button'; b.disabled = ms.length < 2 || !app.live.families.length; b.addEventListener('click', runLive); row.appendChild(b);
    }
    box.appendChild(row);
    box.appendChild(h('p', 'fine', 'About ' + fmtP(est) + ' for this run; it stops before any question whose calls could take it past ' + C.MAX_SPEND + ' Pollen. Each question gets a new random seed, shown with it, so anyone can rebuild it from the generator. Its models are asked in parallel. A failed call shows its real error and counts as no answer; nothing is filled in from the recordings.'));
    var lr = $('liveresults');
    if (app.live.evals.length) {
      lr.textContent = '';
      lr.appendChild(h('h3', null, 'Your live run (' + app.live.evals.length + ' question' + (app.live.evals.length === 1 ? '' : 's') + ', kept apart from the recording)'));
      var wait = app.live.evals.filter(function (e) { return !e.picked; }).length;
      if (wait) lr.appendChild(h('p', 'hint', wait + ' waiting for your pick above. Their results show here once you have picked.'));
      var done = app.live.evals.filter(function (e) { return e.picked; });
      var inner = h('div'); lr.appendChild(inner);
      var allM = []; done.forEach(function (e) { e.round.calls.forEach(function (c) { if (allM.indexOf(c.model) < 0) allM.push(c.model); }); });
      renderStats(inner, done, allM, true);
    }
  }

  function render() {
    var herdRight = app.evals.filter(function (e) { return e.herdStatus === 'right'; }).length, herdWrong = app.evals.filter(function (e) { return e.herdStatus === 'wrong'; }).length;
    $('facts').textContent = app.rec ? app.evals.length + ' recorded questions · ' + app.rec.models.length + ' free models from ' +
      new Set(app.rec.models.map(function (m) { return m.lab; })).size + ' labs, one call each · the herd was right ' + herdRight + ' times, wrong ' + herdWrong + ', with no herd ' + (app.evals.length - herdRight - herdWrong) +
      ' · recorded ' + String(app.rec.recordedAt).slice(0, 10) + ' · replays cost nothing' : '';
    $('notice').textContent = app.notice;
    var sp = $('spent'); sp.hidden = !app.spent; sp.textContent = 'spent up to ' + fmtP(app.spent);
    renderRound(); renderResults(); renderLive();
  }

  $('nextround').addEventListener('click', nextRound);
  $('src').href = C.REPO_URL;
  wireConnect();
  render();
  Promise.all([load(), loadModels()]).then(render);
})();
