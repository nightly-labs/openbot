import type { EventRoutineOwner } from "@openbot/contracts/ipc-events";
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
}

function failed(operation: string) {
  return (failure: { readonly cause: unknown }) => new RoutineRecordFailed({ operation, cause: failure.cause });
}

/**
 * Owns the owner-neutral routine surface of the events API: agent and channel routines of every
 * trigger kind and the public webhook routes. Each method picks the agent or the channel scheduler
 * by owner. It never imports `AgentService`.
 */
export class RoutineRecords {
  /** The public routes of webhook triggers, their secrets, revocations and receipts. */
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

  /** Tells open editors to reload, for example after a background route sync stored a webhook URL. */
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

  /**
   * Starts a run for one verified webhook request. `unavailable` means the owner cannot take a run
   * now, so the sender should retry; nothing was written.
   */
  receiveWebhook(
    owner: EventRoutineOwner,
    routineId: string,
    event: ReceivedWebhookEvent,
  ): Effect.Effect<WebhookReceiveResult<unknown> | { kind: "unavailable" }, RoutineRecordFailed> {
    return owner.kind === "agent"
      ? this.#options.agentRoutines.receiveWebhook(owner.id, routineId, event).pipe(Effect.mapError(failed("receive")))
      : this.#options.channelRoutines
          .receiveWebhook(owner.id, routineId, event)
          .pipe(Effect.mapError(failed("receive")));
  }
}
