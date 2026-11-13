# DESIGN.md — Herd Check (#19183)

Design gate: Fable (high), 2026-11-13. Checked on GET /v1/models today: every model in §5 is `paid_only=false` with listed prices; 38 core text models are free. Google, Anthropic, Qwen are paid-only.

**Verdict: GO.** All ten rivals compare answers to *each other* (side by side, camps, embeddings, votes, distance from the pack). None compares them to the *truth*. We ask every model the same question whose answer code computes, so the page can say when the herd is wrong. It is the post's finding moved from opinions to facts: do models share the same mistake? On theme (one identical question to every model), and the only entry whose every judgment is checkable.

Three changes to the brief:
1. **The visitor picks after seeing the anonymous vote** ("7 said Tuesday, 2 said Wednesday"), not before. They feel the pull of the majority, and are scored against "always follow the herd".
2. **Generators also compute named lures** (the answer a known shortcut gives), so a shared wrong answer has a cause on screen.
3. **No repeats.** Same Take owns self-agreement. One call per model per question; the budget goes to more questions.

## 1. Name
**Herd Check** — agreement isn't accuracy.

Description (191 chars): `Every model gets one question that code can answer. See the anonymous vote, pick the answer you trust, then reveal: was the herd right, and who made the same mistake? Free replays, live BYOP.`

## 2. Questions
`gen(family, seed, level) -> { prompt, truth, lures: {label: value}, show }`, pure, PRNG mulberry32(seed). `show` is the working the reveal prints. Truth is never stored.

| family | question | truth | lures | canonical value |
|---|---|---|---|---|
| `weekday` | "What day of the week was 14 March 1937?" (1900–2099) | `Date.UTC(...).getUTCDay()` | day before, day after | weekday name |
| `letters` | "How many times does the letter r appear in: `<3 or 5 words>`?" Words from a 60-word list in `quiz.js`; the letter appears ≥ 2 times | count | truth − 1 | integer |
| `product` | "What is 4827 × 6153?" (L1 3×3 digits, L2 4×4) | `a*b` | none | integer |
| `count` | "How many of these numbers are odd / even / greater than T / divisible by 3: `<10 or 18 two-digit numbers>`?" | filter | ±1 | integer |
| `reverse` | "Write this string backwards: `tavorimeku`" (random consonant-vowel string, L1 8 letters, L2 12) | reversed | none | a–z string |
| `lure` | Three classic puzzles with seeded numbers: pen + notebook cost T, notebook costs D more, pen in cents; N machines N minutes N parts, M machines M parts; doubles daily, full on day D, half on which day | (T−D)/2; N; D−1 | T−D; M; D/2 | integer |

Level 2 by default; `weekday` and `lure` have one level.

**The request** is one user message, identical for every model:
```
{question}

Reply with one line only, in exactly this form:
ANSWER: <{a weekday name | a whole number | the string}>
```
Fresh random `seed` per call, no temperature. Models listing `reasoning_effort`: `reasoning_effort: "low"`, `max_tokens: 1500`. Others: `max_tokens: 100`. So thinkers think privately and the rest answer in one shot; the page says so and splits results by type.

**`parse(raw, family)`**, strict:
1. Remove `<think>…</think>` blocks. Empty after trim → `empty`.
2. Take the **last** line matching `/^\W*ANSWER\W*[:=]\s*(.+)$/im`; strip surrounding `* \` " ' .` and spaces. No such line → `format`. No fallback to "the last number in the text".
3. Per family: weekday `/^(mon|tue|wed|thu|fri|sat|sun)/i` → full name. Integer: leading `-?\d[\d,_ ]*`, separators dropped; `format` if another digit follows in the rest ("5 or 6"), a trailing unit word is fine. Reverse: lowercase, keep a–z only; empty → `format`.

Result per reply: `right`, `wrong` (parsed, not the truth), or no answer (`empty`, `format`, `error` = HTTP failure after one retry on 429/5xx). No answer never discards the question; it counts as not right and shows its raw reply or error text.

**Same wrong answer:** two models share an error on a question when both are `wrong` with the identical canonical value. No fuzzy matching in any family. A wrong value equal to a lure carries the lure's label.

**Herd:** the most common parsed value on a question, held by ≥ 2 models with no tie for first; otherwise "no herd". Agreement = herd size ÷ models asked.

## 3. Screens
**Play (landing, no sign-in).** A recorded round, unseen ones first (localStorage):
1. The question, and the vote: each distinct answer with a count, no model names, no truth. No-answers shown as a count.
2. Pick one answer, or "none of these is right".
3. Reveal in place: the truth with `show` (letters highlighted, the date arithmetic, the filtered list); model names on every answer; lure labels; "herd right / herd wrong / no herd"; who stood alone and was right. Folded per model: the actual request, seed, tokens (reasoning tokens when reported), cost, raw reply as text.

Score line: **You k/n · Herd k/n · best single model k/n.** "None of these" is right only when no model gave the truth. No herd counts as a herd miss.

**Results (always below, recomputed from raw replies, counts only).**
- *Does agreement predict accuracy?* Three bars: agreement ≥ 75%, 50–74%, < 50% or no herd; each "herd right k of n". Under it, links to every round where the herd was wrong and to the models that were right against it.
- *Shared mistakes.* Per family: wrong answers, how many matched another model's wrong answer, how many matched a named lure. Then a model × model grid, cell = "same wrong answer / both wrong", rows grouped thinkers then one-shot.
- *Per model.* Right / wrong / no answer, per family, mean reasoning tokens, "right against the herd" count.
- A sentence under each view is built from the counts. Nothing is called significant.

**Live (after sign-in).** Families (default: all), models (default: the recorded set; any free, non-community text model with listed prices, max 12), questions 1 / 3 / 5. Each question gets a `crypto.getRandomValues` seed, shown, so it has never been asked and anyone can regenerate it. Shows "about 0.008 Pollen, stops at 0.03". Start checks `isTrusted`; Stop. One question at a time, its models in parallel; before each question the worst case for all its calls is reserved, and the run stops if that passes the cap. Same pick-then-reveal. Live rounds feed a separate "Your live run" panel through the same `stats()`; never mixed with the recording, never filled from it. HTTP errors shown verbatim.

## 4. Data and files
`recordings/rounds.json`
```json
{ "app": "herd-check", "recordedAt": "...", "promptSha": "...",
  "models": [{ "id": "...", "title": "...", "lab": "...", "effort": true }],
  "rounds": [{ "id": "q07", "family": "weekday", "level": 2, "seed": 123456,
    "calls": [{ "model": "...",
      "request": { "max_tokens": 1500, "seed": 1, "reasoning_effort": "low", "messagesSha": "..." },
      "raw": "...", "usage": { "in": 0, "out": 0, "reasoning": 0 }, "cost": 0, "ms": 0, "error": "..." }] }] }
```
The question text, truth and verdicts are not stored: rebuilt from `(family, level, seed)`, pinned by `messagesSha`.

`js/{config,quiz,net,app}.js`, UMD, namespace `HC`. `quiz.js` = PRNG, generators, `request()`, `parse()`, `judge()`, `herd()`, `stats()`; no DOM, no network. `net.js` from under-oath. `tools/record.mjs` = under-oath's `call()` and spend guard. `<polli-connect>` alpha.31, own `pk_` key, Made-with badge.

## 5. Recording plan
Nine models, seven labs: `openai/gpt-6-luna`, `openai/gpt-5-nano`, `openai/gpt-oss-20b`, `nvidia/nemotron-3.5-lightning`, `deepseek/deepseek-v4.1-flash`, `z-ai/glm-5.3-flash`, `minimax/minimax-m3.1-flash` (thinkers); `meta/llama-3.3-70b-instruct`, `mistralai/mistral-large-3` (one-shot, no `reasoning_effort`).

`minimax-m3.1-flash` is "degraded" today (84% success) and failed calls are billed: use it only if its success rate is ≥ 95% at record time, else `minimax/minimax-m3` (twice the price) with 7 rounds per family. Left out: `stealth/glyph-cluster` (no listed price, retains prompts), `x-ai/grok-4.3` and `moonshotai/kimi-k2.6` (one call costs as much as a whole round).

6 families × 8 = **48 rounds × 9 models = 432 calls**, no repeats.

| | calls | Pollen |
|---|---|---|
| Expected (110 tokens in, 500 out per thinker, 15 per one-shot) | 432 | **0.075** (0.0016 per round) |
| With `minimax-m3`, 42 rounds | 378 | 0.079 |
| Ceiling (every thinker burns 1500 tokens) | 432 | 0.22; 0.44 if every call is also retried |
| Pilot: 2 rounds per family | 108 | ~0.02, cap 0.05 |

Hard cap for the full run: **0.15**, checked before every call at worst case; failed calls are charged at worst case. The recorder skips round ids already in the file, so the pilot's 12 rounds are the first 12 of the 48.

After the pilot: re-estimate from real tokens; over 0.10 projected → 6 rounds per family. A family with ≤ 2 of 18 right drops to level 1 and its pilot rounds are re-recorded. A family with 18 of 18 right stays; we report it.

Live: about 0.008 for 5 questions on the default nine, 0.023 worst; default cap 0.03.

## 6. Tests (`node --test`)
1. Generators: fixed vectors per family; same seed → same question; 500 seeds per family: truth valid, every lure ≠ truth, the letter appears ≥ 2 times.
2. `weekday` against known dates (1 Jan 2000 Saturday, 29 Feb 2024 Thursday).
3. `parse`: plain, `**ANSWER: Tuesday.**`, two ANSWER lines (last wins), `<think>` block, "1,234", "5 minutes", "5 or 6" → format, "Answer is 5" → format, empty.
4. `judge` and lure labels.
5. `herd`: clear lead, tie → none, a single vote → none, no-answers in the denominator.
6. `stats` on a small fixture: buckets, shared-error counts, pair grid.
7. `request`: thinker vs one-shot bodies.
8. Recordings: every `messagesSha` rebuilds; seeds unique; each call has `raw` or `error`; no `sk_`; nine calls per round; listed models are not paid-only in the snapshot.

## 7. Not building
- Typed questions (no ground truth: that is the other ten apps).
- Repeats, embeddings, similarity, a judge model, significance tests.
- Visible working for one-shot models, effort selector, JSON mode, streaming.
- Lenient parsing, format retries.
- Leaderboard, share links, images, audio.

Build order: `quiz.js` + tests → pilot → full recording → play and reveal → results → live.

Open: reasoning tokens per call are a guess (the pilot measures them); difficulty is untested, so the herd may simply be right every time. If it is, the page says that.

## Changed after this design
- `minimax/minimax-m3.1-flash` was "degraded" (84% success) at record time, so the recording uses `minimax/minimax-m3` with 7 rounds per family (42 rounds, 378 calls), as planned above.
- Pilot (12 rounds, 0.013 Pollen): no family had ≤ 2 of 18 right, so every family stayed at its level. The trick-question family went 18 of 18; it stays and the page reports it.
- Nemotron 3.5 Lightning and MiniMax M3 sometimes hit `max_tokens: 1500` before answering (`HTTP 400`). That is kept as a real error (no answer), not retried with a larger limit, so every model runs under the same request.
- The thinker/one-shot split shows as a "kind" column and the grid order rather than separate tables.
- The main set ended with the herd right on 41 of 42 and never wrong. With the user's approval, a harder set was recorded after it (24 rounds, ids `h01`–`h24`, level 3 of letters, product, count, reverse: 8 words, 5×5 digits, 30 numbers, 20 letters). The herd was right on all 24. Both sets are published and shown apart; the page says the harder set came second and why.
- Total: 66 rounds, 594 calls, 0.071 Pollen charged (0.060 by `usage`; failed calls are billed).
- Pre-submission review: `parse()` also drops everything up to a stray closing `</think>` (GLM-5.3-Flash in h08, h20; only those two verdicts change), and strips `<>[]()` around the answer. The play screen deals close votes first, live runs can pick level 3, and the spend line counts failed calls at the worst case.
