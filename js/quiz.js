/* Herd Check engine: question generators, the request, the parser, the judge, the herd and the stats.
 * No DOM, no network. UMD: window.HC.quiz in the browser, require() in node.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.HC = root.HC || {}; root.HC.quiz = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function mulberry32(a) {
    a = a >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function int(r, lo, hi) { return lo + Math.floor(r() * (hi - lo + 1)); }
  function pick(r, arr) { return arr[Math.floor(r() * arr.length)]; }
  function lure1(label, v) { var o = {}; o[label] = v; return o; }
  function fmt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var WORDS = ['strawberry', 'mirror', 'carpet', 'error', 'barrel', 'terrier', 'referee', 'cheese', 'beekeeper', 'committee',
    'coffee', 'eleven', 'sense', 'assess', 'mississippi', 'possess', 'address', 'success', 'blossom', 'scissors',
    'banana', 'alabama', 'cassava', 'pajama', 'caravan', 'salad', 'parallel', 'balloon', 'llama', 'lollipop',
    'little', 'tattoo', 'potato', 'attempt', 'settle', 'butter', 'letter', 'bottle', 'statement', 'tomorrow',
    'cocoon', 'voodoo', 'kangaroo', 'robot', 'onion', 'cotton', 'noon', 'banner', 'tennis', 'cannon',
    'dinner', 'linen', 'nineteen', 'pepper', 'puppy', 'hippo', 'apple', 'paper', 'giraffe', 'rhubarb'];
  var LETTERS = ['r', 'e', 's', 'a', 'l', 't', 'o', 'n', 'p'];
  var CONS = 'bcdfghjklmnprstvz', VOW = 'aeiou';
  var FAMILIES = ['weekday', 'letters', 'product', 'count', 'reverse', 'lure'];
  var ONE_LEVEL = { weekday: true, lure: true };
  var KIND = { weekday: 'weekday', letters: 'int', product: 'int', count: 'int', reverse: 'string', lure: 'int' };
  var HINT = { weekday: 'a weekday name', int: 'a whole number', string: 'the string' };

  var gens = {
    weekday: function (r) {
      var y = int(r, 1900, 2099), m = int(r, 0, 11);
      var dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate(), d = int(r, 1, dim);
      var t = Date.UTC(y, m, d), wd = new Date(t).getUTCDay();
      var diff = Math.round((t - Date.UTC(2000, 0, 1)) / 864e5);
      return {
        prompt: 'On what day of the week does ' + d + ' ' + MONTHS[m] + ' ' + y + ' fall?',
        truth: DAYS[wd],
        lures: { 'one day early': DAYS[(wd + 6) % 7], 'one day late': DAYS[(wd + 1) % 7] },
        show: d + ' ' + MONTHS[m] + ' ' + y + ' is ' + fmt(diff) + ' days from 1 January 2000, a Saturday. ' +
          fmt(diff) + ' mod 7 = ' + (((diff % 7) + 7) % 7) + ', so Saturday + ' + (((diff % 7) + 7) % 7) + ' = ' + DAYS[wd] + '.'
      };
    },
    letters: function (r, level) {
      var n = [0, 3, 5, 8][level];
      for (;;) {
        var L = pick(r, LETTERS), words = [];
        var pool = WORDS.slice();
        for (var i = 0; i < n; i++) words.push(pool.splice(Math.floor(r() * pool.length), 1)[0]);
        var per = words.map(function (w) { return w.split(L).length - 1; });
        var total = per.reduce(function (a, b) { return a + b; }, 0);
        if (total < 2) continue;
        return {
          prompt: 'How many times does the letter "' + L + '" appear in these words? ' + words.join(' '),
          truth: total, lures: { 'one short': total - 1 }, letter: L, words: words,
          show: words.map(function (w, i) { return w + ' ' + per[i]; }).join(', ') + '. Total ' + total + '.'
        };
      }
    },
    product: function (r, level) {
      var dg = level + 2, lo = Math.pow(10, dg - 1), hi = Math.pow(10, dg) - 1;
      var a = int(r, lo, hi), b = int(r, lo, hi);
      var bh = b - (b % lo), bl = b - bh;
      return {
        prompt: 'What is ' + a + ' × ' + b + '?', truth: a * b, lures: {},
        show: a + ' × ' + b + ' = ' + a + ' × ' + bh + ' + ' + a + ' × ' + bl + ' = ' + fmt(a * bh) + ' + ' + fmt(a * bl) + ' = ' + fmt(a * b) + '.'
      };
    },
    count: function (r, level) {
      var n = [0, 10, 18, 30][level];
      for (;;) {
        var nums = [];
        for (var i = 0; i < n; i++) nums.push(int(r, 10, 99));
        var c = int(r, 0, 3), T = int(r, 30, 70);
        var crit = ['odd', 'even', 'greater than ' + T, 'divisible by 3'][c];
        var test = [function (x) { return x % 2 === 1; }, function (x) { return x % 2 === 0; }, function (x) { return x > T; }, function (x) { return x % 3 === 0; }][c];
        var hits = nums.filter(test);
        if (hits.length < 2 || hits.length > n - 2) continue;
        return {
          prompt: 'How many of these numbers are ' + crit + '? ' + nums.join(', '),
          truth: hits.length, lures: { 'one short': hits.length - 1, 'one over': hits.length + 1 },
          show: crit.charAt(0).toUpperCase() + crit.slice(1) + ': ' + hits.join(', ') + '. That is ' + hits.length + ' of ' + n + '.'
        };
      }
    },
    reverse: function (r, level) {
      var n = [0, 8, 12, 20][level], s = '';
      for (var i = 0; i < n; i++) s += (i % 2 ? VOW : CONS).charAt(Math.floor(r() * (i % 2 ? VOW : CONS).length));
      var t = s.split('').reverse().join('');
      return {
        prompt: 'Write this string backwards, letter by letter: ' + s, truth: t, lures: {},
        show: s.split('').join(' ') + ' → ' + t.split('').join(' ')
      };
    },
    lure: function (r) {
      var which = int(r, 0, 2);
      if (which === 0) {
        var D = int(r, 5, 15) * 10, p = int(r, 1, 8) * 5, T = D + 2 * p;
        var $ = function (c) { return '$' + (c / 100).toFixed(2); };
        return {
          prompt: 'A pen and a notebook cost ' + $(T) + ' in total. The notebook costs ' + $(D) + ' more than the pen. How much does the pen cost, in cents?',
          truth: p, lures: lure1('the difference (' + $(T) + ' − ' + $(D) + ')', T - D),
          show: 'pen + (pen + ' + D + ') = ' + T + ' cents, so 2 × pen = ' + (T - D) + ' and the pen costs ' + p + ' cents.'
        };
      }
      if (which === 1) {
        var N = int(r, 3, 9), M = int(r, 20, 150);
        return {
          prompt: 'If ' + N + ' machines take ' + N + ' minutes to make ' + N + ' parts, how many minutes would it take ' + M + ' machines to make ' + M + ' parts?',
          truth: N, lures: lure1('scaling with the machines (' + M + ')', M),
          show: 'Each machine makes one part in ' + N + ' minutes, so ' + M + ' machines make ' + M + ' parts in ' + N + ' minutes.'
        };
      }
      var Dd = int(r, 6, 30) * 2;
      return {
        prompt: 'A patch of algae on a pond doubles in size every day. It covers the whole pond on day ' + Dd + '. On which day did it cover half the pond?',
        truth: Dd - 1, lures: lure1('half the days (' + Dd + ' ÷ 2)', Dd / 2),
        show: 'It doubles every day, so the day before it covers the whole pond, day ' + (Dd - 1) + ', it covered half.'
      };
    }
  };

  // Pure: the same (family, seed, level) always gives the same question.
  function gen(family, seed, level) {
    if (!gens[family]) throw new Error('unknown family ' + family);
    var lv = ONE_LEVEL[family] ? 1 : (level || 2);
    var q = gens[family](mulberry32(seed), lv);
    q.family = family; q.level = lv; q.seed = seed; q.kind = KIND[family];
    q.message = q.prompt + '\n\nReply with one line only, in exactly this form:\nANSWER: <' + HINT[q.kind] + '>';
    return q;
  }

  function messages(q) { return [{ role: 'user', content: q.message }]; }

  // model: { id, effort }. Same body in the browser and in tools/record.mjs.
  function request(model, msgs, seed) {
    var b = { model: model.id, messages: msgs, seed: seed };
    if (model.effort) { b.reasoning_effort = 'low'; b.max_tokens = 1500; } else b.max_tokens = 100;
    return b;
  }

  var WD = /^(mon|tue|wed|thu|fri|sat|sun)/i;
  // Strict: the last ANSWER line, nothing guessed from the rest of the text.
  function parse(raw, kind) {
    // A reply can also carry a closing </think> without the opening tag: drop everything up to it.
    var s = String(raw == null ? '' : raw).replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^[\s\S]*<\/think>/i, '').trim();
    if (!s) return { status: 'empty' };
    var re = /^\W*ANSWER\W*[:=]\s*(.+)$/gim, m, last = null;
    while ((m = re.exec(s))) last = m[1];
    if (last == null) return { status: 'format' };
    var v = last.replace(/^[\s*`"'.<>[\]()]+|[\s*`"'.<>[\]()]+$/g, '');
    if (kind === 'weekday') {
      var w = v.match(WD);
      if (!w) return { status: 'format' };
      if (/\b(mon|tue|wed|thu|fri|sat|sun)/i.test(v.slice(w[0].length).replace(/^[a-z]*/i, ''))) return { status: 'format' };
      var full = DAYS.filter(function (d) { return d.slice(0, 3).toLowerCase() === w[1].toLowerCase(); })[0];
      return { status: 'answer', value: full };
    }
    if (kind === 'int') {
      var n = v.match(/^-?\d[\d,_ ]*/);
      if (!n) return { status: 'format' };
      if (/\d/.test(v.slice(n[0].length))) return { status: 'format' };
      var digits = n[0].replace(/[,_ ]/g, '');
      return { status: 'answer', value: Number(digits) };
    }
    var str = v.toLowerCase().replace(/[^a-z]/g, '');
    return str ? { status: 'answer', value: str } : { status: 'format' };
  }

  // call: { raw } or { error }. -> { status: right|wrong|empty|format|error, value?, lure? }
  function judge(q, call) {
    if (!call || call.error != null) return { status: 'error', error: call ? call.error : 'missing' };
    var p = parse(call.raw, q.kind);
    if (p.status !== 'answer') return p;
    if (p.value === q.truth) return { status: 'right', value: p.value };
    var out = { status: 'wrong', value: p.value };
    for (var label in q.lures) if (q.lures[label] === p.value) out.lure = label;
    return out;
  }

  // The most common parsed value held by >= 2 models, with no tie for first. n counts every model asked.
  function herd(verdicts) {
    var counts = new Map();
    verdicts.forEach(function (v) { if (v.status === 'right' || v.status === 'wrong') counts.set(v.value, (counts.get(v.value) || 0) + 1); });
    var best = null, size = 0, tie = false;
    counts.forEach(function (c, val) { if (c > size) { best = val; size = c; tie = false; } else if (c === size) tie = true; });
    var n = verdicts.length;
    if (size < 2 || tie) return { value: null, size: size, n: n, agreement: 0 };
    return { value: best, size: size, n: n, agreement: size / n };
  }

  // The vote a visitor sees: distinct parsed answers with counts, no names; no-answers as one count.
  function tally(verdicts) {
    var m = new Map(), none = 0;
    verdicts.forEach(function (v) {
      if (v.status === 'right' || v.status === 'wrong') m.set(v.value, (m.get(v.value) || 0) + 1); else none++;
    });
    var rows = [];
    m.forEach(function (c, val) { rows.push({ value: val, count: c }); });
    rows.sort(function (a, b) { return b.count - a.count || String(a.value).localeCompare(String(b.value)); });
    return { rows: rows, none: none };
  }

  // round: { id, family, level, seed, calls: [{ model, raw | error, usage }] }
  function evaluate(round) {
    var q = gen(round.family, round.seed, round.level);
    var verdicts = round.calls.map(function (c) { var v = judge(q, c); v.model = c.model; return v; });
    var h = herd(verdicts);
    var herdStatus = h.value == null ? 'none' : (h.value === q.truth ? 'right' : 'wrong');
    return { id: round.id, round: round, q: q, verdicts: verdicts, herd: h, herdStatus: herdStatus };
  }

  function bucketOf(h) { return h.value == null || h.agreement < 0.5 ? 'low' : h.agreement >= 0.75 ? 'high' : 'mid'; }

  // evals: evaluate() results. models: ordered ids. All counts, nothing called significant.
  function stats(evals, models) {
    var buckets = { high: { n: 0, right: 0, wrong: [] }, mid: { n: 0, right: 0, wrong: [] }, low: { n: 0, right: 0, wrong: [] } };
    var fam = {}, pm = {}, pair = {};
    models.forEach(function (a) {
      pm[a] = { right: 0, wrong: 0, none: 0, n: 0, fam: {}, reasoning: [], againstHerd: 0 };
      pair[a] = {}; models.forEach(function (b) { pair[a][b] = { same: 0, both: 0 }; });
    });
    var herdRight = 0;
    evals.forEach(function (e) {
      var b = buckets[bucketOf(e.herd)];
      b.n++; if (e.herdStatus === 'right') { b.right++; herdRight++; } else b.wrong.push(e.id);
      var f = fam[e.q.family] = fam[e.q.family] || { rounds: 0, answers: 0, right: 0, wrong: 0, shared: 0, lure: 0, none: 0 };
      f.rounds++;
      var wrongs = e.verdicts.filter(function (v) { return v.status === 'wrong'; });
      e.verdicts.forEach(function (v, i) {
        var call = e.round.calls[i], s = pm[v.model];
        f.answers++;
        if (v.status === 'right') f.right++; else if (v.status === 'wrong') f.wrong++; else f.none++;
        if (v.status === 'wrong') {
          if (wrongs.some(function (w) { return w !== v && w.value === v.value; })) f.shared++;
          if (v.lure) f.lure++;
        }
        if (!s) return;
        s.n++;
        var sf = s.fam[e.q.family] = s.fam[e.q.family] || { right: 0, n: 0 };
        sf.n++;
        if (v.status === 'right') { s.right++; sf.right++; if (e.herdStatus === 'wrong') s.againstHerd++; }
        else if (v.status === 'wrong') s.wrong++; else s.none++;
        if (call && call.usage && Number.isFinite(call.usage.reasoning)) s.reasoning.push(call.usage.reasoning);
      });
      wrongs.forEach(function (a) {
        wrongs.forEach(function (b) {
          if (a === b || !pair[a.model] || !pair[a.model][b.model]) return;
          pair[a.model][b.model].both++;
          if (a.value === b.value) pair[a.model][b.model].same++;
        });
      });
    });
    models.forEach(function (a) {
      var r = pm[a].reasoning;
      pm[a].meanReasoning = r.length ? Math.round(r.reduce(function (x, y) { return x + y; }, 0) / r.length) : null;
    });
    var top = Math.max.apply(null, models.map(function (a) { return pm[a].right; }).concat([0]));
    var best = models.filter(function (a) { return pm[a].right === top && top > 0; });
    return { n: evals.length, herdRight: herdRight, buckets: buckets, families: fam, perModel: pm, pair: pair, best: best, bestRight: top };
  }

  // Record order: round i of every family, then round i + 1, so the first 12 rounds are 2 per family.
  // The harder set (level 3), recorded after the first 42: the four families that have a level 3.
  var HARD = ['letters', 'product', 'count', 'reverse'];
  function plan(perFamily, hard) {
    var out = [], fams = hard ? HARD : FAMILIES, pre = hard ? 'h' : 'q';
    for (var i = 0; i < perFamily; i++) fams.forEach(function (f) { out.push({ id: pre + String(out.length + 1).padStart(2, '0'), family: f, level: hard ? 3 : 2 }); });
    return out;
  }

  return {
    FAMILIES: FAMILIES, HARD: HARD, DAYS: DAYS, WORDS: WORDS, mulberry32: mulberry32, gen: gen, messages: messages, request: request,
    parse: parse, judge: judge, herd: herd, tally: tally, evaluate: evaluate, bucketOf: bucketOf, stats: stats, plan: plan
  };
});
