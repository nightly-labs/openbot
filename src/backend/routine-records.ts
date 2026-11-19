import type { RoutineRunFields } from "@openbot/contracts/ipc";
import type { EventRoutineOwner, EventRoutineRun } from "@openbot/contracts/ipc-events";
import { ROUTINE_RECOVERY_RUN_ERROR_LIMIT } from "@openbot/contracts/team-protocol/routine-recovery-v1";
import { Effect, Schema } from "effect";
import type { RoutineScheduler } from "./agent/routine-scheduler";
import type { ChannelRoutineScheduler } from "./channel-routine-scheduler";
import type { OpenBotDatabase } from "./openbot-database";
import type {
  OwnedRoutineRecord,
  ReceivedWebhookEvent,
  RoutineRecordInput,
  WebhookReceiveResult,
} from "./routine-store";
import { WebhookRouteStore } from "./webhook-route-store";

export class RoutineRecordFailed extends Schema.TaggedError<RoutineRecordFailed>()("RoutineRecordFailed", {
  operation: Schema.String,
  cause: Schema.Defect(),
}) {}

export interface RoutineRecordsOptions {
  database: OpenBotDatabase;
  agentRoutines: RoutineScheduler;
  channelRoutines: ChannelRoutineScheduler;
  agentExists(agentId: string): boolean;
  channelExists(channelId: string): boolean;
  channelRoutinesChanged(channelId: string): void;
  routinesHeld(): boolean;
}

function failed(operation: string) {
  return (failure: { readonly cause: unknown }) => new RoutineRecordFailed({ operation, cause: failure.cause });
}

export class RoutineRecords {
  readonly routes: WebhookRouteStore;
  readonly #options: RoutineRecordsOptions;

  constructor(options: RoutineRecordsOptions) {
    this.#options = options;
    this.routes = new WebhookRouteStore(options.database);
  }

  ownerExists(owner: EventRoutineOwner): boolean {
    return owner.kind === "agent" ? this.#options.agentExists(owner.id) : this.#options.channelExists(owner.id);
  }

  list(owner: EventRoutineOwner): OwnedRoutineRecord[] {
    return owner.kind === "agent"
      ? this.#options.agentRoutines.listRecords(owner.id)
      : this.#options.channelRoutines.listRecords(owner.id);
  }

  get(owner: EventRoutineOwner, routineId: string): OwnedRoutineRecord | null {
    return owner.kind === "agent"
      ? this.#options.agentRoutines.getRecord(owner.id, routineId)
      : this.#options.channelRoutines.getRecord(owner.id, routineId);
  }

  save(owner: EventRoutineOwner, routineId: string | undefined, input: RoutineRecordInput): OwnedRoutineRecord {
    return owner.kind === "agent"
      ? this.#options.agentRoutines.saveRecord(owner.id, routineId, input)
      : this.#options.channelRoutines.saveRecord(owner.id, routineId, input);
  }

  listRuns(owner: EventRoutineOwner, routineId: string, limit: number): EventRoutineRun[] {
    if (owner.kind === "agent") {
      return this.#options.agentRoutines
        .listRuns({ agentId: owner.id, routineId, limit }, true)
        .map((run) => ({ ...eventRoutineRun(run), deliveryId: run.deliveryId }));
    }
    return this.#options.channelRoutines
      .listRuns({ channelId: owner.id, routineId, limit }, true)
      .map((run) => ({ ...eventRoutineRun(run), requestMessageId: run.requestMessageId }));
  }

  changed(owner: EventRoutineOwner): void {
    if (owner.kind === "agent") this.#options.agentRoutines.stateChanged(owner.id);
    else this.#options.channelRoutinesChanged(owner.id);
  }

  delete(owner: EventRoutineOwner, routineId: string): Effect.Effect<void, RoutineRecordFailed> {
    return owner.kind === "agent"
      ? this.#options.agentRoutines
          .delete({ agentId: owner.id, routineId }, { webhook: true })
          .pipe(Effect.mapError(failed("delete")))
      : Effect.try({
          try: () => this.#options.channelRoutines.delete({ channelId: owner.id, routineId }, { webhook: true }),
          catch: (cause) => new RoutineRecordFailed({ operation: "delete", cause }),
        });
  }

  test(owner: EventRoutineOwner, routineId: string): Effect.Effect<void, RoutineRecordFailed> {
    const run: Effect.Effect<unknown, { readonly cause: unknown }> =
      owner.kind === "agent"
        ? this.#options.agentRoutines.test({ agentId: owner.id, routineId }, { webhook: true })
        : this.#options.channelRoutines.test({ channelId: owner.id, routineId }, { webhook: true });
    return Effect.mapError(Effect.asVoid(run), failed("test"));
  }

  receiveWebhook(
    owner: EventRoutineOwner,
    routineId: string,
    event: ReceivedWebhookEvent,
  ): Effect.Effect<WebhookReceiveResult<unknown> | { kind: "unavailable" }, RoutineRecordFailed> {
    if (this.#options.routinesHeld()) return Effect.succeed({ kind: "unavailable" });
    return owner.kind === "agent"
      ? this.#options.agentRoutines.receiveWebhook(owner.id, routineId, event).pipe(Effect.mapError(failed("receive")))
      : this.#options.channelRoutines
          .receiveWebhook(owner.id, routineId, event)
          .pipe(Effect.mapError(failed("receive")));
  }
}

function eventRoutineRun({
  id,
  routineId,
  triggerId,
  kind,
  source,
  scheduledFor,
  routineName,
  instruction,
  status,
  error,
  missed,
  createdAt,
  updatedAt,
}: RoutineRunFields): EventRoutineRun {
  return {
    id,
    routineId,
    triggerId,
    kind,
    ...(source === undefined ? {} : { source }),
    scheduledFor,
    routineName,
    instruction,
    status,
    error: error?.slice(0, ROUTINE_RECOVERY_RUN_ERROR_LIMIT) ?? null,
    ...(missed === undefined ? {} : { missed }),
    createdAt,
    updatedAt,
  };
}
