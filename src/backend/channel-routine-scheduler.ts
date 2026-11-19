import { randomUUID } from "node:crypto";
import {
  type ChannelRoutine,
  type ChannelRoutineRun,
  type ChannelRoutineRunStatus,
  type CreateChannelRoutineInput,
  channelRunStatusForTasks,
  type DeleteChannelRoutineInput,
  type ListChannelRoutineRunsInput,
  type TestChannelRoutineInput,
  type UpdateChannelRoutineInput,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { collapseMissedOccurrences } from "@openbot/team-client/routine-schedule";
import { Effect, Result, Schema } from "effect";
import { failedRunReason } from "./agent/delivery-content";
import { quietRoutineRun } from "./agent/routine-quiet-runs";
import type { RoutineTriggerAccess } from "./agent/routine-scheduler";
import { ChannelRoutineStore } from "./channel-routine-store";
import type { ChannelService } from "./channel-service";
import { causeHelpers } from "./effect-boundary";
import { recordRestartActivity } from "./restart-activity";
import type {
  ImportedRoutineRun,
  OwnedRoutineRecord,
  ReceivedWebhookEvent,
  RoutineHoldWindow,
  RoutineRecordInput,
} from "./routine-store";
import type { RoutineDueSource } from "./routine-timer";

export interface ChannelRoutineHooks {
  changed(channelId: string): void;
  emitError(code: string, error: unknown): void;
  excludedChannels(): ReadonlySet<string>;
  usageLimited(channelId: string): boolean;
}

export interface ChannelRoutineSchedulerOptions {
  channels: ChannelService;
  hooks: ChannelRoutineHooks;
}

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

  hasActiveRuns(): boolean {
    for (const channelId of this.#channels.store.ids()) {
      for (const routine of this.#routines.listRecords(channelId)) {
        if (this.#routines.activeRuns(channelId, routine.id).length > 0) return true;
      }
    }
    return false;
  }

  importRuns(channelId: string, routineId: string, runs: readonly ImportedRoutineRun[]): string[] {
    return this.#routines.importRuns(this.#requireChannel(channelId), routineId, runs);
  }

  listRuns(input: ListChannelRoutineRunsInput, withSkipped = false): ChannelRoutineRun[] {
    return this.#routines.listRuns(
      this.#requireChannel(input.channelId),
      input.routineId,
      input.limit ?? 50,
      withSkipped,
    );
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

  listRecords(channelId: string): OwnedRoutineRecord[] {
    return this.#routines.listRecords(this.#requireChannel(channelId));
  }

  getRecord(channelId: string, routineId: string): OwnedRoutineRecord | null {
    return this.#routines.getRecord(this.#requireChannel(channelId), routineId);
  }

  saveRecord(channelId: string, routineId: string | undefined, input: RoutineRecordInput): OwnedRoutineRecord {
    const routine = this.#routines.saveRecord(this.#requireChannel(channelId), routineId, input);
    this.#changed(channelId);
    return routine;
  }

  readonly receiveWebhook = Effect.fn("ChannelRoutineScheduler.receiveWebhook")(function* (
    this: ChannelRoutineScheduler,
    channelId: string,
    routineId: string,
    event: ReceivedWebhookEvent,
  ) {
    if (!this.#channels.store.exists(channelId) || this.#excluded().has(channelId)) {
      return { kind: "unavailable" } as const;
    }
    const result = yield* channelRoutineStep(() => this.#routines.receiveWebhook(channelId, routineId, event));
    if (result.kind === "ignored") this.#changed(channelId);
    if (result.kind !== "started") return result;
    const run = result.run;
    const record = yield* channelRoutineStep(() => this.#routines.getRecord(channelId, routineId));
    if (record?.limitPolicy === "skip" && this.#hooks.usageLimited(channelId)) {
      yield* channelRoutineStep(() => this.#settle(run, { status: "cancelled", error: null }));
    } else {
      const request = yield* channelRoutineStep(() => this.#routines.attachRequest(run.id, randomUUID()));
      yield* this.#issueEffect(request);
    }
    this.#changed(channelId);
    return result;
  }, Effect.uninterruptible);

  delete(input: DeleteChannelRoutineInput, access: RoutineTriggerAccess = {}): void {
    const channelId = this.#requireChannel(input.channelId);
    if (!access.webhook && this.#routines.getRecord(channelId, input.routineId)?.trigger.kind === "webhook") {
      throw new Error(sourceText("error.backend.routineGone"));
    }
    this.#channels.withdrawRequests(
      channelId,
      new Set(this.#routines.activeRuns(channelId, input.routineId).flatMap((run) => run.requestMessageId ?? [])),
    );
    this.#routines.delete(channelId, input.routineId);
    this.#changed(input.channelId);
  }

  readonly test = Effect.fn("ChannelRoutineScheduler.test")(function* (
    this: ChannelRoutineScheduler,
    input: TestChannelRoutineInput,
    access: RoutineTriggerAccess = {},
  ) {
    const routine = yield* channelRoutineStep(() => {
      const channelId = this.#requireChannel(input.channelId);
      const stored = this.#routines.getRecord(channelId, input.routineId);
      if (!stored || (stored.trigger.kind === "webhook" && !access.webhook)) {
        throw new Error(sourceText("error.backend.routineGone"));
      }
      return { ...stored, channelId: stored.ownerId };
    });
    const now = new Date().toISOString();
    const run =
      routine.limitPolicy === "skip" && this.#hooks.usageLimited(routine.channelId)
        ? yield* channelRoutineStep(() =>
            this.#routines.updateRunStatus(this.#routines.createRun(routine, null, "test", now).id, "cancelled", null),
          )
        : yield* this.#fireEffect(routine, null, now);
    this.#changed(routine.channelId);
    return run;
  }, Effect.uninterruptible);

  skipAtLimit(channelId: string, requestMessageId: string): boolean {
    const run = this.#routines.openRuns(channelId).find((item) => item.requestMessageId === requestMessageId);
    if (!run || this.#routines.getRecord(channelId, run.routineId)?.limitPolicy !== "skip") return false;
    this.#settle(run, { status: "cancelled", error: null });
    return true;
  }

  quietRun(requestMessageId: string): boolean {
    const run = this.#routines.runForRequest(requestMessageId);
    return run !== null && quietRoutineRun(run);
  }

  skipMissed(now: Date, held?: RoutineHoldWindow): void {
    this.#routines.skipMissed(now, held);
  }

  nextDueAt(): string | null {
    return this.#routines.nextDueAt(this.#excluded());
  }

  readonly processDue = Effect.fn("ChannelRoutineScheduler.processDue")(function* (
    this: ChannelRoutineScheduler,
    now = new Date(),
    active: () => boolean = () => true,
  ) {
    const changed = new Set<string>();
    yield* Effect.gen({ self: this }, function* () {
      const pending = yield* channelRoutineStep(() => this.#routines.due(now, this.#excluded()));
      for (const due of pending) {
        if (!active()) break;
        if (this.#excluded().has(due.routine.channelId)) continue;
        const scheduledFor = yield* channelRoutineStep(() => {
          if (due.schedule.kind === "once") {
            this.#routines.completeTrigger(due.routine.id, due.triggerId, now);
            changed.add(due.routine.channelId);
            return due.nextRunAt;
          }
          const occurrence = collapseMissedOccurrences(
            due.schedule,
            due.routine.timezone,
            new Date(due.nextRunAt),
            now,
          );
          this.#routines.advanceTrigger(due.routine.id, due.triggerId, occurrence.nextRunAt.toISOString());
          changed.add(due.routine.channelId);
          return occurrence.scheduledFor.toISOString();
        });
        if (due.routine.limitPolicy === "skip" && this.#hooks.usageLimited(due.routine.channelId)) continue;
        if (yield* channelRoutineStep(() => this.#hasLiveRun(due.routine.channelId, due.routine.id))) continue;
        yield* this.#fireEffect(due.routine, due.triggerId, scheduledFor);
      }
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          for (const channelId of changed) this.#changed(channelId);
        }),
      ),
    );
  });

  readonly resumePendingRuns = Effect.fn("ChannelRoutineScheduler.resumePendingRuns")(function* (
    this: ChannelRoutineScheduler,
  ) {
    const pending = yield* channelRoutineStep(() => this.#routines.pendingRuns());
    for (const run of pending) {
      if (this.#excluded().has(run.channelId) || !this.#channels.store.exists(run.channelId)) {
        yield* channelRoutineStep(() => this.#settle(run, { status: "cancelled", error: null }));
        continue;
      }
      const request = yield* channelRoutineStep(() =>
        run.requestMessageId ? run : this.#routines.attachRequest(run.id, randomUUID()),
      );
      yield* this.#issueEffect(request);
    }
  });

  reconcile(channelId: string): void {
    try {
      const exists = this.#channels.store.exists(channelId);
      const tasks = exists ? this.#channels.store.tasks(channelId) : [];
      const assignments = exists ? this.#channels.store.assignments(channelId) : [];
      const live = [
        ...new Set(
          tasks
            .filter((task) => task.state !== "completed" && task.state !== "cancelled")
            .map((task) => task.requestMessageId),
        ),
      ];
      let changed = false;
      for (const run of [
        ...this.#routines.openRuns(channelId),
        ...this.#routines.failedRunsForRequests(channelId, live),
      ]) {
        if (!run.requestMessageId) continue;
        if (exists && !this.#channels.committed(this.#actor(run).id, this.#operationId(run))) continue;
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

  #hasLiveRun(channelId: string, routineId: string): boolean {
    const requests = new Set(
      this.#routines.activeRuns(channelId, routineId).flatMap((run) => run.requestMessageId ?? []),
    );
    if (!requests.size) return false;
    return this.#channels.store
      .tasks(channelId)
      .some((task) => requests.has(task.requestMessageId) && task.state !== "completed" && task.state !== "cancelled");
  }

  readonly #fireEffect = Effect.fn("ChannelRoutineScheduler.fire")(function* (
    this: ChannelRoutineScheduler,
    routine: Pick<ChannelRoutine, "id" | "channelId" | "name" | "instruction">,
    triggerId: string | null,
    scheduledFor: string,
  ) {
    const run = yield* channelRoutineStep(() => {
      const created = this.#routines.createRun(routine, triggerId, triggerId ? "scheduled" : "test", scheduledFor);
      return created.requestMessageId ? created : this.#routines.attachRequest(created.id, randomUUID());
    });
    return yield* this.#issueEffect(run);
  }, Effect.uninterruptible);

  readonly #issueEffect = Effect.fn("ChannelRoutineScheduler.issue")(function* (
    this: ChannelRoutineScheduler,
    run: ChannelRoutineRun,
  ) {
    recordRestartActivity();
    const requestMessageId = run.requestMessageId;
    if (!requestMessageId)
      return yield* new ChannelRoutineFailed({ cause: new Error("The routine run has no request message.") });
    const issued = yield* Effect.result(
      this.#channels
        .command(
          {
            type: "request",
            operationId: this.#operationId(run),
            channelId: run.channelId,
            text: run.instruction,
            recipientAgentId: null,
            requestMessageId,
            origin: { kind: "routine", routineId: run.routineId, routineName: run.routineName, runId: run.id },
          },
          this.#actor(run),
          (queued) => (this.#routines.getRecord(run.channelId, run.routineId) ? queued : null),
        )
        .pipe(toChannelRoutineFailed),
    );
    if (!this.#routines.getRecord(run.channelId, run.routineId)) {
      yield* channelRoutineStep(() => {
        this.#channels.withdrawRequests(run.channelId, new Set([requestMessageId]));
        this.#changed(run.channelId);
      });
      return run;
    }
    if (Result.isFailure(issued)) {
      const error = issued.failure.cause;
      return yield* channelRoutineStep(() => {
        this.#settle(run, { status: "failed", error: error instanceof Error ? error.message : String(error) });
        this.#hooks.emitError("channel_routine_fire_failed", error);
        return this.#routines.runForRequest(requestMessageId) ?? run;
      });
    }
    return run;
  }, Effect.uninterruptible);

  #actor(run: ChannelRoutineRun): { id: string; name: string } {
    return { id: `routine:${run.routineId}`, name: run.routineName };
  }

  #operationId(run: ChannelRoutineRun): string {
    return `channel-routine-run:${run.id}`;
  }

  #settle(run: ChannelRoutineRun, next: { status: ChannelRoutineRunStatus; error: string | null }): boolean {
    const error = next.status === "failed" ? failedRunReason(next.error, run) : next.error;
    if (run.status === next.status && run.error === error) return false;
    this.#routines.updateRunStatus(run.id, next.status, error);
    return true;
  }

  #excluded(): ReadonlySet<string> {
    return new Set([...this.#channels.store.archivedIds(), ...this.#hooks.excludedChannels()]);
  }

  #requireChannel(channelId: string): string {
    if (!this.#channels.store.exists(channelId)) throw new Error(sourceText("error.backend.channelNotFound"));
    return channelId;
  }

  #changed(channelId: string): void {
    this.#hooks.changed(channelId);
  }
}

class ChannelRoutineFailed extends Schema.TaggedError<ChannelRoutineFailed>()("ChannelRoutineFailed", {
  cause: Schema.Defect(),
}) {}

const { sync: channelRoutineStep, rewrap: toChannelRoutineFailed } = causeHelpers(ChannelRoutineFailed);
