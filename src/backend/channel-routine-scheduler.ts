import { randomUUID } from "node:crypto";
import type {
  ChannelRoutine,
  ChannelRoutineRun,
  ChannelRoutineRunStatus,
  ChannelTask,
  CreateChannelRoutineInput,
  DeleteChannelRoutineInput,
  ListChannelRoutineRunsInput,
  TestChannelRoutineInput,
  UpdateChannelRoutineInput,
} from "@openbot/contracts/ipc";
import { ChannelRoutineStore } from "./channel-routine-store";
import type { ChannelService } from "./channel-service";
import { collapseMissedOccurrences } from "./routine-schedule";
import type { RoutineDueSource } from "./routine-timer";

export interface ChannelRoutineHooks {
  changed(channelId: string): void;
  emitError(code: string, error: unknown): void;
  excludedChannels(): ReadonlySet<string>;
}

export interface ChannelRoutineSchedulerOptions {
  channels: ChannelService;
  hooks: ChannelRoutineHooks;
}

/**
 * Reads the run's status out of the tasks its request produced. Pure, because that is what makes a
 * restart free: the status is a function of durable rows, so a fresh scheduler over the same
 * database reaches the same answer with no in-memory state.
 *
 * `hasAssignment` separates "nobody has picked this up yet" from "a member is on it": an assignment
 * is a durable row, so the difference survives a restart too.
 */
export function channelRunStatusForTasks(
  tasks: ChannelTask[],
  hasAssignment: boolean,
): { status: ChannelRoutineRunStatus; error: string | null } {
  // A later human message can absorb the routine's open task and take its request id with it, and a
  // deleted channel takes every task. Neither is a failure of the routine.
  if (!tasks.length) return { status: "cancelled", error: null };
  if (tasks.some((task) => task.state === "running")) return { status: "running", error: null };
  if (tasks.some((task) => task.state === "queued" || task.state === "waiting"))
    return { status: hasAssignment ? "running" : "queued", error: null };
  const failed = tasks.find((task) => task.state === "failed");
  if (failed) return { status: "failed", error: failed.error };
  // In a channel, `paused` always means a human has to act: a routing question, an unavailable
  // owner, the assignment limit, an unconfirmed turn, or an explicit Stop.
  const paused = tasks.find((task) => task.state === "paused");
  if (paused) return { status: "needs-attention", error: paused.error };
  // Every task is completed or cancelled. This includes the lead judging that no work was needed.
  return { status: "succeeded", error: null };
}

/**
 * Owns standing instructions attached to a channel. A fire is not a private path into the channel:
 * it is a `request` command, so it inherits the per-channel serialisation, the retry receipt and
 * the archived guard that every other channel command already has.
 */
export class ChannelRoutineScheduler implements RoutineDueSource {
  readonly #channels: ChannelService;
  readonly #hooks: ChannelRoutineHooks;
  readonly #routines: ChannelRoutineStore;

  constructor(options: ChannelRoutineSchedulerOptions) {
    this.#channels = options.channels;
    this.#hooks = options.hooks;
    this.#routines = new ChannelRoutineStore(options.channels.store.database);
  }

  list(channelId: string): ChannelRoutine[] {
    return this.#routines.list(this.#requireChannel(channelId));
  }

  listRuns(input: ListChannelRoutineRunsInput): ChannelRoutineRun[] {
    return this.#routines.listRuns(this.#requireChannel(input.channelId), input.routineId, input.limit ?? 50);
  }

  create(input: CreateChannelRoutineInput): ChannelRoutine {
    const routine = this.#routines.create({ ...input, channelId: this.#requireChannel(input.channelId) });
    this.#changed(routine.channelId);
    return routine;
  }

  update(input: UpdateChannelRoutineInput): ChannelRoutine {
    const routine = this.#routines.update({ ...input, channelId: this.#requireChannel(input.channelId) });
    this.#changed(routine.channelId);
    return routine;
  }

  delete(input: DeleteChannelRoutineInput): void {
    this.#routines.delete(this.#requireChannel(input.channelId), input.routineId);
    this.#changed(input.channelId);
  }

  /** A manual fire: no trigger, so it never collides with the scheduled occurrence. */
  async test(input: TestChannelRoutineInput): Promise<ChannelRoutineRun> {
    const channelId = this.#requireChannel(input.channelId);
    const routine = this.#routines.get(channelId, input.routineId);
    if (!routine) throw new Error("This routine no longer exists.");
    const run = await this.#fire(routine, null, new Date().toISOString());
    this.#changed(channelId);
    return run;
  }

  skipMissed(now: Date): void {
    this.#routines.skipMissed(now);
  }

  /** The earliest channel routine, for the shared timer to compare against the other owners. */
  nextDueAt(): string | null {
    return this.#routines.nextDueAt(this.#excluded());
  }

  async processDue(now = new Date()): Promise<void> {
    const changed = new Set<string>();
    try {
      for (const due of this.#routines.due(now, this.#excluded())) {
        // A previous fire can yield while the channel is archived.
        if (this.#excluded().has(due.routine.channelId)) continue;
        const { scheduledFor, nextRunAt } = collapseMissedOccurrences(
          due.schedule,
          due.routine.timezone,
          new Date(due.nextRunAt),
          now,
        );
        // The trigger advances whether or not the fire succeeds, so a channel builds no backlog.
        this.#routines.advanceTrigger(due.routine.id, due.triggerId, nextRunAt.toISOString());
        changed.add(due.routine.channelId);
        await this.#fire(due.routine, due.triggerId, scheduledFor.toISOString());
      }
    } finally {
      for (const channelId of changed) this.#changed(channelId);
    }
  }

  /**
   * Repairs the crash window between minting a run and issuing its command. A run without a request
   * id never reached the channel, so it is fired now; a run that has one re-issues the identical
   * command, which the receipt turns into a no-op that only re-wakes the channel.
   */
  async resumePendingRuns(): Promise<void> {
    for (const run of this.#routines.pendingRuns()) {
      if (this.#excluded().has(run.channelId) || !this.#channels.store.exists(run.channelId)) {
        this.#settle(run, { status: "cancelled", error: null });
        continue;
      }
      await this.#issue(run.requestMessageId ? run : this.#routines.attachRequest(run.id, randomUUID()));
    }
  }

  /**
   * Runs inside `ChannelHooks.changed`, one frame after a channel commit. It only reads the channel
   * store and writes its own table, and it must never throw: an exception here would surface as a
   * failed `publish` rather than as a wrong run status.
   */
  reconcile(channelId: string): void {
    try {
      const exists = this.#channels.store.exists(channelId);
      const tasks = exists ? this.#channels.store.tasks(channelId) : [];
      const assignments = exists ? this.#channels.store.assignments(channelId) : [];
      let changed = false;
      for (const run of this.#routines.openRuns(channelId)) {
        // A run with no request id has not reached the channel yet; `resumePendingRuns` owns it.
        if (!run.requestMessageId) continue;
        const requestId = run.requestMessageId;
        const owned = tasks.filter((task) => task.requestMessageId === requestId);
        const hasAssignment = assignments.some(
          (assignment) =>
            owned.some((task) => task.id === assignment.taskId) &&
            (assignment.state === "queued" || assignment.state === "starting" || assignment.state === "running"),
        );
        changed = this.#settle(run, channelRunStatusForTasks(owned, hasAssignment)) || changed;
      }
      if (changed) this.#changed(channelId);
    } catch (error) {
      this.#hooks.emitError("channel_routine_reconcile_failed", error);
    }
  }

  reconcileAll(): void {
    for (const channelId of this.#routines.channelsWithOpenRuns()) this.reconcile(channelId);
  }

  /**
   * The run row is written before the command, and both halves of the command's receipt key are
   * functions of the run id. A crash between the two is therefore repaired by replaying the
   * command, which is what makes `resumePendingRuns` exactly-once with no separate dedupe.
   */
  async #fire(routine: ChannelRoutine, triggerId: string | null, scheduledFor: string): Promise<ChannelRoutineRun> {
    const created = this.#routines.createRun(routine, triggerId, triggerId ? "scheduled" : "manual", scheduledFor);
    const run = created.requestMessageId ? created : this.#routines.attachRequest(created.id, randomUUID());
    return this.#issue(run);
  }

  async #issue(run: ChannelRoutineRun): Promise<ChannelRoutineRun> {
    if (!run.requestMessageId) throw new Error("The routine run has no request message.");
    try {
      await this.#channels.command(
        {
          type: "request",
          operationId: `channel-routine-run:${run.id}`,
          channelId: run.channelId,
          text: run.instruction,
          // Always the lead's decision. A routine pinned to one member would fail the moment that
          // member left the channel.
          recipientAgentId: null,
          requestMessageId: run.requestMessageId,
          origin: {
            kind: "routine",
            routineId: run.routineId,
            routineName: run.routineName,
            runId: run.id,
          },
        },
        { id: `routine:${run.routineId}`, name: run.routineName },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.#settle(run, { status: "failed", error: message });
      this.#hooks.emitError("channel_routine_fire_failed", error);
      return this.#routines.runForRequest(run.requestMessageId) ?? run;
    }
    return run;
  }

  /** Writes only on a change, so a channel that publishes often does not rewrite every run row. */
  #settle(run: ChannelRoutineRun, next: { status: ChannelRoutineRunStatus; error: string | null }): boolean {
    if (run.status === next.status && run.error === next.error) return false;
    this.#routines.updateRunStatus(run.id, next.status, next.error);
    return true;
  }

  #excluded(): ReadonlySet<string> {
    return new Set([...this.#channels.store.archivedIds(), ...this.#hooks.excludedChannels()]);
  }

  #requireChannel(channelId: string): string {
    if (!this.#channels.store.exists(channelId)) throw new Error("Channel not found.");
    return channelId;
  }

  #changed(channelId: string): void {
    this.#hooks.changed(channelId);
  }
}
