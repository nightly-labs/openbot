# Plan 006: A provider process exit ends only the work of that process

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before you start the
> next step. If a "STOP conditions" item occurs, stop and report. Do not
> improvise. When done, set the state of this plan in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat ac4880d86..HEAD -- src/backend/agent-service.ts src/backend/agent/context-compaction.ts src/backend/agent/turn-lifecycle.ts src/backend/agent/provider-runtime.ts src/backend/browser-control-sessions.ts`
> If one of these files changed, compare the "Current state" excerpts with the
> live code. On a mismatch, STOP.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `ac4880d86`, 2026-10-17

## Why this matters

OpenBot runs agents on provider processes (Codex, Claude, Grok and others).
Most agents share one process for each provider. Some agents have a process of
their own: a Codex agent on a second account, or a Grok or OpenCode agent with
workspace access (`ProviderRuntime.runsOnOwnProcess`). When one process exits,
`onProviderLost` runs. Two of its calls act on **all** agents, not on the agents
of the lost process:

1. `this.#compaction.dispose()` clears the context compaction state of every
   agent. The drain guard `mayDrain` then lets the queue of an agent on another
   process start a turn while that agent still compacts. The agents of the lost
   process lose their compaction record with no "failed" state and no drain.
2. `this.#browser.clearControls()` removes the browser control sessions of every
   agent, so the controls of an agent on another provider disappear while its
   turn still uses the browser.

The two sibling hooks, `onClientStopped` and `onAgentClientLost`, already do the
scoped work with `this.#compaction.clientEnded(client)`. This plan makes
`onProviderLost` do the same.

## Current state

- `src/backend/agent-service.ts:588-600` — the hook:
  ```ts
  onProviderLost: (client) => {
    this.#boot.orphanDeliveriesOf(client.provider, (agentId) => this.#providers.runsOnOwnProcess(agentId));
    this.#compaction.dispose();
    this.#attention.clearPrompts(client);
    this.#attention.clearBrowserTakeovers(client);
    this.#attention.clearApprovals(client);
    this.#browser.clearControls();
    Effect.runFork(
      this.#turn
        .interruptTurnsOf(client, { keepRecoverable: true })
        .pipe(Effect.forkIn(this.#scope, { startImmediately: true })),
    );
  },
  ```
- `src/backend/agent-service.ts:601-616` — the sibling hooks call
  `this.#compaction.clientEnded(client)` and `yield* this.#turn.interruptTurnsOf(client, ...)`.
  They do not call `clearControls`.
- `src/backend/agent-service.ts:3114` — `stop()` calls `this.#browser.clearControls()`.
  That call is correct (shutdown). Do not change it. `dispose()` of the compaction
  on shutdown (near line 3092) is also correct.
- `src/backend/agent/provider-runtime.ts:2937-2944` — `#handleExit(client, error)` is
  the only caller of `onProviderLost`. It runs only for the shared client of a
  provider (`this.#clients.get(client.provider) === client`).
- `src/backend/agent/context-compaction.ts:377-386` — the scoped release:
  ```ts
  /** The client stopped or exited, so the compactions and refusals it held end with it. */
  clientEnded(client: AgentClient): void {
    for (const [agentId, compaction] of this.#compactingAgents) {
      if (compaction.client !== client) continue;
      this.observeCompaction(compaction.threadId, "failed");
      this.#release(agentId, compaction.threadId);
      this.#scheduleDrain(agentId);
    }
    for (const [agentId, hold] of this.#refusals) if (hold.client === client) this.#endRefusal(agentId);
  }
  ```
  `dispose()` at lines 388-400 clears every map and sends no event.
  `mayDrain(agentId)` at line 185 is `!this.#compactingAgents.has(agentId) && !this.#refusals.has(agentId)`.
- `src/backend/agent/turn-lifecycle.ts:283-307` — `interruptTurnsOf(client, { keepRecoverable })`.
  For each running turn of `client` it either skips the turn (`continue`) when a
  delivery of the turn is `starting` or `running` and `keepRecoverable` is set,
  or completes the turn as `interrupted`. A completed turn calls
  `this.#browser.endControl(this.#conversation.publicThreadId(agentId, threadId), turnId)`
  (line 696). A skipped turn does not, so its control session stays.
- `src/backend/browser-control-sessions.ts:30-46` — `end(threadId, turnId)` removes one
  session; `clear()` removes all. Sessions are keyed by public thread and turn,
  not by client.
- Test exemplar: `scripts/codex-compaction-queue-e2e.ts` (320 lines). It sets
  `HOME`, `CODEX_HOME`, `OPENBOT_CODEX_PATH`, `OPENBOT_FAKE_CODEX_LOG` and
  `OPENBOT_FAKE_CODEX_CONTROL` before it imports the service modules, writes a
  fake Codex app-server script, builds `AgentService` with a stub `browser:
  AgentBrowserHost` (lines 177-190), drives a compaction with
  `control.json`, waits for state with `waitFor`, and writes
  `.openbot-build/codex-compaction-queue-e2e/report.json`.
  `agents.getRuntimeSnapshot().contextStates` returns the compaction display
  for each agent (`agent-service.ts:1302-1304`).

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Install (fresh worktree only) | `bun install --frozen-lockfile` | exit 0 |
| New E2E | `bun scripts/provider-loss-scope-e2e.ts` | exit 0, report `"passed": true` |
| Existing E2E | `bun scripts/codex-compaction-queue-e2e.ts` | exit 0 |
| Related tests | `bun run test:related -- src/backend/agent-service.ts` | exit 0 |
| Typecheck | `bun run typecheck:node` | exit 0 |
| Lint changed files | `biome check --write --max-diagnostics=none <changed paths>` | exit 0 |

Do not run `bun run typecheck`, builds or full suites.

## Scope

**In scope**:
- `src/backend/agent-service.ts` (`onProviderLost` only)
- `src/backend/agent/turn-lifecycle.ts` (`interruptTurnsOf` only)
- `scripts/provider-loss-scope-e2e.ts` (create)
- `changelog.d/<branch>.md` (create; see `changelog.d/README.md`)

**Out of scope**:
- `stop()` and `dispose()` in `agent-service.ts`. Shutdown must clear everything.
- `this.#conversation.clearLoadedThreads()` in `provider-runtime.ts`. It only makes
  threads load again; it loses no state.
- `boot-recovery.ts` (`orphanDeliveriesOf` is already scoped).
- `context-compaction.ts`. `clientEnded` already does the right work. If you think
  it needs a change, STOP.

## Git workflow

- Branch: `advisor/006-provider-loss-scope`.
- Commit message: one imperative sentence, for example `End only the lost process's compactions and browser controls`.
  End with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- The pre-commit hook runs checks. Never use `--no-verify`. Do not push or open a PR unless told to.

## Steps

### Step 1: Write the E2E and see it fail

Create `scripts/provider-loss-scope-e2e.ts`. Copy `scripts/codex-compaction-queue-e2e.ts`
and change it:

- The fake Codex reads `control.json` as before. Add a field `exitDuringCompaction`.
  When it is `true` and a marker file (`<root>/exited`) does not exist, the fake
  writes the marker and calls `process.exit(1)` directly after it answers
  `thread/compact/start`. A restarted fake finds the marker and runs normally.
- The stub `browser` counts calls: `clearControls: () => { calls.clearControls += 1; }`
  and records `endControl` arguments.
- One case: create an agent with an initial message (the first turn reports 90%
  of the context window), wait for the first turn to end, set
  `{ compactionMs: 60_000, ignoreInterrupt: false, exitDuringCompaction: true }`,
  send a second message, wait for `thread/compact/start` in the protocol log,
  then wait until the marker file exists.
- Checks after the exit, each with `waitFor` (never a fixed sleep):
  1. `agents.getRuntimeSnapshot().contextStates` has an entry for the agent with
     `compaction.status === "failed"`. Read the `AgentContextState` type in
     `packages/contracts` for the exact field names.
  2. `calls.clearControls === 0` before `agents.stop()` runs.
  3. The second message reaches `completed` after Codex restarts.
- Write `.openbot-build/provider-loss-scope-e2e/report.json` with
  `{ passed, checks: [{ name, passed, detail }] }` and exit non-zero on a failure.
- Header comment: what the script proves and how to run it
  (`bun scripts/provider-loss-scope-e2e.ts`).

**Verify**: `bun scripts/provider-loss-scope-e2e.ts` → exits 1; checks 1 and 2 fail.
If check 3 fails before the fix too, record it in the report detail and go on.
If the fake cannot make the service see an exit, STOP and report.

### Step 2: Scope the compaction release

In `onProviderLost`, replace `this.#compaction.dispose();` with
`this.#compaction.clientEnded(client);`.

**Verify**: `bun run typecheck:node` → exit 0. `bun scripts/provider-loss-scope-e2e.ts`
→ check 1 passes.

### Step 3: Scope the browser control end

1. In `onProviderLost`, delete the line `this.#browser.clearControls();`.
2. In `TurnLifecycle.interruptTurnsOf`, in the `keepRecoverable` branch, end the
   control session of the skipped turn before `continue`. The client is gone, so
   no browser tool of that turn can run. Target shape:
   ```ts
   if (options.keepRecoverable && /* existing delivery check */) {
     this.#browser.endControl(this.#conversation.publicThreadId(turn.agentId, turn.threadId), turnId);
     continue;
   }
   ```
   Use the same call as line 696. Keep the existing condition as it is.

**Verify**: `bun run typecheck:node` → exit 0. `bun scripts/provider-loss-scope-e2e.ts`
→ exit 0, all checks pass.

### Step 4: Run the neighbors and write the release note

**Verify**:
- `bun scripts/codex-compaction-queue-e2e.ts` → exit 0.
- `bun run test:related -- src/backend/agent-service.ts` → exit 0. If it selects
  no test file, write that in the PR body.
- `biome check --write --max-diagnostics=none src/backend/agent-service.ts src/backend/agent/turn-lifecycle.ts scripts/provider-loss-scope-e2e.ts` → exit 0.

Create `changelog.d/<branch>.md` with one `### Fixed` item, for example: "When
one provider process stops, the other agents keep their compaction state and
their browser controls."

## Test plan

- `scripts/provider-loss-scope-e2e.ts`: a real `AgentService` with a fake Codex
  that exits during a compaction. It proves that the lost client's compaction ends
  as `failed`, that no global browser clear runs, and that the queued message
  runs after the restart.
- The cross-process case (an agent on its own process keeps its compaction) needs
  a second Codex account and is not in the E2E. Review covers it: after this plan,
  `onProviderLost` has no call that is not filtered by `client`.
- Pattern: `scripts/codex-compaction-queue-e2e.ts`.

## Done criteria

- [ ] `bun scripts/provider-loss-scope-e2e.ts` exits 0; report has `"passed": true`
- [ ] `bun scripts/codex-compaction-queue-e2e.ts` exits 0
- [ ] `bun run typecheck:node` exits 0
- [ ] `grep -n "compaction.dispose()\|clearControls()" src/backend/agent-service.ts` shows only the lines in `stop()`/`dispose()` (shutdown), not in `onProviderLost`
- [ ] `git status` shows only the in-scope files
- [ ] `plans/README.md` state for 006 is updated

## STOP conditions

- The excerpts in "Current state" do not match the code.
- `onProviderLost` has a new caller other than `provider-runtime.ts` `#handleExit`.
- `clientEnded` throws or emits an error event for a client with no compaction.
- The fake Codex exit makes the service stop instead of restart (check
  `#countStartFailure` in `provider-runtime.ts`); report it, do not change the
  restart policy.
- A step's verification fails twice after a reasonable fix.

## Maintenance notes

- Any new per-agent state that a provider exit must release needs a
  `clientEnded`-style method filtered by client. Never clear all agents in
  `onProviderLost`.
- Reviewers: check that each call in `onProviderLost` takes `client` or a filter.
- `BrowserControlSessions` has no client index. If a later change adds controls
  that do not belong to a running turn, they need their own end path.
