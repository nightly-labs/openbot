# Plan 016: Batch channel summary queries

> **Executor instructions**: Follow this plan step by step. If a STOP condition occurs, stop and report.
>
> **Drift check**: `git diff --stat 20d1cd63d9..HEAD -- src/backend/channel-store.ts src/backend/openbot-database-schema-history.json scripts`.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `20d1cd63d9`, 2026-11-23

## Why this matters

`ChannelStore.list` runs several correlated database scans for every channel, then can run another unread-count query for every channel. Large workspaces pay this cost on sidebar refreshes, which can delay channel updates on the single SQLite connection. Batching the aggregates should reduce work while preserving the current summary semantics.

## Current state

- `src/backend/channel-store.ts:289-309` selects each channel and runs correlated subqueries for the latest shown message, running tasks, and open tasks.
- `src/backend/channel-store.ts:327-355` maps rows and calls `#unreadCount` once per channel.
- `src/backend/channel-store.ts:234-255` runs `UNREAD_COUNT_SQL` when the cache is cold.
- `src/backend/openbot-database-schema-history.json:64-73` records channel-message, channel-task, and channel-assignment indexes, while task state remains inside JSON.

## Commands you will need

| Purpose | Command | Expected result |
|---|---|---|
| Baseline benchmark | `bun run dev:bench:hotspots` or the narrow channel benchmark used by the repository | records current channel-list timing |
| Focused tests | `bun run test:related -- src/backend/channel-store.ts` | all related tests pass |
| Node types | `bun run typecheck:node` | exit 0 |
| Changed-file lint | `bunx biome check --max-diagnostics=none src/backend/channel-store.ts <new-test-file>` | exit 0 |

## Scope

**In scope**

- `src/backend/channel-store.ts`
- A focused E2E benchmark or regression script under `scripts/`
- Schema or migration files only if `EXPLAIN QUERY PLAN` proves an index is needed and the migration is safe under `src/backend/AGENTS.md`

**Out of scope**

- Channel summary response shapes
- JSON task-state format
- Unrelated mailbox or conversation queries
- A schema migration without measured evidence

## Steps

### Step 1: Characterize current results and cost

Build a realistic fixture with many channels, messages, tasks, members, and read markers. Record `ChannelStore.list` output and timing. Use `EXPLAIN QUERY PLAN` for the current latest-message, task, and unread queries.

**Verify**: the benchmark writes a repeatable JSON artifact under `.openbot-build/` containing row counts, elapsed time, and query-plan text.

### Step 2: Replace per-channel aggregates with batched queries

Use grouped queries keyed by `channel_id` for latest shown messages and task counts. Add one unread-count query for all channel/member pairs, or maintain an existing projection only if it preserves invalidation and transaction behavior. Keep row ordering, message visibility filters, signed-out behavior, and task states exactly unchanged.

**Verify**: `bun run test:related -- src/backend/channel-store.ts` → all tests pass.

### Step 3: Measure and assess indexes

Re-run the benchmark and query plans. Add a migration only when the measured plan shows a missing index and the migration meets the frozen-schema rules. Add data-preservation coverage for any migration.

**Verify**: `bun run typecheck:node` → exit 0, then `bunx biome check --max-diagnostics=none src/backend/channel-store.ts <new-test-file>` → exit 0.

## Test plan

Cover empty channels, channels with no visible messages, task states queued/waiting/running/complete, signed-out message ownership, unread cache hits and misses, and stable channel ordering. Assert summary data, not SQL shape. Compare benchmark output before and after for the same fixture.

## Done criteria

- [ ] Channel summary output matches the pre-change fixture.
- [ ] The common list path performs batched aggregate work instead of one unread query per channel.
- [ ] Benchmark output shows an improvement at the target fixture size, or the plan records that the measured change was not worth keeping.
- [ ] Focused tests, Node typecheck, and lint pass.
- [ ] Any schema change has migration tests and history parity updates.

## STOP conditions

Stop if batching changes message visibility, ordering, unread semantics, or transaction behavior. Stop if the only apparent improvement requires rewriting a large table or adding a migration without a measured query-plan need.

## Maintenance notes

Keep the benchmark fixture representative of real channel lists. Revisit the grouped queries if channel task JSON changes or if pagination is added to the sidebar.
