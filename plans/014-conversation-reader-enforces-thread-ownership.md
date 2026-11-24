# Plan 014: Enforce agent ownership in conversation reads

> **Executor instructions**: Follow this plan step by step. If a STOP condition occurs, stop and report.
>
> **Drift check**: `git diff --stat 20d1cd63d9..HEAD -- src/backend/database/conversation-queries.ts src/backend/agent/conversation-reader.ts`.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `20d1cd63d9`, 2026-11-23

## Why this matters

Conversation query methods accept both `agentId` and `threadId`, but the message queries select by `threadId` alone. The metadata query checks the pair later, so a mismatched pair can still return another agent's message rows. Enforcing ownership in the same SQL read prevents cross-agent data disclosure and keeps the database boundary safe for future callers.

## Current state

- `src/backend/database/conversation-queries.ts:66-95` implements `readConversation` and `readTurnConversation`. Their message SQL filters only `thread_id` or `thread_id` plus `turn_id`.
- `src/backend/database/conversation-queries.ts:111-118` checks `projection_threads WHERE thread_id = ? AND agent_id = ?` only while building snapshot metadata.
- `src/backend/database/conversation-queries.ts:301-350` reads a paged conversation and reply references after the owner lookup. `#conversationPageRows` and the reference query use `thread_id` without the agent predicate.
- `src/backend/database/conversation-queries.ts:280-296` already shows the safe pattern, adding `thread_id IN (SELECT thread_id FROM projection_threads WHERE agent_id = ?)`.
- `src/backend/agent/conversation-reader.ts:34-69` is a current caller that derives the pair from an agent, but the query class is a reusable boundary and must enforce its own invariant.

## Commands you will need

| Purpose | Command | Expected result |
|---|---|---|
| Node types | `bun run typecheck:node` | exit 0 |
| Focused tests | `bun run test:related -- src/backend/database/conversation-queries.ts` | all related tests pass |
| Changed-file lint | `bunx biome check --max-diagnostics=none src/backend/database/conversation-queries.ts <new-test-file>` | exit 0 |

## Scope

**In scope**

- `src/backend/database/conversation-queries.ts`
- The existing focused E2E or protected database test file that exercises conversation reads
- A new E2E script under `scripts/` only if no existing test can drive the real database boundary

**Out of scope**

- IPC or Team API response shapes
- Database migrations
- Caller-side validation as the only fix
- Changes to unrelated conversation filters

## Steps

### Step 1: Add ownership predicates to all affected reads

Update `readConversation`, `readTurnConversation`, `readConversationPage` base rows, page key/row helpers, and reply-reference reads so every message row is constrained to a thread owned by the supplied `agentId`. Pass `agentId` through private helpers as needed. Preserve ordering, marker filters, page limits, and empty-snapshot behavior.

**Verify**: `bun run typecheck:node` → exit 0.

### Step 2: Add a regression scenario

Create a real database E2E scenario with two agents and one thread per agent. Call each affected read with agent A plus agent B's thread ID and assert that messages and references are empty. Call the matching pairs and assert that the original messages remain available. Write the report under `.openbot-build/` like other E2E scripts.

**Verify**: `bun run test:related -- src/backend/database/conversation-queries.ts` → all tests pass and the mismatch case is covered.

### Step 3: Lint the changed files

**Verify**: `bunx biome check --max-diagnostics=none src/backend/database/conversation-queries.ts <new-test-file>` → exit 0.

## Test plan

Cover matching pair reads, mismatched pair reads for full, turn, and paged conversations, reply references, null thread IDs, and the existing marker exclusions. Model the setup and artifact writing on the nearest existing database E2E script.

## Done criteria

- [ ] Every affected message and reference query enforces `agentId` ownership.
- [ ] Mismatched agent/thread reads return no messages or references.
- [ ] Matching reads preserve existing results and ordering.
- [ ] Focused test, Node typecheck, and changed-file lint pass.
- [ ] `git status --short` shows only in-scope files plus the required changelog entry if the repository check requires one.

## STOP conditions

Stop if the existing test harness cannot create two agents and two threads without changing a public contract. Stop if the current page helper API differs from the excerpts and the change would require an out-of-scope protocol change.

## Maintenance notes

Keep the ownership predicate in the database query layer. Any new conversation reader that accepts an agent and thread pair must use the same invariant. Review future pagination and reference queries for the same thread-only access pattern.
