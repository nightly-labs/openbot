import { randomUUID } from "node:crypto";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type {
  CreateWatcherInput,
  UpdateWatcherInput,
  Watcher,
  WatcherCondition,
  WatcherHealth,
  WatcherMatch,
  WatcherMode,
  WatcherSelector,
  WatcherSource,
} from "@openbot/contracts/ipc";
import {
  isWatcherCondition,
  isWatcherSelector,
  isWatcherSource,
  WATCHER_MAXIMUM_INTERVAL_MINUTES,
  WATCHER_MINIMUM_INTERVAL_MINUTES,
} from "@openbot/contracts/ipc";
import { type DynamicRecord, isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import type { OpenBotDatabase } from "./openbot-database";

export interface DueWatcher {
  watcher: Watcher;
}

function rows(value: unknown): DynamicRecord[] {
  if (!Array.isArray(value)) throw new Error("The watcher projection could not be read.");
  return value.map((row) => {
    if (!isDynamicRecord(row)) throw new Error("The watcher projection could not be read.");
    return row;
  });
}

function stringColumn(row: DynamicRecord, name: string): string {
  const value = row[name];
  if (!isString(value)) throw new Error("The watcher projection could not be read.");
  return value;
}

function nullableStringColumn(row: DynamicRecord, name: string): string | null {
  const value = row[name];
  if (value === null) return null;
  if (!isString(value)) throw new Error("The watcher projection could not be read.");
  return value;
}

function numberColumn(row: DynamicRecord, name: string): number {
  const value = row[name];
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error("The watcher projection could not be read.");
  }
  return value;
}

function parseSource(value: string): WatcherSource {
  const parsed = JSON.parse(value);
  if (!isWatcherSource(parsed)) throw new Error("The watcher source could not be read.");
  return parsed;
}

function parseSelector(value: string | null): WatcherSelector | null {
  if (value === null) return null;
  const parsed = JSON.parse(value);
  if (!isDynamicRecord(parsed) || !isWatcherSelector(parsed)) {
    throw new Error("The watcher selector could not be read.");
  }
  return parsed;
}

function parseCondition(value: string): WatcherCondition {
  const parsed = JSON.parse(value);
  if (!isWatcherCondition(parsed)) throw new Error("The watcher condition could not be read.");
  return parsed ?? {};
}

/**
 * Owns agent watcher rows, their check state, and their matches. It never imports the routine
 * scheduler or the mailbox. Firing a routine stays in the scheduler that calls back into the
 * agent service, so this store only records facts.
 */
export class AgentWatcherStore {
  constructor(private readonly database: OpenBotDatabase) {}

  list(agentId: string): Watcher[] {
    return rows(
      this.database.connection
        .prepare(
          `SELECT watcher_id, agent_id, routine_id, name, active, interval_minutes, source_json,
                  selector_json, condition_json, health, last_checked_at, next_check_at,
                  last_state_hash, last_kept_text, last_mode, error_count, created_at, updated_at
           FROM projection_agent_watchers WHERE agent_id = ?
           ORDER BY updated_at DESC, watcher_id`,
        )
        .all(agentId),
    ).map((row) => toWatcher(row));
  }

  get(agentId: string, watcherId: string): Watcher | null {
    const row = this.database.connection
      .prepare(
        `SELECT watcher_id, agent_id, routine_id, name, active, interval_minutes, source_json,
                selector_json, condition_json, health, last_checked_at, next_check_at,
                last_state_hash, last_kept_text, last_mode, error_count, created_at, updated_at
         FROM projection_agent_watchers WHERE watcher_id = ? AND agent_id = ?`,
      )
      .get(watcherId, agentId);
    return isDynamicRecord(row) ? toWatcher(row) : null;
  }

  create(input: CreateWatcherInput, now = new Date()): Watcher {
    validateWatcherInput(input.name, input.intervalMinutes, input.source, input.selector, input.condition);
    if (this.list(input.agentId).length >= INPUT_LIMITS.watchersPerAgent) {
      throw new Error(`An agent can have at most ${INPUT_LIMITS.watchersPerAgent} watchers.`);
    }
    requireRoutine(this.database, input.agentId, input.routineId);
    const watcherId = randomUUID();
    const createdAt = now.toISOString();
    const nextCheckAt = new Date(now.getTime() + input.intervalMinutes * 60_000).toISOString();
    const sourceJson = JSON.stringify(input.source);
    const selectorJson = input.selector ? JSON.stringify(input.selector) : null;
    const conditionJson = JSON.stringify(input.condition ?? {});
    return this.database.dispatch(
      `watcher:create:${watcherId}`,
      [{ aggregateType: "agent-watcher", aggregateId: watcherId, eventType: "watcher.created", payload: { ...input } }],
      (db, sequences) => {
        const sequence = sequences[0] ?? 0;
        db.prepare(
          `INSERT INTO projection_agent_watchers (
             watcher_id, agent_id, routine_id, name, active, interval_minutes, source_json,
             selector_json, condition_json, health, last_checked_at, next_check_at,
             last_state_hash, last_kept_text, last_mode, error_count, created_at, updated_at, last_event_sequence
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ok', NULL, ?, NULL, NULL, NULL, 0, ?, ?, ?)`,
        ).run(
          watcherId,
          input.agentId,
          input.routineId,
          input.name.trim(),
          input.active ? 1 : 0,
          input.intervalMinutes,
          sourceJson,
          selectorJson,
          conditionJson,
          nextCheckAt,
          createdAt,
          createdAt,
          sequence,
        );
        const row = db
          .prepare(`SELECT watcher_id, agent_id, routine_id, name, active, interval_minutes, source_json,
                           selector_json, condition_json, health, last_checked_at, next_check_at,
                           last_state_hash, last_kept_text, last_mode, error_count, created_at, updated_at
                    FROM projection_agent_watchers WHERE watcher_id = ?`)
          .get(watcherId);
        if (!isDynamicRecord(row)) throw new Error("The watcher could not be read after creation.");
        return toWatcher(row);
      },
    );
  }

  update(input: UpdateWatcherInput, now = new Date()): Watcher {
    const current = this.get(input.agentId, input.watcherId);
    if (!current) throw new Error("This watcher no longer exists.");
    const name = input.name ?? current.name;
    const intervalMinutes = input.intervalMinutes ?? current.intervalMinutes;
    const source = input.source ?? current.source;
    const selector = input.selector === undefined ? current.selector : input.selector;
    const condition = input.condition ?? current.condition;
    validateWatcherInput(name, intervalMinutes, source, selector, condition);
    const active = input.active ?? current.active;
    const updatedAt = now.toISOString();
    const nextCheckAt =
      input.intervalMinutes !== undefined || (active && !current.active)
        ? new Date(now.getTime() + intervalMinutes * 60_000).toISOString()
        : current.nextCheckAt;
    return this.database.dispatch(
      `watcher:update:${input.watcherId}:${randomUUID()}`,
      [
        {
          aggregateType: "agent-watcher",
          aggregateId: input.watcherId,
          eventType: "watcher.updated",
          payload: { ...input },
        },
      ],
      (db, sequences) => {
        const sequence = sequences[0] ?? 0;
        db.prepare(
          `UPDATE projection_agent_watchers
           SET name = ?, active = ?, interval_minutes = ?, source_json = ?, selector_json = ?,
               condition_json = ?, next_check_at = ?, updated_at = ?, last_event_sequence = ?
           WHERE watcher_id = ? AND agent_id = ?`,
        ).run(
          name.trim(),
          active ? 1 : 0,
          intervalMinutes,
          JSON.stringify(source),
          selector ? JSON.stringify(selector) : null,
          JSON.stringify(condition),
          nextCheckAt,
          updatedAt,
          sequence,
          input.watcherId,
          input.agentId,
        );
        const row = db
          .prepare(`SELECT watcher_id, agent_id, routine_id, name, active, interval_minutes, source_json,
                           selector_json, condition_json, health, last_checked_at, next_check_at,
                           last_state_hash, last_kept_text, last_mode, error_count, created_at, updated_at
                    FROM projection_agent_watchers WHERE watcher_id = ? AND agent_id = ?`)
          .get(input.watcherId, input.agentId);
        if (!isDynamicRecord(row)) throw new Error("The watcher could not be read after update.");
        return toWatcher(row);
      },
    );
  }

  delete(agentId: string, watcherId: string): void {
    if (!this.get(agentId, watcherId)) throw new Error("This watcher no longer exists.");
    this.database.dispatch(
      `watcher:delete:${watcherId}:${randomUUID()}`,
      [{ aggregateType: "agent-watcher", aggregateId: watcherId, eventType: "watcher.deleted", payload: { agentId } }],
      (db) => {
        db.prepare(`DELETE FROM projection_agent_watchers WHERE watcher_id = ? AND agent_id = ?`).run(
          watcherId,
          agentId,
        );
        return null;
      },
    );
  }

  due(now = new Date(), excludedAgentIds: ReadonlySet<string> = new Set()): Watcher[] {
    return rows(
      this.database.connection
        .prepare(
          `SELECT watcher_id, agent_id, routine_id, name, active, interval_minutes, source_json,
                  selector_json, condition_json, health, last_checked_at, next_check_at,
                  last_state_hash, last_kept_text, last_mode, error_count, created_at, updated_at
           FROM projection_agent_watchers
           WHERE active = 1 AND next_check_at <= ?
           ORDER BY next_check_at, watcher_id`,
        )
        .all(now.toISOString()),
    )
      .map((row) => toWatcher(row))
      .filter((watcher) => !excludedAgentIds.has(watcher.agentId));
  }

  nextDueAt(excludedAgentIds: ReadonlySet<string> = new Set()): string | null {
    const row = this.database.connection
      .prepare(
        `SELECT next_check_at, agent_id FROM projection_agent_watchers WHERE active = 1
         ORDER BY next_check_at LIMIT 50`,
      )
      .all();
    if (!Array.isArray(row)) return null;
    let earliest: string | null = null;
    for (const entry of row) {
      if (!isDynamicRecord(entry) || !isString(entry.next_check_at) || !isString(entry.agent_id)) continue;
      if (excludedAgentIds.has(entry.agent_id)) continue;
      if (!earliest || entry.next_check_at < earliest) earliest = entry.next_check_at;
    }
    return earliest;
  }

  recordCheck(
    watcher: Watcher,
    outcome: {
      stateHash: string | null;
      keptText?: string | null;
      mode?: WatcherMode | null;
      error?: string | null;
      weak?: boolean;
    },
    now = new Date(),
  ): Watcher {
    const checkedAt = now.toISOString();
    const failures = outcome.error ? watcher.errorCount + 1 : 0;
    const health: WatcherHealth = outcome.error
      ? failures >= 5
        ? "quarantined"
        : "weak"
      : outcome.weak
        ? "weak"
        : "ok";
    const backoff = health === "quarantined" ? 4 : 1;
    const nextCheckAt = new Date(now.getTime() + watcher.intervalMinutes * 60_000 * backoff).toISOString();
    this.database.dispatch(
      `watcher:check:${watcher.id}:${randomUUID()}`,
      [
        {
          aggregateType: "agent-watcher",
          aggregateId: watcher.id,
          eventType: "watcher.checked",
          payload: { watcherId: watcher.id },
        },
      ],
      (db, sequences) => {
        const sequence = sequences[0] ?? 0;
        db.prepare(
          `UPDATE projection_agent_watchers
           SET health = ?, last_checked_at = ?, next_check_at = ?,
               last_state_hash = ?, last_kept_text = ?, last_mode = ?,
               error_count = ?, updated_at = ?, last_event_sequence = ?
           WHERE watcher_id = ? AND agent_id = ?`,
        ).run(
          health,
          checkedAt,
          nextCheckAt,
          outcome.error ? watcher.lastStateHash : (outcome.stateHash ?? watcher.lastStateHash),
          outcome.error ? watcher.lastKeptText : (outcome.keptText ?? watcher.lastKeptText),
          outcome.mode ?? watcher.lastMode,
          failures,
          checkedAt,
          sequence,
          watcher.id,
          watcher.agentId,
        );
        return null;
      },
    );
    const current = this.get(watcher.agentId, watcher.id);
    if (!current) throw new Error("This watcher no longer exists.");
    return current;
  }

  recordMatch(
    watcher: Watcher,
    sourceId: string,
    summary: string,
    diff: string,
    now = new Date(),
  ): WatcherMatch | null {
    const matchId = randomUUID();
    const createdAt = now.toISOString();
    return this.database.dispatch(
      `watcher:match:${watcher.id}:${matchId}`,
      [
        {
          aggregateType: "watcher-match",
          aggregateId: matchId,
          eventType: "watcher.matched",
          payload: { watcherId: watcher.id },
        },
      ],
      (db, sequences) => {
        const sequence = sequences[0] ?? 0;
        const inserted = db
          .prepare(
            `INSERT INTO projection_agent_watcher_matches (
               match_id, watcher_id, agent_id, source_id, summary, diff, consumed_run_id,
               created_at, last_event_sequence
             ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)
             ON CONFLICT(watcher_id, source_id) DO NOTHING`,
          )
          .run(
            matchId,
            watcher.id,
            watcher.agentId,
            sourceId,
            summary.slice(0, 2000),
            diff.slice(0, 100_000),
            createdAt,
            sequence,
          );
        if (inserted.changes === 0) return null;
        const row = db
          .prepare(`SELECT match_id, watcher_id, agent_id, source_id, summary, diff, consumed_run_id, created_at
                    FROM projection_agent_watcher_matches WHERE match_id = ?`)
          .get(matchId);
        if (!isDynamicRecord(row)) throw new Error("The watcher match could not be read after creation.");
        return toMatch(row);
      },
    );
  }

  listMatches(agentId: string, watcherId: string, limit = 50): WatcherMatch[] {
    const safeLimit = Math.max(1, Math.min(INPUT_LIMITS.watcherMatchesPage, limit));
    const watcher = this.get(agentId, watcherId);
    if (!watcher) throw new Error("This watcher no longer exists.");
    return rows(
      this.database.connection
        .prepare(
          `SELECT match_id, watcher_id, agent_id, source_id, summary, diff, consumed_run_id, created_at
           FROM projection_agent_watcher_matches WHERE watcher_id = ? AND agent_id = ?
           ORDER BY created_at DESC, match_id DESC LIMIT ?`,
        )
        .all(watcherId, agentId, safeLimit),
    ).map((row) => toMatch(row));
  }

  pendingMatches(watcherId: string, limit = 10): WatcherMatch[] {
    return rows(
      this.database.connection
        .prepare(
          `SELECT match_id, watcher_id, agent_id, source_id, summary, diff, consumed_run_id, created_at
           FROM projection_agent_watcher_matches WHERE watcher_id = ? AND consumed_run_id IS NULL
           ORDER BY created_at, match_id LIMIT ?`,
        )
        .all(watcherId, limit),
    ).map((row) => toMatch(row));
  }

  markMatchConsumed(matchId: string, runId: string): void {
    this.database.connection
      .prepare(`UPDATE projection_agent_watcher_matches SET consumed_run_id = ? WHERE match_id = ?`)
      .run(runId, matchId);
  }

  duplicate(sourceAgentId: string, targetAgentId: string, routineIdMap: Map<string, string>, now = new Date()): void {
    for (const watcher of this.list(sourceAgentId)) {
      const routineId = routineIdMap.get(watcher.routineId);
      if (!routineId) continue;
      this.create(
        {
          agentId: targetAgentId,
          routineId,
          name: watcher.name,
          active: watcher.active,
          intervalMinutes: watcher.intervalMinutes,
          source: watcher.source,
          selector: watcher.selector,
          condition: watcher.condition,
        },
        now,
      );
    }
  }
}

function validateWatcherInput(
  name: string,
  intervalMinutes: number,
  source: WatcherSource,
  selector: WatcherSelector | null | undefined,
  condition: WatcherCondition | undefined,
): void {
  if (!isString(name) || name.trim().length === 0 || name.length > INPUT_LIMITS.watcherName) {
    throw new Error("A watcher name is required.");
  }
  if (
    !Number.isInteger(intervalMinutes) ||
    intervalMinutes < WATCHER_MINIMUM_INTERVAL_MINUTES ||
    intervalMinutes > WATCHER_MAXIMUM_INTERVAL_MINUTES
  ) {
    throw new Error(
      `Watcher interval must be between ${WATCHER_MINIMUM_INTERVAL_MINUTES} and ${WATCHER_MAXIMUM_INTERVAL_MINUTES} minutes.`,
    );
  }
  if (!isWatcherSource(source)) throw new Error("Invalid watcher source.");
  if (selector !== undefined && selector !== null && !isWatcherSelector(selector)) {
    throw new Error("Invalid watcher selector.");
  }
  if (!isWatcherCondition(condition)) throw new Error("Invalid watcher condition.");
}

function requireRoutine(database: OpenBotDatabase, agentId: string, routineId: string): void {
  const row = database.connection
    .prepare(`SELECT routine_id FROM projection_agent_routines WHERE routine_id = ? AND agent_id = ?`)
    .get(routineId, agentId);
  if (!row) throw new Error("The linked routine no longer exists.");
}

function toWatcher(row: DynamicRecord): Watcher {
  const active = row.active;
  const health = row.health;
  if (active !== 0 && active !== 1) throw new Error("The watcher projection could not be read.");
  if (health !== "ok" && health !== "weak" && health !== "quarantined") {
    throw new Error("The watcher projection could not be read.");
  }
  const lastMode = nullableStringColumn(row, "last_mode");
  if (lastMode !== null && lastMode !== "fetch" && lastMode !== "browser" && lastMode !== "gmail") {
    throw new Error("The watcher projection could not be read.");
  }
  return {
    id: stringColumn(row, "watcher_id"),
    agentId: stringColumn(row, "agent_id"),
    routineId: stringColumn(row, "routine_id"),
    name: stringColumn(row, "name"),
    active: active === 1,
    intervalMinutes: numberColumn(row, "interval_minutes"),
    source: parseSource(stringColumn(row, "source_json")),
    selector: parseSelector(nullableStringColumn(row, "selector_json")),
    condition: parseCondition(stringColumn(row, "condition_json")),
    health,
    lastCheckedAt: nullableStringColumn(row, "last_checked_at"),
    nextCheckAt: stringColumn(row, "next_check_at"),
    lastStateHash: nullableStringColumn(row, "last_state_hash"),
    lastKeptText: nullableStringColumn(row, "last_kept_text"),
    lastMode,
    errorCount: typeof row.error_count === "number" ? row.error_count : 0,
    createdAt: stringColumn(row, "created_at"),
    updatedAt: stringColumn(row, "updated_at"),
  };
}

function toMatch(row: DynamicRecord): WatcherMatch {
  return {
    id: stringColumn(row, "match_id"),
    watcherId: stringColumn(row, "watcher_id"),
    agentId: stringColumn(row, "agent_id"),
    sourceId: stringColumn(row, "source_id"),
    summary: stringColumn(row, "summary"),
    diff: stringColumn(row, "diff"),
    createdAt: stringColumn(row, "created_at"),
    consumedRunId: nullableStringColumn(row, "consumed_run_id"),
  };
}
