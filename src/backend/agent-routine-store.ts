import { randomUUID } from "node:crypto";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type {
  CreateRoutineInput,
  Routine,
  RoutineRun,
  RoutineRunStatus,
  UpdateRoutineInput,
} from "@openbot/contracts/ipc";
import type { EventRoutine } from "@openbot/contracts/ipc-events";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import type { OpenBotDatabase } from "./openbot-database";
import {
  type DueRoutine,
  type OwnedRoutine,
  type OwnedRoutineRun,
  RoutineStore,
  type RoutineTables,
} from "./routine-store";

export interface DueRoutineTrigger {
  routine: Routine;
  triggerId: string;
  nextRunAt: string;
  schedule: DueRoutine["schedule"];
}

const AGENT_ROUTINE_TABLES: RoutineTables = {
  routineTable: "projection_agent_routines",
  triggerTable: "projection_routine_triggers",
  runTable: "projection_routine_runs",
  ownerColumn: "agent_id",
  handleColumn: "delivery_id",
  routineAggregate: "agent-routine",
  runAggregate: "routine-run",
  commandPrefix: "routine",
  eventPrefix: "routine",
  limit: INPUT_LIMITS.agentRoutines,
  limitMessage: sourceText("error.backend.agentRoutineLimit", { limit: INPUT_LIMITS.agentRoutines }),
};

/**
 * The agent-shaped names over the shared store: `ownerId` reads as `agentId` and the run handle
 * reads as `deliveryId`. The SQL, the constraints and the command ids all live in `RoutineStore`,
 * so this file only translates - which is why the callers and `agent-routine-store.test.ts` did not
 * change with the extraction.
 */
export class AgentRoutineStore extends RoutineStore {
  constructor(database: OpenBotDatabase) {
    super(database, AGENT_ROUTINE_TABLES);
  }

  list(agentId: string): Routine[] {
    return this.listRoutines(agentId).map(toRoutine);
  }

  get(agentId: string, routineId: string): Routine | null {
    const routine = this.getRoutine(agentId, routineId);
    return routine ? toRoutine(routine) : null;
  }

  hasEventRoutine(agentId: string, routineId: string): boolean {
    const row = this.database.connection
      .prepare(
        `SELECT routine_id FROM projection_event_routine_triggers
         WHERE routine_id = ? AND owner_kind = 'agent' AND owner_id = ?`,
      )
      .get(routineId, agentId);
    return isDynamicRecord(row);
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

  listRuns(agentId: string, routineId: string, limit = 50): RoutineRun[] {
    return this.listRunRows(agentId, routineId, limit).map(toRun);
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
    routine: Routine,
    triggerId: string | null,
    kind: RoutineRun["kind"],
    scheduledFor: string,
    runId?: string,
  ): RoutineRun {
    return toRun(this.createRunRow(toOwnedRoutine(routine), triggerId, kind, scheduledFor, runId ?? randomUUID()));
  }

  ensureEventRoutine(routine: EventRoutine): Routine {
    if (routine.owner.kind !== "agent") throw new Error("The event routine owner is invalid.");
    this.ensureRoutineRecord(routine.owner.id, {
      id: routine.id,
      name: routine.name,
      instruction: routine.instruction,
      timezone: routine.timezone,
      ...(routine.limitPolicy === undefined ? {} : { limitPolicy: routine.limitPolicy }),
    });
    const trigger: Routine["trigger"] = {
      id: `event:${routine.id}`,
      routineId: routine.id,
      schedule: { kind: "custom", expression: "0 0 1 1 *" },
      nextRunAt: "9999-12-31T23:59:59.999Z",
      createdAt: routine.createdAt,
      updatedAt: routine.updatedAt,
    };
    return {
      id: routine.id,
      agentId: routine.owner.id,
      name: routine.name,
      instruction: routine.instruction,
      active: false,
      timezone: routine.timezone,
      trigger,
      ...(routine.limitPolicy === undefined ? {} : { limitPolicy: routine.limitPolicy }),
      createdAt: routine.createdAt,
      updatedAt: routine.updatedAt,
    };
  }

  convertEventRoutineToSchedule(input: {
    agentId: string;
    routineId: string;
    name: string;
    instruction: string;
    active: boolean;
    timezone: string;
    schedule: Routine["trigger"]["schedule"];
    limitPolicy?: Routine["limitPolicy"];
    createdAt?: string;
  }): Routine {
    return toRoutine(this.convertEventRoutineToScheduleRow(input.agentId, input));
  }

  deactivateEventRoutine(agentId: string, routineId: string): void {
    this.database.connection
      .prepare("UPDATE projection_agent_routines SET active = 0, updated_at = ? WHERE agent_id = ? AND routine_id = ?")
      .run(new Date().toISOString(), agentId, routineId);
  }

  eventLimitPolicy(agentId: string, routineId: string): Routine["limitPolicy"] {
    const row = this.database.connection
      .prepare("SELECT limit_policy FROM projection_agent_routines WHERE agent_id = ? AND routine_id = ?")
      .get(agentId, routineId);
    return isDynamicRecord(row) && (row.limit_policy === "wait" || row.limit_policy === "skip")
      ? row.limit_policy
      : undefined;
  }

  deleteEventRoutine(agentId: string, routineId: string): void {
    this.deleteEventRoutineProjection(agentId, routineId);
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

function toOwnedRoutine({ agentId, ...fields }: Routine): OwnedRoutine {
  return { ...fields, ownerId: agentId };
}

function toRun({ ownerId, handleId, ...fields }: OwnedRoutineRun): RoutineRun {
  return { ...fields, agentId: ownerId, deliveryId: handleId };
}
