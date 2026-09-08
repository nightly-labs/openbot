import type { DatabaseSync } from "node:sqlite";
import type { AgentSummary } from "@openbot/contracts/ipc";
import type { DatabaseCore } from "./database-core";
import { databaseRows, requiredStringColumn } from "./database-rows";

export interface AgentRosterOptions {
  core: DatabaseCore;
}

/**
 * The set of agents that exist and the thread row each one owns.
 *
 * Owns `projection_agents` and the `projection_threads` row implied by an agent having a thread,
 * which is why `ensureThreadProjection` is public here and not on the facade: the conversation
 * writer calls it from inside its own dispatch, passing the `db` that dispatch handed it.
 *
 * `hardDeleteAgent` is the one method here that erases history rather than projecting it. Each
 * receipt DELETE selects its command ids out of `orchestration_events`, so receipts must go before
 * the matching events in all four blocks — grouping the receipt deletes together would leave orphan
 * receipts, and `dispatch` replays an orphan receipt's stale result to a future command as though
 * it had already run. The class never imports the facade.
 */
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

  /**
   * Every thread row no agent claims as its own `thread_id`.
   *
   * `projection_threads.agent_id` carries no foreign key to `projection_agents`, the chat list is the
   * roster with no join, and nothing else in the app enumerates threads -- so a thread that falls out
   * of the roster becomes unreachable rather than broken, and reports itself as an empty chat. This is
   * the only query that can see one. `replaceAgents` is how they appear: it truncates the roster and
   * re-inserts the in-memory list, while `ensureThreadProjection` never deletes, so a persist made
   * with an agent missing leaves that agent's thread and every message in it behind.
   *
   * Claimed by `thread_id` rather than matched on `agent_id`, because both halves of the split have to
   * be caught: an agent rebuilt under its own id points at no thread while its old row still names it,
   * and a thread whose `agent_id` keeps a pre-rename spelling names an agent that no longer answers to
   * it. Ordered so that a repair over the result is deterministic.
   */
  unclaimedThreads(): { threadId: string; agentId: string }[] {
    return databaseRows(
      this.#core.connection
        .prepare(
          `SELECT thread_id, agent_id FROM projection_threads
           WHERE thread_id NOT IN (SELECT thread_id FROM projection_agents WHERE thread_id IS NOT NULL)
           ORDER BY thread_id`,
        )
        .all(),
    ).map((row) => ({
      threadId: requiredStringColumn(row, "thread_id"),
      agentId: requiredStringColumn(row, "agent_id"),
    }));
  }

  replaceAgents(commandId: string, agents: AgentSummary[], eventType: string): void {
    this.#core.dispatch(
      commandId,
      [
        {
          aggregateType: "agents",
          aggregateId: "agents",
          eventType,
          payload: { agents },
        },
      ],
      (db, sequences) => {
        db.exec("DELETE FROM projection_agents");
        const insert = db.prepare(`
          INSERT INTO projection_agents
            (agent_id, thread_id, model, updated_at, sort_order, agent_json, last_event_sequence)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        agents.forEach((agent, index) => {
          insert.run(
            agent.id,
            agent.threadId,
            agent.model,
            agent.updatedAt,
            index,
            JSON.stringify(agent),
            sequences[0],
          );
          if (agent.threadId) this.ensureThreadProjection(db, agent, sequences[0] ?? 0);
        });
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
        db.prepare("DELETE FROM projection_agent_routines WHERE agent_id = ?").run(agentId);
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
    db.prepare(`
      INSERT INTO projection_threads
        (thread_id, agent_id, title, active_turn_id, created_at, updated_at, last_event_sequence)
      VALUES (?, ?, ?, NULL, ?, ?, ?)
      ON CONFLICT(thread_id) DO UPDATE SET
        agent_id = excluded.agent_id,
        title = excluded.title,
        updated_at = excluded.updated_at,
        last_event_sequence = MAX(projection_threads.last_event_sequence, excluded.last_event_sequence)
    `).run(
      agent.threadId,
      agent.id,
      agent.name,
      agent.updatedAt ?? new Date().toISOString(),
      agent.updatedAt ?? new Date().toISOString(),
      sequence,
    );
  }
}
