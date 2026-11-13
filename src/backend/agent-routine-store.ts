import type {
  CreateRoutineInput,
  Routine,
  RoutineRun,
  RoutineRunStatus,
  UpdateRoutineInput,
} from "@openbot/contracts/ipc";
import type { OpenBotDatabase } from "./openbot-database";
import {
  type DueRoutine,
  type ImportedRoutineRun,
  type OwnedRoutine,
  type OwnedRoutineRun,
  type ReceivedWebhookEvent,
  type RoutineRunStart,
  RoutineStore,
  type WebhookReceiveResult,
} from "./routine-store";
import { ROUTINE_TABLES } from "./routine-tables";

// The `command_id` of the one-time pause of the routines of hidden agents. Its receipt stops the pause
// from running again, so the id never changes.
const HIDDEN_AGENT_ROUTINE_PAUSE_COMMAND_ID = "routine:hidden-agent-pause:v1";

export interface DueRoutineTrigger {
  routine: Routine;
  triggerId: string;
  nextRunAt: string;
  schedule: DueRoutine["schedule"];
}

/**
 * The agent-shaped names over the shared store: `ownerId` reads as `agentId` and the run handle
 * reads as `deliveryId`. The SQL, the constraints and the command ids all live in `RoutineStore`,
 * so this file only translates - which is why the callers did not change with the extraction.
 */
export class AgentRoutineStore extends RoutineStore {
  constructor(database: OpenBotDatabase) {
    super(database, ROUTINE_TABLES.agent);
  }

  list(agentId: string): Routine[] {
    return this.listRoutines(agentId).map(toRoutine);
  }

  get(agentId: string, routineId: string): Routine | null {
    const routine = this.getRoutine(agentId, routineId);
    return routine ? toRoutine(routine) : null;
  }

  duplicate(sourceAgentId: string, targetAgentId: string, now = new Date()): Map<string, Routine> {
    const duplicated = new Map<string, Routine>();
    for (const routine of this.list(sourceAgentId)) {
      duplicated.set(
        routine.id,
        this.create(
          {
            agentId: targetAgentId,
            name: routine.name,
            instruction: routine.instruction,
            active: routine.active,
            timezone: routine.timezone,
            schedule: routine.trigger.schedule,
            ...(routine.limitPolicy ? { limitPolicy: routine.limitPolicy } : {}),
            ...(routine.missedPolicy ? { missedPolicy: routine.missedPolicy } : {}),
            ...(routine.runIn ? { runIn: routine.runIn } : {}),
          },
          now,
        ),
      );
    }
    return duplicated;
  }

  create(input: CreateRoutineInput, now = new Date()): Routine {
    const { agentId, ...fields } = input;
    return toRoutine(this.createRoutine(agentId, fields, now));
  }

  update(input: UpdateRoutineInput, now = new Date()): Routine {
    const { agentId, ...fields } = input;
    return toRoutine(this.updateRoutine(agentId, fields, now));
  }

  /**
   * Turns off, one time, each active routine of these agents, and answers the ids of the routines it
   * turned off. Before a hidden agent could work, a hide stopped the routines of the agent. The user
   * chose that stop, so the update must not start them: each one stays off until the user turns it on.
   * The receipt of the command is the marker that stops a second run. A hard delete of an agent
   * removes the receipts of the events with the id of the agent as aggregate id. The aggregate id
   * here is the command id: its ":" makes it no agent id, so the receipt stays. A new database has no
   * hidden agent and gets the receipt at its first start.
   */
  pauseForAgentsHiddenBeforeWork(agentIds: readonly string[], now = new Date()): string[] {
    if (this.database.commandResult(HIDDEN_AGENT_ROUTINE_PAUSE_COMMAND_ID) !== undefined) return [];
    const routineIds = agentIds.flatMap((agentId) =>
      this.listRecords(agentId).flatMap((routine) => (routine.active ? [routine.id] : [])),
    );
    this.database.dispatch(
      HIDDEN_AGENT_ROUTINE_PAUSE_COMMAND_ID,
      [
        {
          aggregateType: "agent-hidden-routine-pause",
          aggregateId: HIDDEN_AGENT_ROUTINE_PAUSE_COMMAND_ID,
          eventType: "routine.hidden-agents-paused",
          payload: { agentIds, routineIds },
        },
      ],
      (db, sequences) => {
        const pause = db.prepare(
          `UPDATE ${this.tables.routineTable} SET active = 0, updated_at = ?, last_event_sequence = ?
           WHERE routine_id = ? AND active = 1`,
        );
        for (const routineId of routineIds) pause.run(now.toISOString(), sequences[0] ?? 0, routineId);
        return null;
      },
    );
    return routineIds;
  }

  /** Writes the finished runs that a server transfer brought for one of the agent's routines. */
  importRuns(agentId: string, routineId: string, runs: readonly ImportedRoutineRun[]): string[] {
    return this.importRunRows(routineId, agentId, runs);
  }

  listRuns(agentId: string, routineId: string, limit = 50, withSkipped = false): RoutineRun[] {
    return this.listRunRows(agentId, routineId, limit, withSkipped).map(toRun);
  }

  pendingRuns(): RoutineRun[] {
    return this.pendingRunRows().map(toRun);
  }

  activeRuns(agentId: string, routineId: string): RoutineRun[] {
    return this.activeRunRows(agentId, routineId).map(toRun);
  }

  due(now = new Date(), excludedAgentIds: ReadonlySet<string> = new Set()): DueRoutineTrigger[] {
    return this.dueRoutines(now, excludedAgentIds).map((entry) => ({
      routine: toRoutine(entry.routine),
      triggerId: entry.triggerId,
      nextRunAt: entry.nextRunAt,
      schedule: entry.schedule,
    }));
  }

  createRun(
    routine: Pick<Routine, "id" | "agentId" | "name" | "instruction">,
    triggerId: string | null,
    start: RoutineRunStart,
    scheduledFor: string,
  ): RoutineRun {
    return toRun(this.createRunRow(runSource(routine), triggerId, start, scheduledFor));
  }

  receiveWebhook(agentId: string, routineId: string, event: ReceivedWebhookEvent): WebhookReceiveResult<RoutineRun> {
    const result = this.receiveWebhookRow(agentId, routineId, event);
    return result.kind === "started" ? { kind: "started", run: toRun(result.run) } : result;
  }

  attachDelivery(runId: string, deliveryId: string): RoutineRun {
    return toRun(this.attachHandleRow(runId, deliveryId));
  }

  updateRunStatus(runId: string, status: RoutineRunStatus, error: string | null = null): RoutineRun {
    return toRun(this.updateRunRow(runId, status, error));
  }

  runForDelivery(deliveryId: string): RoutineRun | null {
    const run = this.runForHandleRow(deliveryId);
    return run ? toRun(run) : null;
  }
}

function toRoutine({ ownerId, ...fields }: OwnedRoutine): Routine {
  return { ...fields, agentId: ownerId };
}

function runSource({ id, agentId, name, instruction }: Pick<Routine, "id" | "agentId" | "name" | "instruction">) {
  return { id, ownerId: agentId, name, instruction };
}

function toRun({ ownerId, handleId, ...fields }: OwnedRoutineRun): RoutineRun {
  return { ...fields, agentId: ownerId, deliveryId: handleId };
}
