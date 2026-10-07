import { randomUUID } from "node:crypto";
import type {
  EventRoutine,
  EventRoutineOwner,
  EventSource,
  SaveEventRoutineInput,
  SaveEventSourceInput,
  SaveWebhookDestinationInput,
} from "@openbot/contracts/ipc-events";
import { isEventEnvelope } from "@openbot/contracts/ipc-events";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { WEBHOOK_DELIVERY_BODY_BYTES_LIMIT } from "@openbot/contracts/signal-protocol/messages";
import { WEBHOOK_ROUTES_LIMIT } from "@openbot/contracts/signal-protocol/webhook-route";
import { sourceText } from "@openbot/i18n/source";
import { registerSecretValue } from "@openbot/logging";
import { Effect, Semaphore } from "effect";
import { EventStore } from "../backend/event-store";
import type { OpenBotDatabase } from "../backend/openbot-database";
import { type HostEventsApi, HostEventsFailure } from "./host-events-api";
import type { SecretCipher } from "./provider-credential-store";
import { validateDestination } from "./webhook-delivery";
import { verifyWebhookSignature } from "./webhook-security";

export interface HostEventRoutines {
  list(owner: EventRoutineOwner): EventRoutine[];
  save(input: SaveEventRoutineInput): Effect.Effect<EventRoutine, { readonly cause: unknown }>;
  delete(input: { id: string; owner: EventRoutineOwner }): Effect.Effect<void, { readonly cause: unknown }>;
  test(input: { id: string; owner: EventRoutineOwner }): Effect.Effect<void, { readonly cause: unknown }>;
  dispatch(): Effect.Effect<void, { readonly cause: unknown }>;
}

export interface HostWebhookRelay {
  connected(): boolean;
  registerSource(sourceId: string): Effect.Effect<string, { readonly cause: unknown }>;
  revokeSource(sourceId: string): Effect.Effect<void, { readonly cause: unknown }>;
}

export interface HostWebhookReceipt {
  sourceId: string;
  deliveryId: string;
  timestamp: string;
  signature: string;
  body: Uint8Array;
}

export interface HostEventsServiceOptions {
  database: OpenBotDatabase;
  cipher: SecretCipher;
  routines: HostEventRoutines;
  relay: HostWebhookRelay;
  wake(): void;
}

function eventStep<A>(operation: () => A): Effect.Effect<A, HostEventsFailure> {
  return Effect.try({
    try: operation,
    catch: () => new HostEventsFailure({ cause: new Error(sourceText("error.backend.webhookSettingsInvalid")) }),
  });
}

function eventFailure(message: string): HostEventsFailure {
  return new HostEventsFailure({ cause: new Error(message) });
}

/** Owns host webhook configuration and authenticated receipt acceptance. It never returns secrets. */
export class HostEventsService implements HostEventsApi {
  readonly #store: EventStore;
  readonly #options: HostEventsServiceOptions;
  readonly #writes = Semaphore.makeUnsafe(1);

  constructor(options: HostEventsServiceOptions) {
    this.#options = options;
    this.#store = new EventStore(options.database);
  }

  readonly getStatus = Effect.fn("HostEvents.status")(function* (this: HostEventsService) {
    return yield* Effect.succeed({ supported: true, connected: this.#options.relay.connected() });
  }).bind(this);

  readonly listSources = Effect.fn("HostEvents.listSources")(function* (this: HostEventsService) {
    return yield* eventStep(() => this.#store.listSources());
  }).bind(this);

  readonly saveSource = Effect.fn("HostEvents.saveSource")(
    function* (this: HostEventsService, input: SaveEventSourceInput) {
      const sources = yield* eventStep(() => this.#store.listSources());
      const existing = input.id ? sources.find((source) => source.id === input.id) : undefined;
      if (input.id && !existing) return yield* eventFailure(sourceText("error.backend.eventSourceMissing"));
      if (
        input.active &&
        !existing?.active &&
        sources.filter((source) => source.active).length >= WEBHOOK_ROUTES_LIMIT
      ) {
        return yield* eventFailure(sourceText("error.backend.webhookSourceLimit", { limit: WEBHOOK_ROUTES_LIMIT }));
      }
      const secretCiphertext = yield* this.#encryptSecret(input.secret, !existing);
      const saved = yield* eventStep(() =>
        this.#store.saveSource({
          id: input.id ?? randomUUID(),
          name: input.name,
          active: input.active,
          ...(secretCiphertext === undefined ? {} : { secretCiphertext }),
        }),
      );
      this.#options.wake();
      if (!saved.active) {
        yield* this.#options.relay
          .revokeSource(saved.id)
          .pipe(Effect.mapError(() => eventFailure(sourceText("error.backend.webhookRouteUnavailable"))));
        return saved;
      }
      return yield* this.#register(saved);
    },
    (operation) => this.#writes.withPermit(operation),
  ).bind(this);

  readonly deleteSource = Effect.fn("HostEvents.deleteSource")(
    function* (this: HostEventsService, input: { id: string }) {
      const source = yield* eventStep(() => this.#store.listSources().find((item) => item.id === input.id));
      if (!source) return;
      // Refuse new receipts locally before the remote revoke, including when that request fails.
      yield* eventStep(() => this.#store.saveSource({ ...source, active: false }));
      this.#options.wake();
      yield* this.#options.relay
        .revokeSource(input.id)
        .pipe(Effect.mapError(() => eventFailure(sourceText("error.backend.webhookRouteUnavailable"))));
      yield* eventStep(() => this.#store.deleteSource(input.id));
    },
    (operation) => this.#writes.withPermit(operation),
  ).bind(this);

  readonly listDestinations = Effect.fn("HostEvents.listDestinations")(function* (this: HostEventsService) {
    return yield* eventStep(() => this.#store.listDestinations());
  }).bind(this);

  readonly saveDestination = Effect.fn("HostEvents.saveDestination")(
    function* (this: HostEventsService, input: SaveWebhookDestinationInput) {
      yield* eventStep(() =>
        validateDestination({
          url: input.url,
          method: input.method,
          headers: input.headers,
          ...(input.payloadTemplate === null ? {} : { template: input.payloadTemplate }),
        }),
      );
      const existing = input.id
        ? this.#store.listDestinations().find((destination) => destination.id === input.id)
        : undefined;
      if (input.id && !existing) return yield* eventFailure(sourceText("error.backend.webhookDestinationMissing"));
      const secretCiphertext = yield* this.#encryptSecret(input.secret, !existing);
      const headersCiphertext =
        input.headers === undefined
          ? undefined
          : yield* eventStep(() => {
              for (const value of Object.values(input.headers ?? {})) registerSecretValue(value);
              return this.#options.cipher.encrypt(JSON.stringify(input.headers)).toString("base64");
            });
      const saved = yield* eventStep(() =>
        this.#store.saveDestination({
          id: input.id,
          name: input.name,
          active: input.active,
          url: input.url,
          method: input.method,
          eventTypes: input.eventTypes,
          routineIds: input.routineIds,
          payloadTemplate: input.payloadTemplate,
          ...(secretCiphertext === undefined ? {} : { secretCiphertext }),
          ...(headersCiphertext === undefined
            ? {}
            : { headersCiphertext, headerNames: Object.keys(input.headers ?? {}) }),
        }),
      );
      this.#options.wake();
      return saved;
    },
    (operation) => this.#writes.withPermit(operation),
  ).bind(this);

  readonly deleteDestination = Effect.fn("HostEvents.deleteDestination")(
    function* (this: HostEventsService, input: { id: string }) {
      yield* eventStep(() => this.#store.deleteDestination(input.id));
      this.#options.wake();
    },
    (operation) => this.#writes.withPermit(operation),
  ).bind(this);

  readonly listActivity = Effect.fn("HostEvents.listActivity")(function* (
    this: HostEventsService,
    input: { limit?: number } = {},
  ) {
    return yield* eventStep(() => this.#store.listActivity(input.limit));
  }).bind(this);

  readonly retryDelivery = Effect.fn("HostEvents.retryDelivery")(function* (
    this: HostEventsService,
    input: { id: string },
  ) {
    yield* eventStep(() => this.#store.retryDelivery(input.id));
    this.#options.wake();
  }).bind(this);

  readonly listRoutines = Effect.fn("HostEvents.listRoutines")(function* (
    this: HostEventsService,
    input: { owner: EventRoutineOwner },
  ) {
    return yield* eventStep(() => this.#options.routines.list(input.owner));
  }).bind(this);

  readonly saveRoutine = Effect.fn("HostEvents.saveRoutine")(function* (
    this: HostEventsService,
    input: SaveEventRoutineInput,
  ) {
    return yield* this.#options.routines.save(input).pipe(Effect.mapError((failure) => new HostEventsFailure(failure)));
  }).bind(this);

  readonly deleteRoutine = Effect.fn("HostEvents.deleteRoutine")(function* (
    this: HostEventsService,
    input: { id: string; owner: EventRoutineOwner },
  ) {
    yield* this.#options.routines.delete(input).pipe(Effect.mapError((failure) => new HostEventsFailure(failure)));
  }).bind(this);

  readonly testRoutine = Effect.fn("HostEvents.testRoutine")(function* (
    this: HostEventsService,
    input: { id: string; owner: EventRoutineOwner },
  ) {
    yield* this.#options.routines.test(input).pipe(Effect.mapError((failure) => new HostEventsFailure(failure)));
    this.#options.wake();
  }).bind(this);

  readonly receive = Effect.fn("HostEvents.receive")(
    function* (
      this: HostEventsService,
      input: HostWebhookReceipt,
    ): Effect.fn.Return<{ status: 202 | 400 | 401 | 404 | 413 }, HostEventsFailure> {
      if (input.body.byteLength > WEBHOOK_DELIVERY_BODY_BYTES_LIMIT) return { status: 413 };
      const source = yield* eventStep(() => this.#store.listSources().find((item) => item.id === input.sourceId));
      if (!source?.active) return { status: 404 };
      const authenticated = yield* Effect.result(
        eventStep(() => {
          const encrypted = this.#store.getSourceSecretCiphertext(input.sourceId);
          if (!encrypted) throw new Error("Missing webhook secret.");
          const secret = this.#options.cipher.decrypt(Buffer.from(encrypted, "base64"));
          registerSecretValue(secret);
          verifyWebhookSignature(
            secret,
            { ...input, maxBodyBytes: WEBHOOK_DELIVERY_BODY_BYTES_LIMIT },
            input.signature,
          );
        }),
      );
      if (authenticated._tag === "Failure") return { status: 401 };
      const decoded = yield* Effect.result(
        eventStep(() => {
          const body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(input.body));
          if (!isDynamicRecord(body) || !isString(body.type) || body.type.length < 1 || body.type.length > 256) {
            throw new Error("Invalid event body.");
          }
          const now = new Date().toISOString();
          const envelope = {
            version: 1,
            id: randomUUID(),
            sourceId: source.id,
            type: body.type,
            occurredAt: body.occurredAt ?? now,
            receivedAt: now,
            data: body.data,
          };
          if (!isEventEnvelope(envelope)) throw new Error("Invalid event body.");
          return envelope;
        }),
      );
      if (decoded._tag === "Failure") return { status: 400 };
      const receipt = yield* eventStep(() =>
        this.#store.receive({ deliveryId: input.deliveryId, envelope: decoded.success }),
      );
      if (!receipt.accepted) return { status: 404 };
      this.#options.wake();
      return { status: 202 };
    },
    (operation) => this.#writes.withPermit(operation),
  ).bind(this);

  readonly syncRoutes = Effect.fn("HostEvents.syncRoutes")(
    function* (this: HostEventsService) {
      const sources = yield* this.listSources();
      for (const source of sources) {
        if (source.active) yield* this.#register(source);
        else
          yield* this.#options.relay
            .revokeSource(source.id)
            .pipe(Effect.mapError(() => eventFailure(sourceText("error.backend.webhookRouteUnavailable"))));
      }
    },
    (operation) => this.#writes.withPermit(operation),
  ).bind(this);

  readonly dispatch = Effect.fn("HostEvents.dispatch")(function* (this: HostEventsService) {
    yield* this.#options.routines.dispatch().pipe(Effect.mapError((failure) => new HostEventsFailure(failure)));
  }).bind(this);

  readonly #register = Effect.fn("HostEvents.register")(function* (this: HostEventsService, source: EventSource) {
    const url = yield* this.#options.relay
      .registerSource(source.id)
      .pipe(Effect.mapError(() => eventFailure(sourceText("error.backend.webhookRouteUnavailable"))));
    return yield* eventStep(() => this.#store.saveSource({ ...source, url }));
  });

  readonly #encryptSecret = Effect.fn("HostEvents.encryptSecret")(function* (
    this: HostEventsService,
    secret: string | undefined,
    required: boolean,
  ) {
    if (secret === undefined && !required) return undefined;
    if (secret === undefined || secret.length < 32 || Buffer.byteLength(secret) > 1024) {
      return yield* eventFailure(sourceText("error.backend.webhookSecretRequired"));
    }
    return yield* eventStep(() => {
      registerSecretValue(secret);
      return this.#options.cipher.encrypt(secret).toString("base64");
    });
  });
}
