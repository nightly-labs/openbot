import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type {
  ChannelRoutine,
  ChannelRoutineRun,
  ChannelRoutineRunStatus,
  CreateChannelRoutineInput,
  UpdateChannelRoutineInput,
} from "@openbot/contracts/ipc";
import type { OpenBotDatabase } from "./openbot-database";
import {
  type DueRoutine,
  type OwnedRoutine,
  type OwnedRoutineRun,
  RoutineStore,
  type RoutineTables,
} from "./routine-store";

export interface DueChannelRoutine {
  routine: ChannelRoutine;
  triggerId: string;
  nextRunAt: string;
  schedule: DueRoutine["schedule"];
}

const CHANNEL_ROUTINE_TABLES: RoutineTables = {
  routineTable: "projection_channel_routines",
  triggerTable: "projection_channel_routine_triggers",
  runTable: "projection_channel_routine_runs",
  ownerColumn: "channel_id",
  handleColumn: "request_message_id",
  routineAggregate: "channel-routine",
  runAggregate: "channel-routine-run",
  commandPrefix: "channel-routine",
  eventPrefix: "channel-routine",
  limit: INPUT_LIMITS.agentRoutines,
  limitMessage: `A channel can have at most ${INPUT_LIMITS.agentRoutines} routines.`,
};

/**
 * The channel-shaped names over the shared store: `ownerId` reads as `channelId` and the run handle
 * reads as `requestMessageId` - the id of the message the fire posted, which is also the key that
 * joins a run to the tasks it produced.
 */
export class ChannelRoutineStore extends RoutineStore {
  constructor(database: OpenBotDatabase) {
    super(database, CHANNEL_ROUTINE_TABLES);
  }

  list(channelId: string): ChannelRoutine[] {
    return this.listRoutines(channelId).map(toChannelRoutine);
  }

  get(channelId: string, routineId: string): ChannelRoutine | null {
    const routine = this.getRoutine(channelId, routineId);
    return routine ? toChannelRoutine(routine) : null;
  }

  create(input: CreateChannelRoutineInput, now = new Date()): ChannelRoutine {
    const { channelId, ...fields } = input;
    return toChannelRoutine(this.createRoutine(channelId, fields, now));
  }

  update(input: UpdateChannelRoutineInput, now = new Date()): ChannelRoutine {
    const { channelId, ...fields } = input;
    return toChannelRoutine(this.updateRoutine(channelId, fields, now));
  }

  listRuns(channelId: string, routineId: string, limit = 50): ChannelRoutineRun[] {
    return this.listRunRows(channelId, routineId, limit).map(toChannelRun);
  }

  pendingRuns(): ChannelRoutineRun[] {
    return this.pendingRunRows().map(toChannelRun);
  }

  activeRuns(channelId: string, routineId: string): ChannelRoutineRun[] {
    return this.activeRunRows(channelId, routineId).map(toChannelRun);
  }

  /** `excludedChannelIds` carries the archived channels: they must not fire and must not wake the timer. */
  due(now = new Date(), excludedChannelIds: ReadonlySet<string> = new Set()): DueChannelRoutine[] {
    return this.dueRoutines(now, excludedChannelIds).map((entry) => ({
      routine: toChannelRoutine(entry.routine),
      triggerId: entry.triggerId,
      nextRunAt: entry.nextRunAt,
      schedule: entry.schedule,
    }));
  }

  createRun(
    routine: ChannelRoutine,
    triggerId: string | null,
    kind: ChannelRoutineRun["kind"],
    scheduledFor: string,
  ): ChannelRoutineRun {
    return toChannelRun(this.createRunRow(toOwnedRoutine(routine), triggerId, kind, scheduledFor));
  }

  attachRequest(runId: string, requestMessageId: string): ChannelRoutineRun {
    return toChannelRun(this.attachHandleRow(runId, requestMessageId));
  }

  updateRunStatus(runId: string, status: ChannelRoutineRunStatus, error: string | null = null): ChannelRoutineRun {
    return toChannelRun(this.updateRunRow(runId, status, error));
  }

  openRuns(channelId: string): ChannelRoutineRun[] {
    return this.openRunRows(channelId).map(toChannelRun);
  }

  channelsWithOpenRuns(): string[] {
    return this.ownersWithOpenRuns();
  }

  runForRequest(requestMessageId: string): ChannelRoutineRun | null {
    const run = this.runForHandleRow(requestMessageId);
    return run ? toChannelRun(run) : null;
  }
}

function toChannelRoutine({ ownerId, ...fields }: OwnedRoutine): ChannelRoutine {
  return { ...fields, channelId: ownerId };
}

function toOwnedRoutine({ channelId, ...fields }: ChannelRoutine): OwnedRoutine {
  return { ...fields, ownerId: channelId };
}

/**
 * The run table's `status` CHECK omits `interrupted`, so a stored row cannot carry it. The shared
 * store still reads the wider agent union, and this is where the narrower channel one is proved.
 */
function toChannelRun({ ownerId, handleId, status, ...fields }: OwnedRoutineRun): ChannelRoutineRun {
  if (status === "interrupted") throw new Error("The stored channel routine run status is invalid.");
  return { ...fields, channelId: ownerId, requestMessageId: handleId, status };
}
