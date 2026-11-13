const test = require('node:test');
const assert = require('node:assert/strict');
const { existsSync, readFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const path = require('node:path');
const Q = require('../js/quiz.js');

const file = path.join(__dirname, '../recordings/rounds.json');
const sha = (s) => createHash('sha256').update(s).digest('hex');

test('every recorded round rebuilds its message and judges', { skip: !existsSync(file) && 'no recordings yet' }, () => {
  const text = readFileSync(file, 'utf8');
  assert.ok(!/sk_[A-Za-z0-9]{6,}/.test(text), 'a secret key in the recording');
  const rec = JSON.parse(text);
  assert.equal(rec.promptSha, sha(Q.gen('weekday', 1).message.split('\n\n')[1]), 'the answer-format instruction changed');
  const ids = rec.models.map((m) => m.id), seeds = new Set();
  assert.ok(rec.rounds.length >= 12);
  for (const r of rec.rounds) {
    const q = Q.gen(r.family, r.seed, r.level);
    assert.deepEqual(r.calls.map((c) => c.model), ids, r.id + ' one call per model, in order');
    for (const c of r.calls) {
      assert.ok(typeof c.raw === 'string' || typeof c.error === 'string', r.id + ' call without raw or error');
      assert.equal(c.request.messagesSha, sha(JSON.stringify(Q.messages(q))), r.id + ' ' + c.model + ' message');
      assert.equal(c.request.max_tokens, rec.models.find((m) => m.id === c.model).effort ? 1500 : 100);
      assert.ok(!seeds.has(c.request.seed), 'repeated seed'); seeds.add(c.request.seed);
    }
    const e = Q.evaluate(r);
    assert.equal(e.verdicts.length, ids.length);
  }
  const plan = [...Q.plan(8), ...Q.plan(8, true)];
  for (const r of rec.rounds) {
    const p = plan.find((x) => x.id === r.id);
    assert.ok(p, r.id + ' in the plan');
    assert.equal(p.family, r.family, r.id + ' family follows the plan');
    assert.equal(r.level, p.family === 'weekday' || p.family === 'lure' ? 1 : p.level, r.id + ' level');
  }
});
