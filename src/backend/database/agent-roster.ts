import type { DatabaseSync } from "node:sqlite";
import type { AgentSummary } from "@openbot/contracts/ipc";
import { revokeRoutineWebhooks } from "../webhook-route-store";
import { type DatabaseCore, deleteReceiptsOf } from "./database-core";
import { databaseRow, databaseRows, requiredNumberColumn, requiredStringColumn } from "./database-rows";
import { cachedStatement } from "./statement-cache";

type AgentRuntime = Pick<AgentSummary, "provider" | "model" | "reasoningEffort">;

export interface AgentModelChange {
  initiatingAgentId: string;
  targetAgentId: string;
  previous: AgentRuntime;
  next: AgentRuntime;
}

export interface AgentRosterOptions {
  core: DatabaseCore;
}

export class AgentRoster {
  readonly #core: DatabaseCore;

  constructor(options: AgentRosterOptions) {
    this.#core = options.core;
  }

  listAgents(): AgentSummary[] {
    return databaseRows(
      this.#core.connection.prepare("SELECT agent_json FROM projection_agents ORDER BY sort_order, agent_id").all(),
    ).map((row) => JSON.parse(requiredStringColumn(row, "agent_json")));
  }

  getAgent(agentId: string): AgentSummary | undefined {
    const row = databaseRow(
      this.#core.connection.prepare("SELECT agent_json FROM projection_agents WHERE agent_id = ?").get(agentId),
    );
    return row ? JSON.parse(requiredStringColumn(row, "agent_json")) : undefined;
  }

  unclaimedThreads(): { threadId: string; agentId: string }[] {
    return databaseRows(
      this.#core.connection
        .prepare(
          `SELECT thread_id, agent_id FROM projection_threads
           WHERE thread_id NOT IN (SELECT thread_id FROM projection_agents WHERE thread_id IS NOT NULL)
             AND thread_id NOT IN (SELECT thread_id FROM projection_channel_contexts)
             AND thread_id NOT IN (SELECT thread_id FROM projection_messaging_threads)
             AND thread_id NOT IN (SELECT thread_id FROM projection_agent_threads)
           ORDER BY thread_id`,
        )
        .all(),
    ).map((row) => ({
      threadId: requiredStringColumn(row, "thread_id"),
      agentId: requiredStringColumn(row, "agent_id"),
    }));
  }

  latestRosterAgents(): unknown[] {
    const row = databaseRow(
      this.#core.connection
        .prepare(
          `SELECT payload_json FROM orchestration_events
           WHERE aggregate_type = 'agents' AND aggregate_id = 'agents'
           ORDER BY sequence DESC LIMIT 1`,
        )
        .get(),
    );
    if (!row) return [];
    const payload = databaseRow(JSON.parse(requiredStringColumn(row, "payload_json")));
    if (!payload || !Array.isArray(payload.agents)) return [];
    return payload.agents;
  }

  replaceAgents(commandId: string, agents: AgentSummary[], eventType: string, modelChange?: AgentModelChange): void {
    this.#core.dispatch(
      commandId,
      [
        {
          aggregateType: "agents",
          aggregateId: "agents",
          eventType,
          payload: modelChange ? { agents, modelChange } : { agents },
        },
      ],
      (db, sequences) => {
        const sequence = sequences[0] ?? 0;
        if (new Set(agents.map((agent) => agent.id)).size === agents.length) {
          writeChangedAgents(db, agents, sequence, (agent, changed) =>
            changed ? this.ensureThreadProjection(db, agent, sequence) : claimThreadProjection(db, agent, sequence),
          );
        } else {
          db.exec("DELETE FROM projection_agents");
          agents.forEach((agent, index) => {
            insertAgentRow(db, agent, index, JSON.stringify(agent), sequence);
            if (agent.threadId) this.ensureThreadProjection(db, agent, sequence);
          });
        }
        pruneRosterEvents(db, sequence);
        return null;
      },
    );
  }

  hardDeleteAgent(commandId: string, agentId: string, threadId: string | null, remainingAgents: AgentSummary[]): void {
    this.#core.dispatch(
      commandId,
      [
        {
          aggregateType: "agents",
          aggregateId: "agents",
          eventType: "agents.rebased-after-delete",
          payload: { agents: remainingAgents },
        },
      ],
      (db, sequences) => {
        const sequence = sequences[0] ?? 0;
        for (const table of [
          "agent_usage_records",
          "agent_usage_checkpoints",
          "agent_usage_activity",
          "agent_usage_skill_loads",
        ])
          db.prepare(`DELETE FROM ${table} WHERE agent_id = ?`).run(agentId);
        db.prepare(
          "DELETE FROM orchestration_command_receipts WHERE command_id IN (SELECT command_id FROM orchestration_events WHERE aggregate_type = 'agent-usage' AND aggregate_id = ?)",
        ).run(agentId);
        db.prepare("DELETE FROM orchestration_events WHERE aggregate_type = 'agent-usage' AND aggregate_id = ?").run(
          agentId,
        );
        const memoryIds = databaseRows(
          db.prepare("SELECT memory_id FROM projection_agent_memories WHERE agent_id = ?").all(agentId),
        ).map((row) => requiredStringColumn(row, "memory_id"));
        const routineIds = databaseRows(
          db.prepare("SELECT routine_id FROM projection_agent_routines WHERE agent_id = ?").all(agentId),
        ).map((row) => requiredStringColumn(row, "routine_id"));
        if (memoryIds.length > 0) {
          const placeholders = memoryIds.map(() => "?").join(", ");
          db.prepare(
            `DELETE FROM orchestration_command_receipts WHERE command_id IN (
               SELECT DISTINCT command_id
               FROM orchestration_events
               WHERE aggregate_type = 'agent-memory' AND aggregate_id IN (${placeholders})
             )`,
          ).run(...memoryIds);
          db.prepare(
            `DELETE FROM orchestration_events
             WHERE aggregate_type = 'agent-memory' AND aggregate_id IN (${placeholders})`,
          ).run(...memoryIds);
        }
        if (routineIds.length > 0) {
          const placeholders = routineIds.map(() => "?").join(", ");
          db.prepare(
            `DELETE FROM orchestration_command_receipts WHERE command_id IN (
               SELECT DISTINCT command_id FROM orchestration_events
               WHERE aggregate_type IN ('agent-routine', 'routine-run') AND aggregate_id IN (${placeholders})
             )`,
          ).run(...routineIds);
          db.prepare(
            `DELETE FROM orchestration_events
             WHERE aggregate_type IN ('agent-routine', 'routine-run') AND aggregate_id IN (${placeholders})`,
          ).run(...routineIds);
        }
        db.prepare(
          `DELETE FROM orchestration_command_receipts WHERE command_id IN (
             SELECT DISTINCT command_id FROM orchestration_events
             WHERE aggregate_type = 'hosted-site-terminal'
               AND event_type = 'hosted-site.terminal-pending'
               AND COALESCE(json_extract(payload_json, '$.agentId'), json_extract(payload_json, '$.botId')) = ?
           )`,
        ).run(agentId);
        db.prepare(
          `DELETE FROM orchestration_events
           WHERE aggregate_type = 'hosted-site-terminal'
             AND event_type = 'hosted-site.terminal-pending'
             AND COALESCE(json_extract(payload_json, '$.agentId'), json_extract(payload_json, '$.botId')) = ?`,
        ).run(agentId);
        const sensitiveFilter = threadId
          ? `(aggregate_id = ? OR aggregate_id = ? OR
              (aggregate_type = 'agents' AND aggregate_id = 'agents' AND sequence < ?))`
          : `(aggregate_id = ? OR
              (aggregate_type = 'agents' AND aggregate_id = 'agents' AND sequence < ?))`;
        const sensitiveParameters = threadId
          ? ([agentId, threadId, sequence] as const)
          : ([agentId, sequence] as const);
        db.prepare(
          `DELETE FROM orchestration_command_receipts WHERE command_id IN (
             SELECT DISTINCT command_id FROM orchestration_events WHERE ${sensitiveFilter}
           )`,
        ).run(...sensitiveParameters);
        db.prepare(`DELETE FROM orchestration_events WHERE ${sensitiveFilter}`).run(...sensitiveParameters);
        db.prepare("DELETE FROM projection_agents WHERE agent_id = ?").run(agentId);
        db.prepare("DELETE FROM projection_agent_memories WHERE agent_id = ?").run(agentId);
        revokeRoutineWebhooks(db, "agent", routineIds, { forget: true });
        db.prepare("DELETE FROM projection_agent_routines WHERE agent_id = ?").run(agentId);
        db.prepare("DELETE FROM routine_flow_links WHERE from_agent_id = ? OR to_agent_id = ?").run(agentId, agentId);
        db.prepare("DELETE FROM routine_flow_positions WHERE canvas_agent_id = ? OR node_key = ?").run(
          agentId,
          `agent:${agentId}`,
        );
        db.prepare("DELETE FROM routine_flow_steps WHERE agent_id = ?").run(agentId);
        db.prepare(
          `UPDATE workflows SET graph_revision = graph_revision + 1
           WHERE workflow_id IN (SELECT workflow_id FROM workflow_nodes WHERE agent_id = ?)`,
        ).run(agentId);
        db.prepare(
          "UPDATE workflow_nodes SET agent_id = NULL, fields_json = json_remove(fields_json, '$.agentId') WHERE agent_id = ?",
        ).run(agentId);
        db.prepare("UPDATE workflow_steps SET agent_id = NULL WHERE agent_id = ?").run(agentId);
        db.prepare("DELETE FROM agent_waits WHERE agent_id = ?").run(agentId);
        db.prepare("DELETE FROM projection_reactions WHERE agent_id = ?").run(agentId);
        db.prepare("DELETE FROM projection_deliveries WHERE recipient_agent_id = ?").run(agentId);
        db.prepare("DELETE FROM projection_queue_state WHERE agent_id = ?").run(agentId);
        if (threadId) {
          db.prepare("DELETE FROM projection_threads WHERE thread_id = ?").run(threadId);
        }
        return null;
      },
    );
  }

  ensureThreadProjection(db: DatabaseSync, agent: AgentSummary, sequence: number): void {
    if (!agent.threadId) return;
    cachedStatement(
      db,
      `
      INSERT INTO projection_threads
        (thread_id, agent_id, title, active_turn_id, created_at, updated_at, last_event_sequence)
      VALUES (?, ?, ?, NULL, ?, ?, ?)
      ON CONFLICT(thread_id) DO UPDATE SET
        agent_id = excluded.agent_id,
        title = excluded.title,
        updated_at = excluded.updated_at,
        last_event_sequence = MAX(projection_threads.last_event_sequence, excluded.last_event_sequence)
    `,
    ).run(
      agent.threadId,
      agent.id,
      agent.name,
      agent.updatedAt ?? new Date().toISOString(),
      agent.updatedAt ?? new Date().toISOString(),
      sequence,
    );
  }
}

const INSERT_AGENT_ROW = `
  INSERT INTO projection_agents
    (agent_id, thread_id, model, updated_at, sort_order, agent_json, last_event_sequence)
  VALUES (?, ?, ?, ?, ?, ?, ?)`;

function insertAgentRow(db: DatabaseSync, agent: AgentSummary, index: number, json: string, sequence: number): void {
  cachedStatement(db, INSERT_AGENT_ROW).run(
    agent.id,
    agent.threadId,
    agent.model,
    agent.updatedAt,
    index,
    json,
    sequence,
  );
}

function writeChangedAgents(
  db: DatabaseSync,
  agents: readonly AgentSummary[],
  sequence: number,
  onAgent: (agent: AgentSummary, changed: boolean) => void,
): void {
  const stored = new Map<string, { sortOrder: number; json: string }>();
  for (const row of databaseRows(
    cachedStatement(db, "SELECT agent_id, sort_order, agent_json FROM projection_agents").all(),
  )) {
    stored.set(requiredStringColumn(row, "agent_id"), {
      sortOrder: requiredNumberColumn(row, "sort_order"),
      json: requiredStringColumn(row, "agent_json"),
    });
  }
  const kept = new Set(agents.map((agent) => agent.id));
  for (const agentId of stored.keys()) {
    if (!kept.has(agentId)) cachedStatement(db, "DELETE FROM projection_agents WHERE agent_id = ?").run(agentId);
  }
  agents.forEach((agent, index) => {
    const json = JSON.stringify(agent);
    const row = stored.get(agent.id);
    const changed = row?.sortOrder !== index || row.json !== json;
    if (changed && row) {
      cachedStatement(
        db,
        `UPDATE projection_agents
         SET thread_id = ?, model = ?, updated_at = ?, sort_order = ?, agent_json = ?, last_event_sequence = ?
         WHERE agent_id = ?`,
      ).run(agent.threadId, agent.model, agent.updatedAt, index, json, sequence, agent.id);
    } else if (changed) {
      insertAgentRow(db, agent, index, json, sequence);
    }
    if (agent.threadId) onAgent(agent, changed);
  });
}

function claimThreadProjection(db: DatabaseSync, agent: AgentSummary, sequence: number): void {
  if (!agent.threadId) return;
  const updatedAt = agent.updatedAt ?? new Date().toISOString();
  cachedStatement(
    db,
    `
    INSERT INTO projection_threads
      (thread_id, agent_id, title, active_turn_id, created_at, updated_at, last_event_sequence)
    VALUES (?, ?, ?, NULL, ?, ?, ?)
    ON CONFLICT(thread_id) DO UPDATE SET
      agent_id = excluded.agent_id,
      title = excluded.title,
      updated_at = excluded.updated_at,
      last_event_sequence = MAX(projection_threads.last_event_sequence, excluded.last_event_sequence)
    WHERE projection_threads.agent_id IS NOT excluded.agent_id OR projection_threads.title IS NOT excluded.title
  `,
  ).run(agent.threadId, agent.id, agent.name, updatedAt, updatedAt, sequence);
}

function pruneRosterEvents(db: DatabaseSync, retainedSequence: number): void {
  const matchOlder = `
    aggregate_type = 'agents' AND aggregate_id = 'agents' AND sequence < ?
      AND event_type <> 'agent.model-changed'`;
  const commandIds = databaseRows(
    db.prepare(`SELECT command_id FROM orchestration_events WHERE ${matchOlder}`).all(retainedSequence),
  ).map((row) => requiredStringColumn(row, "command_id"));
  if (commandIds.length === 0) return;
  db.prepare(`DELETE FROM orchestration_events WHERE ${matchOlder}`).run(retainedSequence);
  deleteReceiptsOf(db, commandIds);
}
