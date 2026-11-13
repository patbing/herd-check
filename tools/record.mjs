// Record real rounds for the no-sign-in replay.
//   POLLINATIONS_KEY=sk_... node tools/record.mjs <rounds per family> <max Pollen> [family=level ...]
// Appends to recordings/rounds.json and skips round ids already there, so a pilot of 2 per family
// becomes the first 12 rounds of the full run. Question text, truth and verdicts are not stored:
// they are rebuilt from (family, level, seed), and messagesSha pins the message.
//   ... record.mjs hard <rounds per family> <max Pollen>   the level-3 set, ids h01...
//   ... record.mjs redo <max Pollen> q03 q09 [family=level ...]   re-records those rounds (new seeds).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash, randomInt } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Q = require('../js/quiz.js');

const KEY = process.env.POLLINATIONS_KEY;
if (!KEY) { console.error('Set POLLINATIONS_KEY'); process.exit(1); }
const args = process.argv.slice(2);
const levels = Object.fromEntries(args.filter((a) => a.includes('=')).map((a) => { const [f, l] = a.split('='); return [f, Number(l)]; }));
const pos = args.filter((a) => !a.includes('='));
const redo = pos[0] === 'redo', hard = pos[0] === 'hard';
if (hard) pos.shift();
const PER = redo ? 0 : Number(pos[0] || 2);
const MAX = Number(pos[1] || 0.05);
const redoIds = redo ? pos.slice(2) : [];
const API = 'https://gen.pollinations.ai';
const MODELS = (process.env.HC_MODELS || 'openai/gpt-6-luna,openai/gpt-5-nano,openai/gpt-oss-20b,nvidia/nemotron-3.5-lightning,deepseek/deepseek-v4.1-flash,z-ai/glm-5.3-flash,minimax/minimax-m3,meta/llama-3.3-70b-instruct,mistralai/mistral-large-3').split(',');

const list = (await (await fetch(API + '/v1/models')).json()).data;
const info = Object.fromEntries(list.map((m) => [m.id, m]));
for (const id of MODELS) {
  if (!info[id]) { console.error('unknown model: ' + id); process.exit(1); }
  if (info[id].paid_only) { console.error('paid-only model refused: ' + id); process.exit(1); }
  if (!Number(info[id].pricing?.completionTextTokens)) { console.error('no listed price: ' + id); process.exit(1); }
}
const model = (id) => ({ id, effort: (info[id].supported_parameters || []).includes('reasoning_effort'), in: Number(info[id].pricing.promptTextTokens), out: Number(info[id].pricing.completionTextTokens) });
const seats = MODELS.map(model);
const sha = (s) => createHash('sha256').update(s).digest('hex');
const LAB = { openai: 'OpenAI', nvidia: 'NVIDIA', deepseek: 'DeepSeek', 'z-ai': 'Z.ai', minimax: 'MiniMax', meta: 'Meta', mistralai: 'Mistral' };

// Spend guard: every attempt reserves its worst case first; a failed attempt is charged at worst case.
let spent = 0, reserved = 0, capped = false, http = 0;
const worst = (m) => 300 * m.in + (m.effort ? 1500 : 100) * m.out;

async function call(m, messages) {
  const body = Q.request(m, messages, randomInt(2 ** 31 - 1));
  const rec = { model: m.id, request: { max_tokens: body.max_tokens, seed: body.seed, reasoning_effort: body.reasoning_effort, messagesSha: sha(JSON.stringify(messages)) } };
  for (let attempt = 0; attempt < 2; attempt++) {
    const w = worst(m);
    if (spent + reserved + w > MAX) { capped = true; rec.error = rec.error || 'not sent: spend cap'; rec.capped = true; return rec; }
    reserved += w; http++;
    const t0 = Date.now();
    try {
      const res = await fetch(API + '/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + KEY }, body: JSON.stringify(body), signal: AbortSignal.timeout(120000) });
      const j = await res.json().catch(() => null);
      rec.ms = Date.now() - t0; reserved -= w;
      if (!res.ok) {
        spent += w;
        rec.error = 'HTTP ' + res.status + (j?.error?.message ? ': ' + String(j.error.message).slice(0, 200) : '');
        if (attempt === 0 && (res.status === 429 || res.status >= 500)) { await new Promise((r) => setTimeout(r, 3000)); continue; }
        return rec;
      }
      delete rec.error;
      const u = j.usage || {};
      const cost = (u.prompt_tokens || 0) * m.in + (u.completion_tokens || 0) * m.out;
      spent += cost;
      rec.usage = { in: u.prompt_tokens, out: u.completion_tokens, reasoning: u.completion_tokens_details?.reasoning_tokens };
      rec.cost = Number(cost.toPrecision(3));
      // An empty reply is the model's answer, not a failure: parse() counts it as no answer.
      rec.raw = j.choices?.[0]?.message?.content || '';
      return rec;
    } catch (e) {
      reserved -= w; spent += w; rec.ms = Date.now() - t0;
      rec.error = String(e.message || e).slice(0, 200);
    }
  }
  return rec;
}

const file = new URL('../recordings/rounds.json', import.meta.url);
const prompt = Q.gen('weekday', 1).message.split('\n\n')[1];
const store = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {
  app: 'herd-check', promptSha: sha(prompt),
  models: seats.map((m) => ({ id: m.id, title: info[m.id].title || m.id, lab: LAB[m.id.split('/')[0]] || m.id.split('/')[0], effort: m.effort })),
  rounds: []
};
if (store.models.map((m) => m.id).join() !== MODELS.join()) { console.error('model list differs from the stored one'); process.exit(1); }

const have = new Set(store.rounds.map((r) => r.id));
const jobs = redo ? [...Q.plan(8), ...Q.plan(8, true)].filter((p) => redoIds.includes(p.id)) : Q.plan(PER, hard).filter((p) => !have.has(p.id));
for (const j of jobs) {
  const level = levels[j.family] || j.level;
  const seed = randomInt(2 ** 31 - 1);
  const q = Q.gen(j.family, seed, level);
  const calls = await Promise.all(seats.map((m) => call(m, Q.messages(q))));
  if (calls.some((c) => c.capped)) { console.log(j.id, 'stopped at the spend cap, not saved'); break; }
  const round = { id: j.id, family: j.family, level: q.level, seed, calls };
  const i = store.rounds.findIndex((r) => r.id === j.id);
  if (i >= 0) store.rounds[i] = round; else store.rounds.push(round);
  const e = Q.evaluate(round);
  console.log(`${j.id} ${j.family.padEnd(8)} truth ${String(q.truth).padEnd(14)} herd ${e.herdStatus.padEnd(5)} | ${e.verdicts.map((v) => v.status === 'right' ? '+' : v.status === 'wrong' ? (v.lure ? 'L' : '-') : v.status[0]).join('')} | ${spent.toFixed(4)}`);
  store.recordedAt = new Date().toISOString();
  store.rounds.sort((a, b) => a.id.localeCompare(b.id));
  writeFileSync(file, JSON.stringify(store) + '\n');
}

const all = store.rounds.flatMap((r) => r.calls);
for (const id of MODELS) {
  const mine = all.filter((c) => c.model === id), u = mine.filter((c) => c.usage);
  const avg = (f) => u.length ? Math.round(u.reduce((a, c) => a + (f(c) || 0), 0) / u.length) : '-';
  console.log(`${id.padEnd(32)} calls ${mine.length} | out ${avg((c) => c.usage.out)} (reasoning ${avg((c) => c.usage.reasoning)}) | errors: ${[...new Set(mine.filter((c) => c.error).map((c) => c.error.slice(0, 60)))].join(' / ') || '-'}`);
}
console.log('HTTP calls this run', http, '| spent this run (failures at worst case):', spent.toFixed(6), capped ? '(cap reached)' : '');
