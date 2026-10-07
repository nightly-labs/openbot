import { randomBytes } from "node:crypto";
import type {
  EventActivity,
  EventJsonValue,
  EventRoutine,
  EventRoutineOwner,
  EventRoutineRef,
  ListEventActivityInput,
  ListEventRoutinesInput,
  ListWebhookDestinationsInput,
  SaveEventRoutineInput,
  SaveWebhookDestinationInput,
  WebhookDeliveryRef,
  WebhookDestinationRef,
} from "@openbot/contracts/ipc-events";
import { isEventJsonValue } from "@openbot/contracts/ipc-events";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { WEBHOOK_DELIVERY_BODY_BYTES_LIMIT } from "@openbot/contracts/signal-protocol/messages";
import { WEBHOOK_ROUTES_LIMIT } from "@openbot/contracts/signal-protocol/webhook-route";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, registerSecretValue } from "@openbot/logging";
import { Effect, Semaphore } from "effect";
import type { RoutineRecords } from "../backend/routine-records";
import type { OwnedRoutineRecord, RoutineRecordInput } from "../backend/routine-store";
import { WEBHOOK_EVENT_TYPE_MAX_LENGTH } from "../backend/webhook-trigger";
import { type HostEventsApi, HostEventsFailure } from "./host-events-api";
import type { SecretCipher } from "./provider-credential-store";
import { validateDestination } from "./webhook-delivery";
import { verifyWebhookSignature } from "./webhook-security";

const logger = createOpenBotLogger("host-events");
const DEFAULT_ACTIVITY_LIMIT = 50;

export interface HostWebhookRelay {
  connected(): boolean;
  /** Holds the inbound relay connection open while at least one route exists. */
  setEnabled(enabled: boolean): void;
  /** Applies route changes to the open relay connection. */
  refresh(): void;
  registerRoute(routeId: string): Effect.Effect<string, { readonly cause: unknown }>;
  revokeRoute(routeId: string): Effect.Effect<void, { readonly cause: unknown }>;
}

export interface HostWebhookReceipt {
  routeId: string;
  deliveryId: string;
  timestamp: string;
  signature: string;
  body: Uint8Array;
}

/** The relay status codes that a receipt can produce. A thrown failure becomes 503. */
export type HostWebhookReceiptStatus = 200 | 202 | 400 | 401 | 404 | 413 | 503;

export interface HostEventsServiceOptions {
  routines: RoutineRecords;
  cipher: SecretCipher;
  relay: HostWebhookRelay;
  /** Starts the outbound delivery worker. */
  wake(): void;
}

function eventStep<A>(operation: () => A): Effect.Effect<A, HostEventsFailure> {
  return Effect.try({ try: operation, catch: (cause) => new HostEventsFailure({ cause }) });
}

function eventFailure(message: string): HostEventsFailure {
  return new HostEventsFailure({ cause: new Error(message) });
}

function eventRoutine(owner: EventRoutineOwner, record: OwnedRoutineRecord): EventRoutine {
  const { ownerId: _ownerId, trigger, ...fields } = record;
  return {
    ...fields,
    owner,
    trigger:
      trigger.kind === "schedule"
        ? { kind: "schedule", schedule: trigger.schedule }
        : { kind: "webhook", url: trigger.url, eventType: trigger.eventType, filters: trigger.filters },
  };
}

/** A random signing secret. The prefix makes a leaked value easy to recognize and to scan for. */
function newWebhookSecret(): string {
  return `whsec_${randomBytes(32).toString("base64url")}`;
}

interface DecodedWebhookBody {
  type: string;
  occurredAt: string | null;
  data: EventJsonValue;
}

function decodeWebhookBody(body: Uint8Array): DecodedWebhookBody | null {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch {
    return null;
  }
  if (!isDynamicRecord(value) || !isString(value.type)) return null;
  if (value.type.length < 1 || value.type.length > WEBHOOK_EVENT_TYPE_MAX_LENGTH) return null;
  if (value.occurredAt !== undefined && (!isString(value.occurredAt) || Number.isNaN(Date.parse(value.occurredAt))))
    return null;
  const data = value.data ?? null;
  if (!isEventJsonValue(data)) return null;
  return { type: value.type, occurredAt: value.occurredAt ?? null, data };
}

/**
 * Owns webhook routines on this host: the trigger settings, the host-made signing secret, the relay
 * routes, outbound destinations and authenticated receipts. A secret leaves the host only once, in
 * the result of the save or rotation that made it.
 */
export class HostEventsService implements HostEventsApi {
  readonly #options: HostEventsServiceOptions;
  readonly #routines: RoutineRecords;
  /** Serializes routine writes, so the route limit check and the write are one step. */
  readonly #writes = Semaphore.makeUnsafe(1);
  /** Serializes relay calls, so a revoke and a register of one route cannot cross. */
  readonly #sync = Semaphore.makeUnsafe(1);

  constructor(options: HostEventsServiceOptions) {
    this.#options = options;
    this.#routines = options.routines;
  }

  readonly getStatus = Effect.fn("HostEvents.status")(function* (this: HostEventsService) {
    return yield* Effect.succeed({ supported: true, connected: this.#options.relay.connected() });
  }).bind(this);

  readonly listRoutines = Effect.fn("HostEvents.listRoutines")(function* (
    this: HostEventsService,
    input: ListEventRoutinesInput,
  ) {
    yield* this.#requireOwner(input.owner);
    return yield* eventStep(() => this.#routines.list(input.owner).map((record) => eventRoutine(input.owner, record)));
  }).bind(this);

  readonly saveRoutine = Effect.fn("HostEvents.saveRoutine")(
    function* (this: HostEventsService, input: SaveEventRoutineInput) {
      const { owner, trigger } = input;
      yield* this.#requireOwner(owner);
      const existing = input.id ? yield* this.#requireRoutine({ owner, id: input.id }) : null;
      let secret: string | null = null;
      let recordTrigger: RoutineRecordInput["trigger"];
      if (trigger.kind === "schedule") {
        recordTrigger = { kind: "schedule", schedule: trigger.schedule };
      } else {
        let secretCiphertext: string | null = null;
        if (existing?.trigger.kind !== "webhook") {
          if ((yield* eventStep(() => this.#routines.routes.list())).length >= WEBHOOK_ROUTES_LIMIT) {
            return yield* eventFailure(sourceText("error.backend.webhookRouteLimit", { limit: WEBHOOK_ROUTES_LIMIT }));
          }
          secret = newWebhookSecret();
          secretCiphertext = yield* this.#encrypt(secret);
        }
        recordTrigger = { kind: "webhook", eventType: trigger.eventType, filters: trigger.filters, secretCiphertext };
      }
      const saved = yield* eventStep(() =>
        this.#routines.save(owner, input.id, {
          name: input.name,
          instruction: input.instruction,
          active: input.active,
          timezone: input.timezone,
          trigger: recordTrigger,
          ...(input.limitPolicy === undefined ? {} : { limitPolicy: input.limitPolicy }),
        }),
      );
      yield* this.syncRoutes({ all: false });
      // The sync can add the URL. A save that the relay did not confirm keeps a null URL.
      const current = yield* eventStep(() => this.#routines.get(owner, saved.id) ?? saved);
      return { routine: eventRoutine(owner, current), secret };
    },
    (operation) => this.#writes.withPermit(operation),
  ).bind(this);

  readonly deleteRoutine = Effect.fn("HostEvents.deleteRoutine")(
    function* (this: HostEventsService, input: EventRoutineRef) {
      yield* this.#routines
        .delete(input.owner, input.id)
        .pipe(Effect.mapError((failure) => new HostEventsFailure({ cause: failure.cause })));
      yield* this.syncRoutes({ all: false });
    },
    (operation) => this.#writes.withPermit(operation),
  ).bind(this);

  readonly testRoutine = Effect.fn("HostEvents.testRoutine")(function* (
    this: HostEventsService,
    input: EventRoutineRef,
  ) {
    yield* this.#routines
      .test(input.owner, input.id)
      .pipe(Effect.mapError((failure) => new HostEventsFailure({ cause: failure.cause })));
    this.#options.wake();
  }).bind(this);

  readonly rotateSecret = Effect.fn("HostEvents.rotateSecret")(
    function* (this: HostEventsService, input: EventRoutineRef) {
      const routine = yield* this.#requireRoutine(input);
      if (routine.trigger.kind !== "webhook")
        return yield* eventFailure(sourceText("error.backend.webhookSettingsInvalid"));
      const secret = newWebhookSecret();
      const secretCiphertext = yield* this.#encrypt(secret);
      yield* eventStep(() => this.#routines.routes.rotateSecret(input.owner, input.id, secretCiphertext));
      return { secret };
    },
    (operation) => this.#writes.withPermit(operation),
  ).bind(this);

  readonly listDestinations = Effect.fn("HostEvents.listDestinations")(function* (
    this: HostEventsService,
    input: ListWebhookDestinationsInput,
  ) {
    return yield* eventStep(() => this.#routines.destinations.list(input.owner, input.routineId));
  }).bind(this);

  readonly saveDestination = Effect.fn("HostEvents.saveDestination")(function* (
    this: HostEventsService,
    input: SaveWebhookDestinationInput,
  ) {
    // Destination rows have no foreign key to the two routine tables, so the routine is checked here.
    yield* this.#requireRoutine({ owner: input.owner, id: input.routineId });
    yield* eventStep(() =>
      validateDestination({
        url: input.url,
        method: input.method,
        headers: input.headers,
        ...(input.payloadTemplate === null ? {} : { template: input.payloadTemplate }),
      }),
    ).pipe(Effect.mapError(() => eventFailure(sourceText("error.backend.webhookSettingsInvalid"))));
    const secretCiphertext =
      input.secret === undefined
        ? undefined
        : input.secret === ""
          ? null
          : yield* this.#encryptDestinationSecret(input.secret);
    const headers = input.headers;
    const headersCiphertext =
      headers === undefined
        ? undefined
        : Object.keys(headers).length === 0
          ? null
          : yield* eventStep(() => {
              for (const value of Object.values(headers)) registerSecretValue(value);
              return this.#options.cipher.encrypt(JSON.stringify(headers)).toString("base64");
            });
    const saved = yield* eventStep(() =>
      this.#routines.destinations.save(input.owner, {
        ...(input.id === undefined ? {} : { id: input.id }),
        routineId: input.routineId,
        active: input.active,
        url: input.url,
        method: input.method,
        eventTypes: input.eventTypes,
        payloadTemplate: input.payloadTemplate,
        ...(secretCiphertext === undefined ? {} : { secretCiphertext }),
        ...(headers === undefined ? {} : { headersCiphertext, headerNames: Object.keys(headers) }),
      }),
    );
    this.#options.wake();
    return saved;
  }).bind(this);

  readonly deleteDestination = Effect.fn("HostEvents.deleteDestination")(function* (
    this: HostEventsService,
    input: WebhookDestinationRef,
  ) {
    yield* eventStep(() => this.#routines.destinations.delete(input.owner, input.routineId, input.id));
    this.#options.wake();
  }).bind(this);

  readonly listActivity = Effect.fn("HostEvents.listActivity")(function* (
    this: HostEventsService,
    input: ListEventActivityInput,
  ) {
    yield* this.#requireRoutine({ owner: input.owner, id: input.routineId });
    const limit = input.limit ?? DEFAULT_ACTIVITY_LIMIT;
    return yield* eventStep((): EventActivity[] =>
      [
        ...this.#routines.routes.listReceipts(input.owner.kind, input.routineId, limit),
        ...this.#routines.destinations.listActivity(input.owner, input.routineId, limit),
      ]
        .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt) || left.id.localeCompare(right.id))
        .slice(0, limit),
    );
  }).bind(this);

  readonly retryDelivery = Effect.fn("HostEvents.retryDelivery")(function* (
    this: HostEventsService,
    input: WebhookDeliveryRef,
  ) {
    yield* eventStep(() => this.#routines.destinations.retry(input.owner, input.routineId, input.id));
    this.#options.wake();
  }).bind(this);

  /** Verifies one relayed request and starts its routine. The status goes back to the sender. */
  readonly receive = Effect.fn("HostEvents.receive")(function* (
    this: HostEventsService,
    input: HostWebhookReceipt,
  ): Effect.fn.Return<{ status: HostWebhookReceiptStatus }, HostEventsFailure> {
    if (input.body.byteLength > WEBHOOK_DELIVERY_BODY_BYTES_LIMIT) return { status: 413 };
    const route = yield* eventStep(() => this.#routines.routes.find(input.routeId));
    if (!route) return { status: 404 };
    const authenticated = yield* Effect.result(
      eventStep(() => {
        const secret = this.#options.cipher.decrypt(Buffer.from(route.secretCiphertext, "base64"));
        registerSecretValue(secret);
        verifyWebhookSignature(secret, input, input.signature);
      }),
    );
    if (authenticated._tag === "Failure") return { status: 401 };
    const body = decodeWebhookBody(input.body);
    if (!body) return { status: 400 };
    const receivedAt = new Date().toISOString();
    const result = yield* this.#routines
      .receiveWebhook(route.owner, route.routineId, {
        deliveryId: input.deliveryId,
        eventType: body.type,
        data: body.data,
        occurredAt: body.occurredAt ?? receivedAt,
        receivedAt,
      })
      .pipe(Effect.mapError((failure) => new HostEventsFailure({ cause: failure.cause })));
    switch (result.kind) {
      case "started":
        this.#options.wake();
        return { status: 202 };
      case "ignored":
        return { status: 202 };
      case "duplicate":
        return { status: 200 };
      case "gone":
        return { status: 404 };
      case "unavailable":
        return { status: 503 };
    }
  }).bind(this);

  /**
   * Makes the relay match the local routes. It first sends the revocations that routine writes
   * queued, then registers each route without a URL, or every route when `all` is set (after an
   * account change). A failed call keeps its local state for the next sync and never fails a save.
   */
  readonly syncRoutes = Effect.fn("HostEvents.syncRoutes")(
    function* (this: HostEventsService, options: { all: boolean }) {
      const { relay } = this.#options;
      const routes = this.#routines.routes;
      let failed = false;
      let changed = false;
      for (const routeId of yield* eventStep(() => routes.pendingRevocations())) {
        const revoked = yield* Effect.result(relay.revokeRoute(routeId));
        if (revoked._tag === "Failure") failed = true;
        else {
          changed = true;
          yield* eventStep(() => routes.clearRevocation(routeId));
        }
      }
      const current = yield* eventStep(() => routes.list());
      const updatedOwners = new Map<string, EventRoutineOwner>();
      for (const route of current) {
        if (!options.all && route.url !== null) continue;
        const registered = yield* Effect.result(relay.registerRoute(route.routeId));
        if (registered._tag === "Failure") failed = true;
        else {
          changed = true;
          if (registered.success === route.url) continue;
          yield* eventStep(() => routes.setUrl(route.routeId, registered.success));
          updatedOwners.set(`${route.owner.kind}:${route.owner.id}`, route.owner);
        }
      }
      relay.setEnabled(current.length > 0);
      if (changed && current.length > 0) relay.refresh();
      // An open editor shows "URL pending" until it reloads the routine.
      for (const owner of updatedOwners.values()) this.#routines.changed(owner);
      if (failed) logger.warn("Some webhook routes are not ready. Local settings were retained.");
    },
    (operation) =>
      this.#sync
        .withPermit(operation)
        .pipe(
          Effect.catch(() =>
            Effect.sync(() => logger.warn("Webhook routes could not be read. Local settings were retained.")),
          ),
        ),
  ).bind(this);

  readonly #requireOwner = Effect.fn("HostEvents.requireOwner")(function* (
    this: HostEventsService,
    owner: EventRoutineOwner,
  ) {
    if (yield* eventStep(() => this.#routines.ownerExists(owner))) return;
    return yield* eventFailure(
      sourceText(owner.kind === "agent" ? "error.storage.agentMissing" : "error.backend.channelNotFound"),
    );
  });

  readonly #requireRoutine = Effect.fn("HostEvents.requireRoutine")(function* (
    this: HostEventsService,
    ref: EventRoutineRef,
  ) {
    const routine = yield* eventStep(() => this.#routines.get(ref.owner, ref.id));
    if (routine) return routine;
    return yield* eventFailure(sourceText("error.backend.routineGone"));
  });

  readonly #encrypt = Effect.fn("HostEvents.encrypt")(function* (this: HostEventsService, secret: string) {
    return yield* eventStep(() => {
      registerSecretValue(secret);
      return this.#options.cipher.encrypt(secret).toString("base64");
    });
  });

  readonly #encryptDestinationSecret = Effect.fn("HostEvents.encryptDestinationSecret")(function* (
    this: HostEventsService,
    secret: string,
  ) {
    if (secret.length < 32 || Buffer.byteLength(secret) > 1024) {
      return yield* eventFailure(sourceText("error.backend.webhookSecretRequired"));
    }
    return yield* this.#encrypt(secret);
  });
}
