const test = require('node:test');
const assert = require('node:assert/strict');
const Q = require('../js/quiz.js');

test('generators are pure and valid over 500 seeds per family', () => {
  for (const f of Q.FAMILIES) {
    assert.deepEqual(Q.gen(f, 42, 2), Q.gen(f, 42, 2), f + ' pure');
    for (let s = 1; s <= 500; s++) {
      const q = Q.gen(f, s * 7919, 2);
      assert.ok(q.prompt && q.show && q.message.endsWith('ANSWER: <' + { weekday: 'a weekday name', int: 'a whole number', string: 'the string' }[q.kind] + '>'), f);
      if (q.kind === 'int') assert.ok(Number.isInteger(q.truth) && q.truth >= 0, f + ' truth');
      for (const v of Object.values(q.lures)) assert.notEqual(v, q.truth, f + ' lure equals truth');
      if (f === 'letters') {
        assert.ok(q.truth >= 2);
        assert.equal(q.words.join('').split(q.letter).length - 1, q.truth);
      }
      if (f === 'reverse') assert.equal(q.truth, q.prompt.split(': ')[1].split('').reverse().join(''));
      if (f === 'product') { const [a, b] = q.prompt.match(/\d+/g).map(Number); assert.equal(q.truth, a * b); }
    }
  }
  assert.equal(Q.gen('product', 5, 1).prompt.match(/\d+/g)[0].length, 3);
  assert.equal(Q.gen('reverse', 5, 1).truth.length, 8);
  assert.equal(Q.gen('weekday', 5, 1).level, 1, 'one level only');
  assert.equal(Q.gen('product', 5, 3).prompt.match(/\d+/g)[0].length, 5);
  assert.equal(Q.gen('reverse', 5, 3).truth.length, 20);
  assert.equal(Q.gen('count', 5, 3).prompt.split(', ').length, 30);
  assert.equal(Q.gen('letters', 5, 3).words.length, 8);
  for (let s = 1; s < 300; s++) { const q = Q.gen('product', s, 3); const [a, b] = q.prompt.match(/\d+/g).map(Number); assert.equal(q.truth, a * b); assert.ok(q.show.endsWith(q.truth.toLocaleString('en-US') + '.')); }
  assert.deepEqual(Q.plan(6, true).slice(0, 4).map((p) => p.id + p.family + p.level), ['h01letters3', 'h02product3', 'h03count3', 'h04reverse3']);
});

test('weekday truth on known dates', () => {
  const day = (y, m, d) => ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  assert.equal(day(2000, 1, 1), 'Saturday');
  assert.equal(day(2024, 2, 29), 'Thursday');
  // The generator agrees with its own working.
  for (let s = 1; s < 200; s++) {
    const q = Q.gen('weekday', s, 2);
    const [, d, mon, y] = q.prompt.match(/does (\d+) (\w+) (\d+)/);
    const m = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].indexOf(mon) + 1;
    assert.equal(q.truth, day(+y, m, +d));
    assert.ok(q.show.endsWith(q.truth + '.'));
  }
});

test('parse is strict', () => {
  assert.deepEqual(Q.parse('ANSWER: Tuesday', 'weekday'), { status: 'answer', value: 'Tuesday' });
  assert.deepEqual(Q.parse('**ANSWER: Tuesday.**', 'weekday'), { status: 'answer', value: 'Tuesday' });
  assert.deepEqual(Q.parse('answer: tue', 'weekday'), { status: 'answer', value: 'Tuesday' });
  assert.equal(Q.parse('ANSWER: Thursday or Friday', 'weekday').status, 'format');
  assert.deepEqual(Q.parse('ANSWER: 3\nwait\nANSWER: 4', 'int'), { status: 'answer', value: 4 });
  assert.deepEqual(Q.parse('<think>ANSWER: 9</think>\nANSWER: 7', 'int'), { status: 'answer', value: 7 });
  assert.deepEqual(Q.parse('ANSWER: 1,234', 'int'), { status: 'answer', value: 1234 });
  assert.deepEqual(Q.parse('ANSWER: 5 minutes', 'int'), { status: 'answer', value: 5 });
  assert.equal(Q.parse('ANSWER: 5 or 6', 'int').status, 'format');
  assert.equal(Q.parse('Answer is 5', 'int').status, 'format');
  assert.equal(Q.parse('The total is 5.', 'int').status, 'format');
  assert.equal(Q.parse('ANSWER: $0.15', 'int').status, 'format');
  assert.equal(Q.parse('', 'int').status, 'empty');
  // A closing </think> with no opening tag (GLM-5.3-Flash in h08): the reasoning before it is dropped.
  assert.deepEqual(Q.parse('ANSWER: abc<|assistant|>reasoning, a b c...\nmore</think>ANSWER: abc', 'string'), { status: 'answer', value: 'abc' });
  assert.deepEqual(Q.parse('ANSWER: <42>', 'int'), { status: 'answer', value: 42 });
  assert.deepEqual(Q.parse('ANSWER: [Tuesday]', 'weekday'), { status: 'answer', value: 'Tuesday' });
  assert.equal(Q.parse('<think>hmm</think>  ', 'int').status, 'empty');
  assert.deepEqual(Q.parse('ANSWER: "Ukemi-Rovat"', 'string'), { status: 'answer', value: 'ukemirovat' });
  assert.equal(Q.parse('ANSWER: ...', 'string').status, 'format');
});

test('judge and lure labels', () => {
  const q = Q.gen('weekday', 11);
  assert.equal(Q.judge(q, { raw: 'ANSWER: ' + q.truth }).status, 'right');
  const early = Q.judge(q, { raw: 'ANSWER: ' + q.lures['one day early'] });
  assert.equal(early.status, 'wrong'); assert.equal(early.lure, 'one day early');
  assert.equal(Q.judge(q, { error: 'HTTP 500' }).status, 'error');
  assert.equal(Q.judge(q, { raw: '' }).status, 'empty');
});

test('herd: clear lead, tie, single vote, no-answers in the denominator', () => {
  const v = (...xs) => xs.map((x) => x == null ? { status: 'format' } : { status: 'wrong', value: x });
  assert.deepEqual(Q.herd(v(1, 1, 2, null)), { value: 1, size: 2, n: 4, agreement: 0.5 });
  assert.equal(Q.herd(v(1, 1, 2, 2)).value, null);
  assert.equal(Q.herd(v(1, 2, 3)).value, null);
  assert.equal(Q.herd(v(null, null)).value, null);
  assert.deepEqual(Q.tally(v(2, 1, 1, null)), { rows: [{ value: 1, count: 2 }, { value: 2, count: 1 }], none: 1 });
});

test('stats on a small fixture', () => {
  const q1 = Q.gen('lure', 3), q2 = Q.gen('product', 4);
  const lureVal = Object.values(q1.lures)[0];
  const rounds = [
    { id: 'a', family: 'lure', seed: 3, calls: [{ model: 'x', raw: 'ANSWER: ' + lureVal }, { model: 'y', raw: 'ANSWER: ' + lureVal }, { model: 'z', raw: 'ANSWER: ' + q1.truth }] },
    { id: 'b', family: 'product', level: 2, seed: 4, calls: [{ model: 'x', raw: 'ANSWER: ' + q2.truth }, { model: 'y', raw: 'ANSWER: ' + q2.truth }, { model: 'z', error: 'HTTP 400', usage: null }] }
  ];
  const ev = rounds.map(Q.evaluate);
  assert.equal(ev[0].herdStatus, 'wrong'); assert.equal(ev[1].herdStatus, 'right');
  const s = Q.stats(ev, ['x', 'y', 'z']);
  assert.equal(s.herdRight, 1);
  assert.equal(s.buckets.mid.n, 2); assert.deepEqual(s.buckets.mid.wrong, ['a']);
  assert.deepEqual(s.families.lure, { rounds: 1, answers: 3, right: 1, wrong: 2, shared: 2, lure: 2, none: 0 });
  assert.deepEqual(s.pair.x.y, { same: 1, both: 1 });
  assert.deepEqual(s.pair.x.z, { same: 0, both: 0 });
  assert.equal(s.perModel.z.againstHerd, 1);
  assert.equal(s.perModel.z.none, 1);
  assert.deepEqual(s.best, ['x', 'y', 'z'], 'a tie lists every model'); assert.equal(s.bestRight, 1);
});

test('request: thinker vs one-shot bodies', () => {
  const m = [{ role: 'user', content: 'hi' }];
  assert.deepEqual(Q.request({ id: 'a', effort: true }, m, 5), { model: 'a', messages: m, seed: 5, reasoning_effort: 'low', max_tokens: 1500 });
  assert.deepEqual(Q.request({ id: 'b', effort: false }, m, 5), { model: 'b', messages: m, seed: 5, max_tokens: 100 });
});

test('plan: the first 12 rounds are 2 per family', () => {
  const p = Q.plan(8);
  assert.equal(p.length, 48);
  for (const f of Q.FAMILIES) assert.equal(p.slice(0, 12).filter((r) => r.family === f).length, 2);
});
