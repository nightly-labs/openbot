import { randomBytes } from "node:crypto";
import type {
  EventJsonValue,
  EventRoutine,
  EventRoutineOwner,
  EventRoutineRef,
  ListEventActivityInput,
  ListEventRoutinesInput,
  SaveEventRoutineInput,
} from "@openbot/contracts/ipc-events";
import { isEventJsonValue } from "@openbot/contracts/ipc-events";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import {
  WEBHOOK_DELIVERY_BODY_BYTES_LIMIT,
  type WebhookDeliveryStatus,
} from "@openbot/contracts/signal-protocol/messages";
import { WEBHOOK_ROUTES_LIMIT } from "@openbot/contracts/signal-protocol/webhook-route";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, registerSecretValue } from "@openbot/logging";
import { Effect, Semaphore } from "effect";
import { causeHelpers } from "../backend/effect-boundary";
import type { RoutineRecords } from "../backend/routine-records";
import type { OwnedRoutineRecord, RoutineRecordInput } from "../backend/routine-store";
import { WEBHOOK_EVENT_TYPE_MAX_LENGTH } from "../backend/webhook-trigger";
import { type HostEventsApi, HostEventsFailure, WebhookRouteConflict } from "./host-events-api";
import type { SecretCipher } from "./provider-credential-store";
import type { WebhookIngressDelivery } from "./signal-ingress";
import { verifyWebhookSignature } from "./webhook-security";

const logger = createOpenBotLogger("host-events");
const DEFAULT_ACTIVITY_LIMIT = 50;

export interface HostWebhookRelay {
  connected(): boolean;
  /** Holds the inbound relay connection open while at least one route exists. */
  setEnabled(enabled: boolean): void;
  /** Pauses or refreshes the relay when the signed-in account changes. */
  setAccountActive(active: boolean): void;
  /** Applies route changes to the open relay connection. */
  refresh(): void;
  registerRoute(routeId: string): Effect.Effect<string, { readonly cause: unknown } | WebhookRouteConflict>;
  revokeRoute(routeId: string): Effect.Effect<void, { readonly cause: unknown }>;
}

export interface HostEventsServiceOptions {
  routines: RoutineRecords;
  cipher: SecretCipher;
  relay: HostWebhookRelay;
  accountPrincipal: () => string | null;
}

const { sync: eventStep, rewrap: toHostEventsFailure } = causeHelpers(HostEventsFailure);

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
 * routes and authenticated receipts. A secret leaves the host only once, in
 * the result of the save or rotation that made it.
 */
export class HostEventsService implements HostEventsApi {
  readonly #options: HostEventsServiceOptions;
  #accountPrincipal: string | null;
  #accountGeneration = 0;
  /** Serializes routine writes, so the route limit check and the write are one step. */
  readonly #writes = Semaphore.makeUnsafe(1);
  /** Serializes relay calls, so a revoke and a register of one route cannot cross. */
  readonly #sync = Semaphore.makeUnsafe(1);

  constructor(options: HostEventsServiceOptions) {
    this.#options = options;
    this.#accountPrincipal = options.accountPrincipal();
  }

  getStatus() {
    return Effect.sync(() => ({ supported: true, connected: this.#options.relay.connected() }));
  }

  readonly listRoutines = Effect.fn("HostEvents.listRoutines")(function* (
    this: HostEventsService,
    input: ListEventRoutinesInput,
  ) {
    yield* this.#requireOwner(input.owner);
    return yield* eventStep(() =>
      this.#options.routines.list(input.owner).map((record) => eventRoutine(input.owner, record)),
    );
  }).bind(this);

  readonly saveRoutine = Effect.fn("HostEvents.saveRoutine")(function* (
    this: HostEventsService,
    input: SaveEventRoutineInput,
  ) {
    const { saved, secret } = yield* this.#saveRecord(input);
    // The relay sync runs after the write lock is released, so a slow relay does not block writes.
    yield* this.syncRoutes({ all: false });
    // The sync can add the URL. A save that the relay did not confirm keeps a null URL.
    const current = yield* eventStep(() => this.#options.routines.get(input.owner, saved.id) ?? saved);
    return { routine: eventRoutine(input.owner, current), secret };
  }).bind(this);

  /** Deletes the routine. The routine change event starts the sync that revokes its route. */
  readonly deleteRoutine = Effect.fn("HostEvents.deleteRoutine")(
    function* (this: HostEventsService, input: EventRoutineRef) {
      yield* toHostEventsFailure(this.#options.routines.delete(input.owner, input.id));
    },
    (operation) => this.#writes.withPermit(operation),
  ).bind(this);

  readonly testRoutine = Effect.fn("HostEvents.testRoutine")(function* (
    this: HostEventsService,
    input: EventRoutineRef,
  ) {
    yield* toHostEventsFailure(this.#options.routines.test(input.owner, input.id));
  }).bind(this);

  readonly rotateSecret = Effect.fn("HostEvents.rotateSecret")(
    function* (this: HostEventsService, input: EventRoutineRef) {
      const routine = yield* this.#requireRoutine(input);
      if (routine.trigger.kind !== "webhook")
        return yield* eventFailure(sourceText("error.backend.webhookSettingsInvalid"));
      const secret = newWebhookSecret();
      const secretCiphertext = yield* this.#encrypt(secret);
      yield* eventStep(() => this.#options.routines.routes.rotateSecret(input.owner, input.id, secretCiphertext));
      return { secret };
    },
    (operation) => this.#writes.withPermit(operation),
  ).bind(this);

  readonly listActivity = Effect.fn("HostEvents.listActivity")(function* (
    this: HostEventsService,
    input: ListEventActivityInput,
  ) {
    yield* this.#requireRoutine({ owner: input.owner, id: input.routineId });
    const limit = input.limit ?? DEFAULT_ACTIVITY_LIMIT;
    return yield* eventStep(() => this.#options.routines.routes.listReceipts(input.owner.kind, input.routineId, limit));
  }).bind(this);

  /** Verifies one relayed request and starts its routine. The status goes back to the sender. */
  readonly receive = Effect.fn("HostEvents.receive")(function* (
    this: HostEventsService,
    input: WebhookIngressDelivery,
  ): Effect.fn.Return<{ status: WebhookDeliveryStatus }, HostEventsFailure> {
    if (this.#options.accountPrincipal() === null) return { status: 503 };
    if (input.body.byteLength > WEBHOOK_DELIVERY_BODY_BYTES_LIMIT) return { status: 413 };
    const route = yield* eventStep(() => this.#options.routines.routes.find(input.routeId));
    if (!route) return { status: 404 };
    const secret = yield* Effect.result(
      eventStep(() => {
        const value = this.#options.cipher.decrypt(Buffer.from(route.secretCiphertext, "base64"));
        registerSecretValue(value);
        return value;
      }),
    );
    // The sender's request is not at fault, so it can retry when the host can read the secret again.
    if (secret._tag === "Failure") {
      logger.warn("A webhook signing secret could not be decrypted.");
      return { status: 503 };
    }
    const authenticated = yield* Effect.result(
      eventStep(() => verifyWebhookSignature(secret.success, input, input.signature)),
    );
    if (authenticated._tag === "Failure") return { status: 401 };
    const body = decodeWebhookBody(input.body);
    if (!body) return { status: 400 };
    const receivedAt = new Date().toISOString();
    const result = yield* toHostEventsFailure(
      this.#options.routines.receiveWebhook(route.owner, route.routineId, {
        deliveryId: input.deliveryId,
        eventType: body.type,
        data: body.data,
        occurredAt: body.occurredAt ?? receivedAt,
        receivedAt,
      }),
    );
    switch (result.kind) {
      case "started":
      case "ignored":
        return { status: 202 };
      case "duplicate":
        return { status: 200 };
      case "gone":
        return { status: 404 };
      case "too-large":
        return { status: 413 };
      case "unavailable":
        return { status: 503 };
    }
  }).bind(this);

  /**
   * Makes the relay match the local routes. It first sends the revocations that routine writes
   * queued, then registers each route without a URL, or every route when `all` is set (after an
   * account change). A failed call keeps its local state for the next sync and never fails a save.
   * The result is `true` when no route work remains.
   */
  readonly syncRoutes = Effect.fn("HostEvents.syncRoutes")(
    function* (this: HostEventsService, options: { all: boolean }) {
      const { relay } = this.#options;
      const syncPrincipal = this.#accountPrincipal;
      const syncGeneration = this.#accountGeneration;
      const isCurrent = () =>
        syncGeneration === this.#accountGeneration &&
        syncPrincipal === this.#accountPrincipal &&
        syncPrincipal === this.#options.accountPrincipal();
      if (!isCurrent()) return true;
      if (this.#options.accountPrincipal() === null) {
        relay.setEnabled(false);
        return true;
      }
      const routes = this.#options.routines.routes;
      let failed = false;
      let changed = false;
      for (const routeId of yield* eventStep(() => routes.pendingRevocations())) {
        if (!isCurrent()) return true;
        if (this.#options.accountPrincipal() === null) {
          relay.setEnabled(false);
          return true;
        }
        const revoked = yield* Effect.result(relay.revokeRoute(routeId));
        if (!isCurrent()) return true;
        if (revoked._tag === "Failure") failed = true;
        else {
          changed = true;
          yield* eventStep(() => routes.clearRevocation(routeId));
        }
      }
      const current = yield* eventStep(() => routes.list());
      const updatedOwners = new Map<string, EventRoutineOwner>();
      for (const route of current) {
        if (!isCurrent()) return true;
        if (this.#options.accountPrincipal() === null) {
          relay.setEnabled(false);
          return true;
        }
        if (!options.all && route.url !== null) continue;
        const ownerKey = `${route.owner.kind}:${route.owner.id}`;
        let { routeId, url } = route;
        let registered = yield* Effect.result(relay.registerRoute(routeId));
        if (!isCurrent()) return true;
        if (registered._tag === "Failure" && registered.failure instanceof WebhookRouteConflict) {
          // The relay keeps a refused route ID for good. A new ID gets a new URL, and the secret stays.
          const replacement = yield* eventStep(() => routes.replaceRouteId(route.routeId));
          if (replacement === null) continue;
          routeId = replacement;
          url = null;
          updatedOwners.set(ownerKey, route.owner);
          registered = yield* Effect.result(relay.registerRoute(routeId));
          if (!isCurrent()) return true;
        }
        if (registered._tag === "Failure") failed = true;
        else if (registered.success !== url) {
          changed = true;
          const registeredUrl = registered.success;
          yield* eventStep(() => routes.setUrl(routeId, registeredUrl));
          updatedOwners.set(ownerKey, route.owner);
        }
      }
      if (!isCurrent()) return true;
      if (this.#options.accountPrincipal() === null) {
        relay.setEnabled(false);
        return true;
      }
      const enabled = current.length > 0;
      // `refresh` reconnects only a held socket. `setEnabled(true)` opens a new one with the current routes.
      if (changed && enabled) relay.refresh();
      relay.setEnabled(enabled);
      // An open editor shows "URL pending" until it reloads the routine.
      for (const owner of updatedOwners.values()) this.#options.routines.changed(owner);
      if (failed) logger.warn("Some webhook routes are not ready. Local settings were retained.");
      return !failed;
    },
    (operation) =>
      this.#sync.withPermit(operation).pipe(
        Effect.catch(() =>
          Effect.sync(() => {
            logger.warn("Webhook routes could not be read. Local settings were retained.");
            return false;
          }),
        ),
      ),
  ).bind(this);

  /** Closes stale route claims and leaves local route rows ready for the next account sync. */
  setAccountPrincipal(principalId: string | null): void {
    if (principalId === this.#accountPrincipal) return;
    this.#accountPrincipal = principalId;
    this.#accountGeneration += 1;
    this.#options.relay.setAccountActive(principalId !== null);
  }

  /** Writes the routine under the write lock, so the route limit check and the write are one step. */
  readonly #saveRecord = Effect.fn("HostEvents.saveRecord")(
    function* (this: HostEventsService, input: SaveEventRoutineInput) {
      const { owner, trigger } = input;
      const routines = this.#options.routines;
      yield* this.#requireOwner(owner);
      const existing = input.id ? yield* this.#requireRoutine({ owner, id: input.id }) : null;
      let secret: string | null = null;
      let recordTrigger: RoutineRecordInput["trigger"];
      if (trigger.kind === "schedule") {
        recordTrigger = { kind: "schedule", schedule: trigger.schedule };
      } else {
        let secretCiphertext: string | null = null;
        if (existing?.trigger.kind !== "webhook") {
          if ((yield* eventStep(() => routines.routes.list())).length >= WEBHOOK_ROUTES_LIMIT) {
            return yield* eventFailure(sourceText("error.backend.webhookRouteLimit", { limit: WEBHOOK_ROUTES_LIMIT }));
          }
          secret = newWebhookSecret();
          secretCiphertext = yield* this.#encrypt(secret);
        }
        recordTrigger = { kind: "webhook", eventType: trigger.eventType, filters: trigger.filters, secretCiphertext };
      }
      const saved = yield* eventStep(() =>
        routines.save(owner, input.id, {
          name: input.name,
          instruction: input.instruction,
          active: input.active,
          timezone: input.timezone,
          trigger: recordTrigger,
          ...(input.limitPolicy === undefined ? {} : { limitPolicy: input.limitPolicy }),
        }),
      );
      return { saved, secret };
    },
    (operation) => this.#writes.withPermit(operation),
  );

  readonly #requireOwner = Effect.fn("HostEvents.requireOwner")(function* (
    this: HostEventsService,
    owner: EventRoutineOwner,
  ) {
    if (yield* eventStep(() => this.#options.routines.ownerExists(owner))) return;
    return yield* eventFailure(
      sourceText(owner.kind === "agent" ? "error.storage.agentMissing" : "error.backend.channelNotFound"),
    );
  });

  readonly #requireRoutine = Effect.fn("HostEvents.requireRoutine")(function* (
    this: HostEventsService,
    ref: EventRoutineRef,
  ) {
    const routine = yield* eventStep(() => this.#options.routines.get(ref.owner, ref.id));
    if (routine) return routine;
    return yield* eventFailure(sourceText("error.backend.routineGone"));
  });

  readonly #encrypt = Effect.fn("HostEvents.encrypt")(function* (this: HostEventsService, secret: string) {
    return yield* eventStep(() => {
      registerSecretValue(secret);
      return this.#options.cipher.encrypt(secret).toString("base64");
    });
  });
}
