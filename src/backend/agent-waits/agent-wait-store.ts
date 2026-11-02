/**
 * The open waits of every agent. Rows are written directly, not through `database.dispatch`: a wait
 * holds a copy of the user's request, and the event log is never deleted from. A closed or cancelled
 * wait is deleted. It owns no events: the runtime says when something changed.
 */

import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { AgentWait } from "@openbot/contracts/ipc";
import type { DynamicRecord } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import {
  databaseRow,
  databaseRows,
  optionalStringColumn,
  requiredNumberColumn,
  requiredStringColumn,
} from "../database/database-rows";
import type { OpenBotDatabase } from "../openbot-database";

/** A refusal the agent reads: the text is already a sentence for it. */
export class AgentWaitError extends Error {}

/** The agent already has the most open waits it may have. */
export class AgentWaitLimitError extends AgentWaitError {}

export interface AgentWaitStoreOptions {
  database: OpenBotDatabase;
  createId?: () => string;
  now?: () => Date;
}

export interface OpenAgentWaitInput {
  agentId: string;
  requestMessageId: string;
  requestText: string;
  note: string;
  routineId: string | null;
}

export class AgentWaitStore {
  readonly #database: OpenBotDatabase;
  readonly #createId: () => string;
  readonly #now: () => Date;

  constructor(options: AgentWaitStoreOptions) {
    this.#database = options.database;
    this.#createId = options.createId ?? (() => crypto.randomUUID());
    this.#now = options.now ?? (() => new Date());
  }

  list(agentId: string): AgentWait[] {
    return databaseRows(
      this.#database.connection
        .prepare("SELECT * FROM agent_waits WHERE agent_id = ? ORDER BY created_at, wait_id")
        .all(agentId),
    ).map(toWait);
  }

  get(agentId: string, waitId: string): AgentWait | null {
    const row = databaseRow(
      this.#database.connection
        .prepare("SELECT * FROM agent_waits WHERE agent_id = ? AND wait_id = ?")
        .get(agentId, waitId),
    );
    return row ? toWait(row) : null;
  }

  /** One statement, so two tool calls at once cannot both pass the limit. */
  open(input: OpenAgentWaitInput): AgentWait {
    const waitId = this.#createId();
    const inserted = this.#database.connection
      .prepare(
        `INSERT INTO agent_waits (wait_id, agent_id, request_delivery_id, request_text, note, routine_id, created_at)
         SELECT ?, ?, ?, ?, ?, ?, ?
         WHERE (SELECT COUNT(*) FROM agent_waits WHERE agent_id = ?) < ?`,
      )
      .run(
        waitId,
        input.agentId,
        input.requestMessageId,
        input.requestText,
        input.note,
        input.routineId,
        this.#now().toISOString(),
        input.agentId,
        INPUT_LIMITS.agentWaits,
      );
    if (inserted.changes === 0)
      throw new AgentWaitLimitError(sourceText("error.backend.agentWaitLimit", { count: INPUT_LIMITS.agentWaits }));
    const wait = this.get(input.agentId, waitId);
    if (!wait) throw new Error("The new wait is missing.");
    return wait;
  }

  count(agentId: string): number {
    const row = databaseRow(
      this.#database.connection.prepare("SELECT COUNT(*) AS waits FROM agent_waits WHERE agent_id = ?").get(agentId),
    );
    return row ? requiredNumberColumn(row, "waits") : 0;
  }

  /** The number of open waits of each agent that has one. */
  countByAgent(): Map<string, number> {
    const rows = databaseRows(
      this.#database.connection.prepare("SELECT agent_id, COUNT(*) AS waits FROM agent_waits GROUP BY agent_id").all(),
    );
    return new Map(rows.map((row) => [requiredStringColumn(row, "agent_id"), requiredNumberColumn(row, "waits")]));
  }

  /** Closes or cancels a wait. False when it was not open. */
  delete(agentId: string, waitId: string): boolean {
    return (
      this.#database.connection
        .prepare("DELETE FROM agent_waits WHERE agent_id = ? AND wait_id = ?")
        .run(agentId, waitId).changes > 0
    );
  }

  /** The waits a run of this routine wakes, when no event names one wait. */
  forRoutineRun(agentId: string, routineId: string): AgentWait[] {
    return databaseRows(
      this.#database.connection
        .prepare(
          `SELECT * FROM agent_waits WHERE agent_id = ? AND (routine_id IS NULL OR routine_id = ?)
           ORDER BY created_at, wait_id`,
        )
        .all(agentId, routineId),
    ).map(toWait);
  }

  markWoken(agentId: string, waitIds: readonly string[], deliveryId: string): void {
    if (waitIds.length === 0) return;
    this.#database.connection
      .prepare(
        `UPDATE agent_waits SET woken_at = ?, wake_delivery_id = ?
         WHERE agent_id = ? AND wait_id IN (${waitIds.map(() => "?").join(", ")})`,
      )
      .run(this.#now().toISOString(), deliveryId, agentId, ...waitIds);
  }

  /** The open waits that this delivery woke. A wait cancelled since then is not in the list. */
  wokenBy(deliveryId: string): AgentWait[] {
    return databaseRows(
      this.#database.connection
        .prepare("SELECT * FROM agent_waits WHERE wake_delivery_id = ? ORDER BY created_at, wait_id")
        .all(deliveryId),
    ).map(toWait);
  }
}

function toWait(row: DynamicRecord): AgentWait {
  return {
    id: requiredStringColumn(row, "wait_id"),
    agentId: requiredStringColumn(row, "agent_id"),
    note: requiredStringColumn(row, "note"),
    requestMessageId: requiredStringColumn(row, "request_delivery_id"),
    requestText: requiredStringColumn(row, "request_text"),
    routineId: optionalStringColumn(row, "routine_id"),
    createdAt: requiredStringColumn(row, "created_at"),
    wokenAt: optionalStringColumn(row, "woken_at"),
    wakeDeliveryId: optionalStringColumn(row, "wake_delivery_id"),
  };
}
