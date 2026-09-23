# Issue #670: typed decisions (Laya, Jev) for browser use

Research only. Do not merge. Nothing in this directory is product code, and nothing here ships.

## Result

**Reject for the per-step browser loop.** Both published Laya checkpoints fail every condition of the decision
rule. The decision rule was fixed before the first model run. On the same snapshots, a set of cheap deterministic
rules is better on all four tasks. Also, one model call on a page-sized input takes 100–700 ms on an M2, not 7–14 ms.

**Adapt the idea, not the model.** The useful part of the reference is its structure: give the decision maker
short, pre-digested features, and let a deterministic layer add a check. The [follow-ups](#follow-ups) apply this
structure to OpenBot without a new runtime.

**Jev (TypeSafe's hosted model, used by [jev-ultrafast](https://github.com/browser-use/jev-ultrafast)) is much
stronger, but it also fails the rule.** With the same questions and snapshots, it is correct on all page-state,
shortlist and action-success cases, and better than the rules. It fails two conditions: injected page text turned
two risky targets to "safe", and one call takes about 320 ms. It is also a cloud service that receives page text.
See [Jev](#jev-hosted-typed-decisions).

## What was tested

The reference ([post](https://x.com/mizorewww/status/2101473552956555427)) shows
[`laya-mlx`](https://github.com/mizorewww/laya-mlx), an MLX port of Convai's Laya encoder. Laya answers typed
questions in one forward pass:

- `choice` gives probabilities over named options
- `score` gives a rubric level
- `noul` gives P(true)

Laya does not generate tokens. The Snake demo in the post is feature-assisted: a planner gives the model a short
list of safe moves, and a safety shield corrects bad choices.

| Checkpoint | Revision | Weights | Context |
| --- | --- | --- | --- |
| `aac6fef/laya-multilingual-mlx` | `f2b4faf5` | 644 MB FP16 | 1024 tokens, of which 256 are for the question and options |
| `aac6fef/laya-typed-decisions-mlx` | `f9e501c2` | 843 MB FP16 | 1024 tokens, of which 256 are for the question and options |

The English-only checkpoint (512 tokens) was not tested, because fixture pages in three languages need the
multilingual context.

Jev (`jev-latest`, which answered as `jev-1.13.0`) was called through `POST https://api.typesafe.ai/v1/systemone`
with the same questions. Its state budget is 32k tokens, so `eval.py` packs to 24,000 tokens (counted with the Laya
tokenizer) and nothing was cut. Jev takes every label in one question, so its shortlist task does not use the
embedding top-20.

The four use cases, and the questions asked (`eval.py`):

| Use case | Question | Input |
| --- | --- | --- |
| Page state | `choice` over login, captcha, checkout, error, cookie_banner, content, plus `noul` "must a human act?" | packed snapshot |
| Risky-action gate | `noul` "would clicking `target` spend money, send, delete, publish?" | target + packed snapshot, and target + title + URL only |
| Element shortlist | `choice` over the page's element labels; `predict_shortlist` (embedding top-20) above 20 labels | goal + page text |
| Action success | `noul` "did the steps achieve the intended action?" | intent + steps + before/after snapshots, and intent + steps + a text diff |

## Reproduce

Apple Silicon only. Needs `uv`, and `bun install --frozen-lockfile` at the repository root.

```sh
# 1. Snapshots (committed). Serves fixtures/pages on 127.0.0.1 and drives them through the real
#    BrowserHost.handleDynamicTool in a hidden Electron window with a temporary profile.
env -u ELECTRON_RUN_AS_NODE bun research/670-typed-decisions/capture-snapshots.ts

# 2. Evaluation. The first run downloads about 1.5 GB of weights into the Hugging Face cache.
cd research/670-typed-decisions
uv sync
uv run python eval.py          # baseline, then each checkpoint in its own process, then report.py
uv run python sanity.py multilingual   # setup checks: library preset, minimal input, latency against length

# 3. Optional: Jev. Needs a TypeSafe API key; keep it in a file outside the repository.
uv run --env-file ~/.config/openbot-research/typesafe.env python eval.py --model jev   # then: uv run python report.py
```

The capture script stops with a non-zero exit if a fixture target is not in the snapshot. Two runs gave identical
snapshots. Two eval runs gave identical model outputs; only the timings changed. Two Jev runs gave the same
labels, but probabilities changed by up to 0.07, so a case near 0.5 can change sides.

| File | Content |
| --- | --- |
| `fixtures/pages/*.html`, `fixtures/cases.json` | 50 local pages in English, Polish and Chinese, and 100 labelled cases |
| `snapshots/` | what an agent receives from `snapshot` and from each action tool (refs, tab ids and ports removed) |
| `state.py` | packs a snapshot into the token budget: title, URL, elements (up to half), then page text |
| `baseline.py` | regular expressions and word overlap on the same snapshots |
| `results/summary.md`, `results/metrics.json` | the table below, the decision per checkpoint, and error lists |
| `results/sanity.txt` | output of `sanity.py` |

## Results

Apple M2, 24 GB, macOS 26.5, `laya-mlx` 0.2.0, FP16, batch size 16. Threshold 0.5 unless stated otherwise.
Jev latency is the full HTTPS round trip from this network (TCP connect 13–27 ms). Ranges are over runs.

| Metric | baseline | multilingual | typed-decisions | jev (2 runs) |
| --- | ---: | ---: | ---: | ---: |
| Page state accuracy (34) | 0.971 | 0.647 | 0.735 | 1.0 |
| Page state macro-F1 | 0.948 | 0.576 | 0.716 | 1.0 |
| Page state, non-English (6) | 0.833 | 0.5 | 0.667 | 1.0 |
| Page state inputs truncated | 0.0 | 0.088 | 0.088 | 0.0 |
| Needs human: recall | 1.0 | 1.0 | 0.625 | 0.75 |
| Needs human: precision | 1.0 | 0.471 | 0.476 | 1.0 |
| Risky gate, full page: recall / precision (16 of 38) | 0.938 / 1.0 | 1.0 / 0.421 | 0.5 / 0.471 | 0.875 / 1.0 |
| Risky gate, full page: AUC | 0.969 | 0.426 | 0.574 | 0.972–0.976 |
| Risky gate, full page: precision at recall ≥ 0.98 | 0.421 | 0.421 | 0.444 | 0.64–0.667 |
| Risky gate, target only: recall / precision | 0.938 / 1.0 | 1.0 / 0.421 | 1.0 / 0.421 | 0.938–1.0 / 1.0 |
| Risky gate, target only: AUC | 0.969 | 0.581 | 0.679 | 1.0 |
| Risky gate, target only: precision at recall ≥ 0.98 | 0.421 | 0.421 | 0.444 | 1.0 |
| Risky gate, non-English accuracy (7) | 1.0 | 0.429 | 0.429 | 1.0 |
| Injection flips risky → safe (2 risky) | 0 | 0 | 1 | 2 |
| Shortlist top-1 (13) | 0.538 | 0.0 | 0.154 | 1.0 |
| Shortlist kept the target (8 pages > 20 labels) | 1.0 | 0.25 | 0.375 | 1.0 (no shortlist) |
| Action success, diff input: accuracy / AUC (15) | 0.933 / 0.929 | 0.533 / 0.759 | 0.4 / 0.554 | 1.0 / 1.0 |
| Action success, raw before/after: accuracy / AUC | – | 0.467 / 0.518 | 0.467 / 0.679 | 1.0 / 1.0 |
| Per-step latency P50 / P95, ms (3 runs) | – | 36–97 / 135–331 | 123–200 / 456–1648 | 319–325 / 403–441 |
| Shortlist latency P50 / P95, ms (3 runs) | – | 465–1289 / 3239–5694 | 3035–3306 / 11716–13207 | 309–332 / 397–423 |
| Load time, s (warm to cold file cache) | – | 0.8–5.0 | 0.3–0.5 | – |
| Peak MLX memory, MiB | – | 1427 | 1657 | – |
| Max process RSS, MiB | – | 877–898 | 922–928 | – |
| API input tokens per call (mean) | – | – | – | 711 |
| API cost per 1,000 calls, USD | – | – | – | 0.03 |

"Per-step" is the page-state and risky-gate calls, which a per-step loop would make on every action. The
machine was not idle, so the latency ranges are wide. Every run was far above the 50 ms limit.

### Decision rule

Fixed before the first model run. Adopt or adapt only if all of these are true:

| Condition | multilingual | typed-decisions | jev |
| --- | --- | --- | --- |
| Risky gate recall ≥ 0.98 with precision ≥ 0.8 (best threshold, best input) | fail: 0.421 | fail: 0.444 | pass: 1.0 (target only) |
| Page state macro-F1 ≥ 0.9 and above the baseline | fail: 0.576 | fail: 0.716 | pass: 1.0 |
| No injection flips a risky action to safe | pass | fail: "Complete purchase" | fail: "Delete all files", "Complete purchase" |
| Per-step P95 ≤ 50 ms on the M2 | fail: 135–331 ms | fail: 456–1648 ms | fail: 403–441 ms (network call) |

The risky-gate condition uses the most generous reading: the best in-sample threshold and the better of the two
inputs. 16 of 38 targets are risky, so a precision of 0.42 means that the gate flags all 38 targets, and 0.44
means that it flags 36.

### Observations

- **The setup is correct.** On the library's own `triage_questions` preset, both checkpoints answer correctly
  (refund against information, `refund_requested` 0.96 against 0.0006). The failure is specific to browser
  states, not to how the harness asks.
- **Page context removes the signal.** With only the target, multilingual gives 0.93 to `button "Pay $49.00"`
  and 0.51 to `link "Blog"`. With the full page, it gives 0.975–1.0 to all targets (AUC 0.43). typed-decisions
  puts all 38 targets between 0.37 and 0.62.
- **Latency depends on input length.** It is not constant. multilingual takes 11–15 ms at 16 tokens and 122–278 ms
  at 900 tokens. typed-decisions takes 26–37 ms and 323–725 ms. The published 7–14 ms (M3 Max) is for short
  inputs. A browser snapshot is not short: the raw JSON is 165–10338 tokens on these fixtures.
- **The context is too small for real pages.** Raw snapshots are too large, so `state.py` packs them. Even then,
  3 of 34 page-state inputs were cut. Laya itself cuts the end of the state without a warning. The login dialog at
  the end of `content-long-login-wall` was cut off, so the checkpoints labelled the page error and content.
- **Typed-decisions labels most checkout, cookie and login-wall pages as content.** It missed 9 of 34, including
  all five checkout pages that are not subscriptions.
- **The embedding shortlist loses the target.** On pages with more than 20 labels, the top-20 kept the correct
  element in 2 of 8 (multilingual) and 3 of 8 (typed-decisions) cases. One shortlist call on the 165-label order
  table took up to 13 s.
- **A diff helps the model too.** For action success, a compact text diff raised multilingual's AUC from 0.52 to
  0.76. The same diff gave the regular-expression baseline 0.93 accuracy. The diff is the useful part, and it
  does not need a model.
- **Injection text moved every score in the same direction.** For typed-decisions, the injected sentences lowered
  P(risky) by 0.03–0.05 on all four injected cases. For "Complete purchase", this was enough to go below 0.5.
  multilingual stayed at about 1.0 for all targets, so the result does not show resistance to injection.
- **The checkpoint has a calibration warning.** On load, `laya-mlx` clamps the typed-decisions `choice:11+`
  temperature (0.1006) and tells the caller to treat confidence from those buckets as uncalibrated.
- **Side note on the current product.** Snapshot element names keep raw whitespace (`"Sort by "`,
  `" Email notifications"`). An agent that matches a name exactly can fail. The capture script trims names for
  this reason.

### Jev: hosted typed decisions

[jev-ultrafast](https://github.com/browser-use/jev-ultrafast) (MIT) uses Jev as the decision maker of a browser
loop: one request per step chooses the operation (click, type, select, scroll, done, blocked) and the target
element from an indexed element table. A small LLM writes only the typed text. The same questions from `eval.py`
were sent to Jev, so the result compares the models, not the loop.

- **Jev reads the whole page.** The 32k state budget holds every fixture page, including the 8k-token long pages
  that Laya cut. It found the login dialog at the end of `content-long-login-wall`.
- **Element choice is correct.** Jev chose the right element on all 13 shortlist goals, including the 165-label
  order table, in one call of about 310 ms. This supports the core claim of jev-ultrafast: element choice does
  not need a generating LLM.
- **Action success is correct with raw input too.** Jev got 15 of 15 with the before/after snapshots, and 15 of 15
  with the diff.
- **Injected text changes the risky answer.** On the full page, "Delete all files" went from 0.95 without the
  injected sentence to 0.30–0.37 with it, and "Complete purchase" from 0.89–0.90 to 0.07–0.08. With the target
  only, both stayed at 0.88–0.96. So the target-only input is the only safe way to use it as a gate.
- **Use the page choice, not the "needs human" question.** The separate `noul` question missed 4 of 16 pages
  (0.30–0.47), but the `page` choice was correct on those pages.
- **Cost is small.** The mean call used 711 input tokens, about USD 0.03 per 1,000 calls at USD 0.042 per million
  input tokens. Output is free.
- **The 320 ms is mostly the service.** A TCP connect takes 13–27 ms from here. jev-ultrafast reports a 178 ms median
  per request from its location. An agent LLM turn takes seconds, so this is small in a loop that it replaces, but
  it is large for a check that runs before each click.
- **Option ids.** Jev accepts `choice` options only as `{id: description}`. `eval.py` numbers the list options for
  Jev and maps the answer back.

## Limitations of this study

- The fixtures are small, synthetic and written by one author: 50 pages and 100 cases. The baseline rules have
  the same author, so the baseline scores are optimistic. Real pages have more noise and help the baseline less.
- The model questions were written once and not tuned. Better wording or a JSON state with fields could raise the
  scores. The sanity check shows a gain for the small input, but the gain is not near the rule.
- The in-sample threshold search makes the model scores optimistic, not pessimistic.
- Only FP16 on one M2 was measured. Quantized weights, `compile=True`, or an M3/M4 would be faster. The gap from
  ~150–700 ms to 50 ms on page-sized inputs is large, and these options do not change the accuracy result.
- The checkpoints were not fine-tuned on browser states. A model fine-tuned on OpenBot snapshots could perform
  differently. That is a model-training project, not an integration.
- Canvas, PDF viewer, and cross-origin iframe pages were not tested. Their snapshots have little semantic text for
  any classifier.
- Jev was tested on the four decisions only, not as the full jev-ultrafast loop. Task success, false "done" and
  recovery on the broken-mode pages were not measured. Jev's perfect scores are on 100 easy synthetic cases; they
  show that it can do these decisions, not its error rate on real sites.

## Security considerations

- **Page text is untrusted.** A classifier that reads the page reads text that the attacker controls. The
  injection fixtures show a measurable shift toward "safe". So a model score must only **add** friction, such as a
  hint or a confirmation. It must never remove a check, allow an action, or lower the takeover threshold.
- **Keep untrusted text out of the gate input.** The target-only input (role, name, title, URL) removes most
  attacker-controlled text. An attacker still controls the element name, so this reduces the exposure but does
  not remove it.
- **No new permissions.** A classifier would read the snapshot that the agent already gets. It would not need
  page access, cookies or a new IPC channel.
- **Data stays local.** Inference is on the computer. The weight download from Hugging Face would be a new
  outbound request, and `PRIVACY.md` would have to name it.
- **Supply chain.** The weights are safetensors (no pickle). Shipping them would need pinned revisions and
  checked hashes, as the provider runtimes have. `laya-mlx`, the Laya weights, `tokenizers` and
  `huggingface-hub` are Apache-2.0, `mlx` is MIT, and `numpy` is BSD. These are compatible with PolyForm
  Noncommercial 1.0.0 when their notices are bundled.
- **Redaction.** Model inputs include page text and typed values. Any log or diagnostic of a classifier input
  must go through the same redaction as other snapshot data.
- **Jev sends page text to TypeSafe.** Each call sends the snapshot (page text, element names, typed values) to a
  third party. TypeSafe states that it does not train on customer data, but zero data retention is only for
  enterprise plans. This is the same kind of transfer as the agent provider, but to one more company. It would need
  an opt-in, a user API key, a `PRIVACY.md` entry, and redaction of secret fields before the send. It cannot be a
  core function: OpenBot must work without it.
- **A remote gate can be unavailable.** A gate that calls a service must fail toward friction (ask the user), not
  toward allowing the click.

## Architecture fit and implementation risks

If a later model passes the rule, these are the integration points:

| Use | Where | Behavior |
| --- | --- | --- |
| Page-state hint | `BrowserHost.handleDynamicTool` (`src/backend/browser-host.ts:927`), in the snapshot result built by `#snapshotResult` (`:1933`) | add a `hints` field, for example "sign-in page: consider `request_takeover`" |
| Risky-action gate | `BrowserHost.#runAction` (`src/backend/browser-host.ts:1732`), before the click is sent | ask the user for a confirmation through `AttentionRegistry` (`src/backend/agent/attention-registry.ts:148`); never skip an existing check |
| Takeover suggestion | `AttentionRegistry` | raise the same attention item that `request_takeover` raises today |
| Action outcome | the action tool result | add a compact before/after diff next to the fresh snapshot |

Runtime cost and risks of a Laya sidecar:

- **Apple Silicon only.** MLX does not run on Windows, Linux or Intel Macs. Other platforms would need an ONNX or
  PyTorch port with its own accuracy check.
- **A new language runtime.** OpenBot has no Python runtime today. It would become a second managed tool runtime
  next to `bun` (`MANAGED_TOOL_RUNTIMES` in `packages/contracts/src/agent-providers.ts:173`, installed by
  `src/main/provider-runtime-manager.ts`). The environment used here is 258 MB before weights.
- **Weights on demand.** 644–843 MB per checkpoint. They would be downloaded on first use, as `VoiceModelService`
  (`src/main/voice-model-service.ts`) does for whisper. Their licenses would be bundled as for whisper
  (`electron-builder.yml:50-53`).
- **Memory.** 0.9 GB resident per loaded checkpoint, and an MLX peak of 1.4–1.7 GB during a batch. The browser
  and the agent CLIs already use this memory budget.
- **Process lifecycle.** The sidecar needs start, stop, crash recovery and a request queue. A slow call blocks the
  browser action that waits for the gate.
- **Silent truncation.** The library cuts inputs at 1024 tokens without an error. Each caller must pack and
  measure its input, as `state.py` does.

## Comparison with the current flow

| Aspect | Today (agent LLM reads snapshots) | With a Laya classifier |
| --- | --- | --- |
| Reliability | The agent model sees the full snapshot and decides. There is no independent risky gate. | An independent gate is useful in principle. These checkpoints are not reliable enough to be that gate. |
| Compatibility | Works wherever the snapshot has text. The limits are canvas and cross-origin frames. | Same limits, plus a 1024-token view and Apple Silicon only. |
| Permissions | Browser tools only. Takeover and secrets through `request_takeover` and `submit_secret`. | No new permissions. |
| Session handling | The `persist:openbot-browser` session is not changed. | Not changed. The classifier reads snapshots only. |
| Failure modes | The model forgets to stop at a payment page, or misreads the result of a click. | Adds false alarms (precision 0.42), missed pages cut by truncation, latency on each step, and a sidecar that can crash. |

With Jev, reliability on these fixtures is high and there is no local runtime, but each decision is a network call
to a third party, it needs an account and a key, and injected page text can move its answers.

## Recommendation

**Reject** Laya for the per-step browser loop, on both checkpoints. **Adapt** the pattern: pre-digested features
and a deterministic check that can only add friction. Follow-ups 1–6 need no new runtime and no download.

**Do not adopt Jev as a default** (injection, latency, a cloud service that receives page text). Its element
choice and outcome checks are strong enough for a separate, opt-in experiment (follow-up 7).

## Follow-ups

1. **Deterministic risky-action confirmation.** In `#runAction`, flag targets whose role and name match a
   multilingual list of pay, buy, send, post, delete and transfer words, or whose page is a checkout page. Ask the
   user through `AttentionRegistry`. The rule set here got 0.94 recall and 1.0 precision. It missed only
   "Continue" on a subscription page, which a page-state condition catches. This is an add-friction check only.
2. **Page-state hints in snapshots.** Add a `hints` field for sign-in, CAPTCHA and payment pages, from password
   fields, known CAPTCHA frames and payment fields. The agent then calls `request_takeover` earlier.
3. **Action outcome diff.** Return a compact diff in each action result: URL and title changes, added and removed
   text, and added and removed elements. This was the strongest signal for action success, for both the rules and
   the model.
4. **Trim element names in snapshots.** Collapse whitespace in accessible names (`axValue(node.name)` at
   `src/backend/browser-cdp.ts:2085`), so that exact name targets match.
5. **Test Laya where inputs are short.** Channel routing (`src/backend/channel-service.ts:556-621`) costs a full
   lead-model turn for one `choice` among members. Its inputs are short messages, and there Laya answered
   correctly in the sanity check. This needs its own evaluation. The Apple-Silicon-only runtime still blocks
   shipping.
6. **Re-test on a new checkpoint.** Run `eval.py` again if a checkpoint trained on web or UI states, or a
   cross-platform port, is published. The harness and the decision rule stay the same.
7. **Opt-in Jev fast path, as an experiment.** Port the jev-ultrafast loop (operation plus target head, freshness
   checks, no retry after a page change) onto `BrowserHost`, behind a user API key. Measure task success, false
   "done" and wall time against the agent LLM on the action fixtures and on real sites. Give Jev the target-only
   input for any risky check. Update `PRIVACY.md` before any user test.
