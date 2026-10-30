# Plan 008: Mailbox reads of one delivery do not sort or scan the whole mailbox

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before you start the
> next step. If a "STOP conditions" item occurs, stop and report. Do not
> improvise. When done, set the state of this plan in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat ac4880d86..HEAD -- src/backend/mailbox-store.ts scripts/mailbox-queue-scale-e2e.ts`
> If a file changed, compare the "Current state" excerpts with the live code.
> On a mismatch, STOP.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `ac4880d86`, 2026-10-17

## Why this matters

`MailboxStore` (`src/backend/mailbox-store.ts`) keeps every message and every
delivery of the profile in two arrays, and never removes completed rows. A
profile with a long history has thousands of each. PR #2266 made the queue list
(`listQueue`) index the messages once per read. The reads of **one** delivery
did not get the same change:

- `getDelivery(id)` → `#context(delivery)` → `#publicDelivery(delivery)`, whose
  default argument `positions = this.#queuedPositions()` copies, filters and
  **sorts all deliveries** to find one number. `#requireMessage` without a map
  is a linear `find` over all messages.
- `findDeliveriesByTurn`, `unresolvedDeliveries`, `startingDeliveriesForAgent`,
  `repliesToStartWith` and `unresolvedMessagingDeliveries` call `#context` once
  for each result, so they sort all deliveries once **per result**.
- `nextQueued` calls `#taskIdOf` (a linear `find` over all messages) once for
  each queued candidate, then `#context`.

These reads are on hot paths: `routine-scheduler.ts:798-810` `#hasLiveRun`
calls `getDelivery` for each active run, `channel-service.ts` calls it about ten
times per channel event, `agent-service.ts:900` calls `nextQueued` in the
channel `busy` check, and `turn-lifecycle.ts:294` calls `findDeliveriesByTurn`
on each provider loss. Most callers read only `delivery.status`.

The fix: compute a position only for a `queued` delivery, by a count with no
sort, and let the list reads build the position map and the message map once.
There is no persistent index, so the 18 places that assign
`this.#state.messages` / `this.#state.deliveries` do not change.

## Current state

`src/backend/mailbox-store.ts` (2699 lines):

- Lines 2241-2250:
  ```ts
  #context(delivery: StoredDelivery): DeliveryContext {
    const message = this.#requireMessage(delivery.messageId);
    return {
      delivery: this.#publicDelivery(delivery),
      managedAttachments: message.attachments.map((attachment) => ({
        ...toAttachmentSummary(attachment),
        path: attachment.path,
      })),
    };
  }
  ```
- Lines 2260-2283, `#publicDelivery(delivery, positions = this.#queuedPositions(), message = this.#requireMessage(delivery.messageId))`.
  It uses `positions` only in
  `position: delivery.status === "queued" ? (positions.get(delivery.id) ?? null) : null,`.
- Lines 2285-2297, `#queuedPositions()`: sorts the queued deliveries with
  `compareQueueOrder` and numbers them from 1 for each `recipientAgentId`.
- Lines 2428-2434, `compareQueueOrder`: `queueOrder`, then `createdAt`, then `id`.
  It is a total order (ids are unique).
- Lines 2344-2348:
  ```ts
  #requireMessage(id: string, messages?: ReadonlyMap<string, StoredMessage>): StoredMessage {
    const message = messages ? messages.get(id) : this.#state.messages.find((candidate) => candidate.id === id);
    if (!message) throw new Error(`Mailbox message is missing: ${id}`);
    return message;
  }
  ```
- Lines 717-719, `#messagesById()`: builds `Map<id, StoredMessage>` (added by #2266).
- Lines 727-729, `#taskIdOf(delivery)`: `this.#state.messages.find(...)?.taskId ?? null`.
- Lines 1086-1092, `nextQueued`: `this.#queuedFor(agentId).find((candidate) => this.#taskIdOf(candidate) === taskId && !this.#isHeldReply(candidate))`, then `this.#context(delivery)`.
- Lines 1097-1115, `repliesToStartWith`; 1176-1179 `getDelivery`; 1194-1203
  `findDeliveriesByTurn`; 1215-1219 `startingDeliveriesForAgent`; 1919-1923
  `unresolvedDeliveries`; 418-431 `unresolvedMessagingDeliveries`. Each maps
  results through `this.#context(delivery)`.
- Exemplar of the "index once per read" pattern (lines 673-688, `listQueue`):
  ```ts
  const positions = this.#queuedPositions();
  const messages = this.#messagesById();
  ...
  .map((delivery) => this.#publicDelivery(delivery, positions, this.#requireMessage(delivery.messageId, messages)))
  ```
- `scripts/mailbox-queue-scale-e2e.ts` (153 lines): seeds 10,000 messages
  through the real `MailboxStore` and `OpenBotDatabase` on a temporary profile;
  2,000 deliveries go to `agent-a`, the first 1,000 are completed. It checks
  `listQueue` positions and times `listQueue` + `senderAgentIdsForRecipient`
  (`timeQueueChanges`). It writes `.openbot-build/mailbox-queue-scale-e2e/report.json`.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Install (fresh worktree only) | `bun install --frozen-lockfile` | exit 0 |
| Scale E2E | `bun scripts/mailbox-queue-scale-e2e.ts` | `PASS: ...`, exit 0 |
| Incremental persist E2E (neighbor) | `bun scripts/mailbox-incremental-persist-e2e.ts` | exit 0 |
| Related tests | `bun run test:related -- src/backend/mailbox-store.ts` | exit 0 |
| Typecheck | `bun run typecheck:node` | exit 0 |
| Lint changed files | `biome check --write --max-diagnostics=none src/backend/mailbox-store.ts scripts/mailbox-queue-scale-e2e.ts` | exit 0 |

Do not run `bun run typecheck`, builds or full suites.

## Scope

**In scope**:
- `src/backend/mailbox-store.ts` (private helpers and the read methods named above)
- `scripts/mailbox-queue-scale-e2e.ts` (new checks and timings)
- `changelog.d/<branch>.md` (create)

**Out of scope**:
- Any public method signature or return shape of `MailboxStore`.
- Callers in `channel-service.ts`, `routine-scheduler.ts`, `agent-service.ts`.
  Do not add a `deliveryStatus` method in this plan.
- A persistent index or cache on `MailboxStore`. It would need invalidation at
  18 assignment sites and at each rollback; that is a separate decision.
- `openbot-database.ts`, the mailbox SQL schema and migrations.
- `forgetIdempotencyKeys` and `mailbox-projection.ts` (a separate finding).

## Git workflow

- Branch: `advisor/008-mailbox-delivery-reads`.
- Commit message: one imperative sentence, for example `Read one mailbox delivery without sorting the whole mailbox`.
  End with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- The pre-commit hook runs checks. Never use `--no-verify`. Do not push or open a PR unless told to.

## Steps

### Step 1: Add checks and timings to the scale E2E

In `scripts/mailbox-queue-scale-e2e.ts`:

1. Add a function `checkDeliveryReads(mailbox, seeded)`:
   - For 5 queued deliveries (indexes `COMPLETED`, `COMPLETED + 1`,
     `COMPLETED + 500`, the last, and one more), assert
     `mailbox.getDelivery(id)?.delivery.position` equals the position that
     `listQueue(AGENT)` gives for the same id.
   - Assert `mailbox.getDelivery(<completed id>)?.delivery.position === null`.
   - Assert `mailbox.nextQueued(AGENT)?.delivery.id === seeded[COMPLETED].deliveryId`.
   - Start 3 queued deliveries with `markStarting` and `markRunning` (read the
     method names in `mailbox-store.ts`; use the same `runCauseEffect` call
     shape as `seed`) with one `turnId` (`markRunning` takes it; if the
     signature differs, STOP). Assert `findDeliveriesByTurn(AGENT, turnId)`
     returns those 3 ids, and `unresolvedDeliveries()` contains them. Then assert
     that `listQueue` positions of the remaining queued deliveries still start at 1.
   - Push one line to `report.checks` for each group.
   Run it before the timing.
2. Extend `timeQueueChanges` (or add `timeDeliveryReads`) to time, for 200 rounds:
   `getDelivery` of a queued id, `nextQueued(AGENT)`, and
   `findDeliveriesByTurn(AGENT, turnId)`. Add the per-call milliseconds to the
   report as `timing.getDeliveryMs`, `timing.nextQueuedMs`,
   `timing.findDeliveriesByTurnMs`.
3. Update the header comment to name the new reads.

**Verify**: `bun scripts/mailbox-queue-scale-e2e.ts` → `PASS`, exit 0. Copy the
report to `/tmp/mailbox-scale-before.json` (outside the repository) as the baseline.
If a correctness check fails before Step 2, STOP: that is a real bug to report.

### Step 2: Compute one position without a sort

In `mailbox-store.ts`:

1. Add a private method beside `#queuedPositions`:
   ```ts
   /** The queue position of one queued delivery, without sorting the whole mailbox. */
   #queuedPosition(delivery: StoredDelivery): number {
     let position = 1;
     for (const candidate of this.#state.deliveries)
       if (
         candidate.status === "queued" &&
         candidate.recipientAgentId === delivery.recipientAgentId &&
         compareQueueOrder(candidate, delivery) < 0
       )
         position += 1;
     return position;
   }
   ```
2. Change `#publicDelivery` so `positions` is optional with no default
   (`positions?: ReadonlyMap<string, number>`), and compute:
   `position: delivery.status === "queued" ? (positions ? (positions.get(delivery.id) ?? null) : this.#queuedPosition(delivery)) : null,`
3. Change `#context(delivery, positions?, messages?)`: get the message with
   `this.#requireMessage(delivery.messageId, messages)` and pass `positions` and
   the message to `#publicDelivery`.

**Verify**: `bun run typecheck:node` → exit 0. `bun scripts/mailbox-queue-scale-e2e.ts` → `PASS`.

### Step 3: Index once in the list reads

1. Change `#taskIdOf(delivery, messages?: ReadonlyMap<string, StoredMessage>)`
   to use `messages.get(delivery.messageId)` when the map is given.
2. In `nextQueued`, build `const messages = this.#messagesById();` after the
   `laneActive` check, pass it to `#taskIdOf`, and call
   `this.#context(delivery, undefined, messages)`.
3. In `findDeliveriesByTurn`, `startingDeliveriesForAgent`,
   `unresolvedDeliveries`, `repliesToStartWith` and
   `unresolvedMessagingDeliveries`: filter first; when the result is not empty,
   build `positions = this.#queuedPositions()` and `messages = this.#messagesById()`
   once and pass both to `#context`. Keep the filter and sort order unchanged.
   In `repliesToStartWith`, also pass `messages` to the `#requireMessage` and
   `#taskIdOf` calls inside the filter.

**Verify**:
- `bun run typecheck:node` → exit 0.
- `bun scripts/mailbox-queue-scale-e2e.ts` → `PASS`. Compare with
  `/tmp/mailbox-scale-before.json`: `getDeliveryMs` and `findDeliveriesByTurnMs`
  must be lower. Record both reports' numbers for the PR body.
- `bun scripts/mailbox-incremental-persist-e2e.ts` → exit 0.
- `bun run test:related -- src/backend/mailbox-store.ts` → exit 0.

### Step 4: Lint and release note

`biome check --write --max-diagnostics=none src/backend/mailbox-store.ts scripts/mailbox-queue-scale-e2e.ts` → exit 0.
Create `changelog.d/<branch>.md` with one `### Changed` item, for example:
"Agents with a long message history start queued work faster."

## Test plan

- `scripts/mailbox-queue-scale-e2e.ts` runs the real store and SQLite on a
  temporary profile. New checks prove that one-delivery reads give the same
  position as the queue list, that completed deliveries have no position, and
  that the turn and unresolved reads return the right rows. New timings show
  the change.
- No Vitest file: this is not a protected area.

## Done criteria

- [ ] `bun scripts/mailbox-queue-scale-e2e.ts` exits 0, and the report has the three new timings
- [ ] The new `getDeliveryMs` is lower than in the Step 1 baseline
- [ ] `bun run typecheck:node` exits 0
- [ ] `grep -n "positions = this.#queuedPositions()" src/backend/mailbox-store.ts` shows no default argument in `#publicDelivery`
- [ ] `git status` shows only the in-scope files
- [ ] `plans/README.md` state for 008 is updated

## STOP conditions

- The excerpts do not match the code (for example, a cache was added).
- A Step 1 correctness check fails before the change.
- `compareQueueOrder` is no longer a total order (ties possible): then
  `#queuedPosition` can differ from `#queuedPositions`.
- A public return value changes in the E2E or a related test.

## Maintenance notes

- A new read that maps many deliveries must build `positions` and `messages`
  once, as `listQueue` does. Reviewers: look for `#context(` inside a `.map`
  with no maps passed.
- A later plan can add a persistent id index; this plan keeps the arrays as the
  only state so rollbacks (`this.#state = previous`) stay correct.
