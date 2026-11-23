import { randomBytes, randomUUID } from "node:crypto";
import type { WorkflowTriggerInput, WorkflowWebhookSecret } from "@openbot/contracts/ipc";
import type {
  AgentWebhookSecret,
  EventFilter,
  EventJsonValue,
  EventRoutine,
  EventRoutineOwner,
  EventRoutineRef,
  EventScalar,
  ListEventActivityInput,
  ListEventRoutineRunsInput,
  ListEventRoutinesInput,
  SaveEventRoutineInput,
  SetWebhookSecretInput,
  WebhookTestResult,
} from "@openbot/contracts/ipc-events";
import { isEventJsonValue } from "@openbot/contracts/ipc-events";
import { type DynamicRecord, isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import {
  WEBHOOK_DELIVERY_BODY_BYTES_LIMIT,
  type WebhookDeliveryStatus,
} from "@openbot/contracts/signal-protocol/messages";
import { STANDARD_WEBHOOKS_FORMAT, WEBHOOK_ROUTES_LIMIT } from "@openbot/contracts/signal-protocol/webhook-route";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, registerSecretValue } from "@openbot/logging";
import { RoutineInputError } from "@openbot/team-client/routine-schedule";
import { Effect, Semaphore } from "effect";
import { RoutineOperationFailed } from "../backend/agent/routine-scheduler";
import {
  removeWebhookSecretKey,
  type WebhookRoutineWriter,
  webhookSecretKeyName,
} from "../backend/agent/webhook-routine-tool";
import type { AgentApiKeys } from "../backend/agent-api-keys";
import { causeHelpers } from "../backend/effect-boundary";
import type { RoutineRecords } from "../backend/routine-records";
import type { OwnedRoutineRecord, RoutineRecordInput, WebhookReceiveResult } from "../backend/routine-store";
import type { WebhookRouteOwner } from "../backend/webhook-route-store";
import { WEBHOOK_EVENT_TYPE_MAX_LENGTH } from "../backend/webhook-trigger";
import type { WorkflowWebhookDelivery, WorkflowWebhookResult } from "../backend/workflows/workflows";
import {
  type HostEventsApi,
  HostEventsFailure,
  hostEventsFailureMessage,
  WebhookRouteConflict,
} from "./host-events-api";
import type { SecretCipher } from "./provider-credential-store";
import type { WebhookIngressDelivery } from "./signal-ingress";
import { signWebhookBody, verifyStandardWebhookSignature, verifyWebhookSignature } from "./webhook-security";

const logger = createOpenBotLogger("host-events");
const DEFAULT_ACTIVITY_LIMIT = 50;
const DEFAULT_RUN_LIMIT = 10;
const TEST_EVENT_TYPE = "openbot.test";

export interface HostWebhookRelay {
  connected(): boolean;
  setEnabled(enabled: boolean): void;
  setAccountActive(active: boolean): void;
  refresh(): void;
  ensureHost(): Effect.Effect<void>;
  registerRoute(routeId: string): Effect.Effect<string, { readonly cause: unknown } | WebhookRouteConflict>;
  revokeRoute(routeId: string): Effect.Effect<void, { readonly cause: unknown }>;
}

interface HostWorkflowWebhooks {
  receive(delivery: WorkflowWebhookDelivery): Effect.Effect<WorkflowWebhookResult, { readonly cause: unknown }>;
  changed(workflowId: string): void;
}

type WebhookDeliveryResult =
  | "started"
  | "ignored"
  | "duplicate"
  | "gone"
  | "too_large"
  | "unavailable"
  | "signed_out"
  | "unknown_route"
  | "secret_unreadable"
  | "bad_signature"
  | "bad_body"
  | "failed";

type WebhookIgnoredReason = "event-type" | "filter" | "inactive" | "busy" | "refused";

export interface WebhookDeliveryReport {
  ownerKind: WebhookRouteOwner["kind"] | null;
  format: "openbot" | "standard";
  result: WebhookDeliveryResult;
  ignoredReason: WebhookIgnoredReason | null;
  status: WebhookDeliveryStatus;
  bodyBytes: number;
  handleMs: number;
  ageMs: number | null;
  test: boolean;
}

export interface HostAgentWebhookKeys {
  save(agentId: string, name: string, value: string): Effect.Effect<void, { readonly cause: unknown }>;
  has(agentId: string, name: string): Effect.Effect<boolean, { readonly cause: unknown }>;
  remove(agentId: string, name: string): Effect.Effect<void, { readonly cause: unknown }>;
}

export function hostAgentWebhookKeys(
  keys: AgentApiKeys,
  agentName: (agentId: string) => string | undefined,
): HostAgentWebhookKeys {
  return {
    save: (agentId, name, value) =>
      keys.save({ id: agentId, name: agentName(agentId) }, name, value).pipe(Effect.asVoid),
    has: (agentId, name) => keys.has(agentId, name),
    remove: (agentId, name) => keys.remove(agentId, name).pipe(Effect.asVoid),
  };
}

export interface HostEventsServiceOptions {
  routines: RoutineRecords;
  agentKeys?: HostAgentWebhookKeys;
  workflows?: HostWorkflowWebhooks;
  cipher: SecretCipher;
  relay: HostWebhookRelay;
  accountPrincipal: () => string | null;
  onDelivery?: (report: WebhookDeliveryReport) => void;
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

function newWebhookSecret(): string {
  return `whsec_${randomBytes(32).toString("base64")}`;
}

const SENDER_SECRET_PATTERN = /^[\x21-\x7e]{16,1024}$/u;

type TestEventData = { [key: string]: TestEventData | EventScalar };

function testEventData(filters: readonly EventFilter[]): EventJsonValue {
  const root: TestEventData = Object.create(null);
  for (const { pointer, value } of filters) {
    if (pointer === "") return value;
    const tokens = pointer
      .slice(1)
      .split("/")
      .map((token) => token.replaceAll("~1", "/").replaceAll("~0", "~"));
    const last = tokens.pop() ?? "";
    let node = root;
    for (const token of tokens) {
      const child = node[token];
      if (typeof child === "object" && child !== null) node = child;
      else {
        const created: TestEventData = Object.create(null);
        node[token] = created;
        node = created;
      }
    }
    node[last] = value;
  }
  return root;
}

type ReceivedDelivery = WebhookReceiveResult<unknown> | WorkflowWebhookResult | { kind: "unavailable" };

interface ProcessedDelivery {
  status: WebhookDeliveryStatus;
  received: ReceivedDelivery | null;
  refusal: WebhookDeliveryResult | null;
  ownerKind: WebhookRouteOwner["kind"] | null;
  authenticated: boolean;
}

function refused(
  status: WebhookDeliveryStatus,
  refusal: WebhookDeliveryResult,
  ownerKind: WebhookRouteOwner["kind"] | null = null,
  authenticated = false,
): ProcessedDelivery {
  return { status, received: null, refusal, ownerKind, authenticated };
}

function deliveryResult(received: ReceivedDelivery): WebhookDeliveryResult {
  if (received.kind === "too-large") return "too_large";
  return received.kind === "bad-answer" ? "bad_body" : received.kind;
}

function deliveryAgeMs(timestamp: string, now: number): number | null {
  const seconds = Number(timestamp);
  return Number.isFinite(seconds) ? Math.max(0, now - seconds * 1000) : null;
}

function deliveryStatus(result: ReceivedDelivery) {
  switch (result.kind) {
    case "started":
    case "ignored":
      return 202;
    case "duplicate":
      return 200;
    case "gone":
      return 404;
    case "too-large":
      return 413;
    case "bad-answer":
      return 400;
    case "unavailable":
      return 503;
  }
}

function runIdOf(run: unknown): string | null {
  return isDynamicRecord(run) && isString(run.id) ? run.id : null;
}

interface DecodedWebhookBody {
  type: string;
  occurredAt: string | null;
  data: EventJsonValue;
}

function parseJsonObject(body: Uint8Array): DynamicRecord | null {
  try {
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
    return isDynamicRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function isEventType(value: unknown): value is string {
  return isString(value) && value.length >= 1 && value.length <= WEBHOOK_EVENT_TYPE_MAX_LENGTH;
}

function decodeWebhookBody(body: Uint8Array): DecodedWebhookBody | null {
  const value = parseJsonObject(body);
  if (!value || !isEventType(value.type)) return null;
  if (value.occurredAt !== undefined && (!isString(value.occurredAt) || Number.isNaN(Date.parse(value.occurredAt))))
    return null;
  const data = value.data ?? null;
  if (!isEventJsonValue(data)) return null;
  return { type: value.type, occurredAt: value.occurredAt ?? null, data };
}

const ISO_DATE_PREFIX = /^\d{4}-\d{2}-\d{2}T/u;

function decodeStandardWebhookBody(body: Uint8Array): DecodedWebhookBody | null {
  const value = parseJsonObject(body);
  if (!value || !isEventType(value.type) || !isEventJsonValue(value)) return null;
  const occurredAt =
    isString(value.timestamp) && ISO_DATE_PREFIX.test(value.timestamp) && !Number.isNaN(Date.parse(value.timestamp))
      ? value.timestamp
      : null;
  return { type: value.type, occurredAt, data: value };
}

export class HostEventsService implements HostEventsApi {
  readonly #options: HostEventsServiceOptions;
  #accountPrincipal: string | null;
  #accountGeneration = 0;
  readonly #writes = Semaphore.makeUnsafe(1);
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
    yield* this.syncRoutes({ all: false });
    const current = yield* eventStep(() => this.#options.routines.get(input.owner, saved.id) ?? saved);
    return { routine: eventRoutine(input.owner, current), secret };
  }).bind(this);

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
      yield* this.#replaceSecret(input, secret, false);
      return { secret };
    },
    (operation) => this.#writes.withPermit(operation),
  ).bind(this);

  readonly giveSecretToAgent = Effect.fn("HostEvents.giveSecretToAgent")(
    function* (
      this: HostEventsService,
      input: EventRoutineRef,
    ): Effect.fn.Return<AgentWebhookSecret, HostEventsFailure> {
      const keys = this.#options.agentKeys;
      if (input.owner.kind !== "agent" || !keys)
        return yield* eventFailure(sourceText("error.backend.webhookSettingsInvalid"));
      const routine = yield* this.#requireRoutine(input);
      if (routine.trigger.kind !== "webhook")
        return yield* eventFailure(sourceText("error.backend.webhookSettingsInvalid"));
      yield* this.#replaceSecret(input, newWebhookSecret(), true);
      return { name: webhookSecretKeyName(input.id) };
    },
    (operation) => this.#writes.withPermit(operation),
  ).bind(this);

  readonly #replaceSecret = Effect.fn("HostEvents.replaceSecret")(function* (
    this: HostEventsService,
    input: EventRoutineRef,
    secret: string,
    give: boolean,
  ) {
    const routes = this.#options.routines.routes;
    const old = yield* this.#requireRoute(input);
    const keys = input.owner.kind === "agent" ? this.#options.agentKeys : undefined;
    const name = webhookSecretKeyName(input.id);
    const keep = keys !== undefined && (give || (yield* toHostEventsFailure(keys.has(input.owner.id, name))));
    const secretCiphertext = yield* this.#encrypt(secret);
    yield* eventStep(() => routes.rotateSecret(input.owner, input.id, secretCiphertext));
    if (!keys || !keep) return;
    yield* toHostEventsFailure(keys.save(input.owner.id, name, secret)).pipe(
      Effect.tapError(() =>
        eventStep(() => routes.rotateSecret(input.owner, input.id, old.secretCiphertext)).pipe(
          Effect.catch(() =>
            Effect.sync(() => logger.warn("A webhook routine did not get its old signing secret back.")),
          ),
        ),
      ),
    );
  });

  readonly #dropAgentKey = Effect.fn("HostEvents.dropAgentKey")(function* (
    this: HostEventsService,
    input: EventRoutineRef,
  ) {
    const keys = this.#options.agentKeys;
    if (input.owner.kind !== "agent" || !keys) return;
    yield* removeWebhookSecretKey(keys, input.owner.id, input.id);
  });

  readonly setSecret = Effect.fn("HostEvents.setSecret")(
    function* (this: HostEventsService, input: SetWebhookSecretInput) {
      const secret = input.secret.trim();
      if (!SENDER_SECRET_PATTERN.test(secret))
        return yield* eventFailure(sourceText("error.backend.webhookSenderSecretInvalid"));
      const routine = yield* this.#requireRoutine(input);
      if (routine.trigger.kind !== "webhook")
        return yield* eventFailure(sourceText("error.backend.webhookSettingsInvalid"));
      yield* this.#replaceSecret(input, secret, false);
    },
    (operation) => this.#writes.withPermit(operation),
  ).bind(this);

  readonly rotateWorkflowSecret = Effect.fn("HostEvents.rotateWorkflowSecret")(function* (
    this: HostEventsService,
    input: WorkflowTriggerInput,
  ): Effect.fn.Return<WorkflowWebhookSecret, HostEventsFailure> {
    const secret = yield* this.#writeWorkflowSecret(input);
    yield* this.syncRoutes({ all: false });
    this.#options.workflows?.changed(input.workflowId);
    return { secret };
  }).bind(this);

  readonly listActivity = Effect.fn("HostEvents.listActivity")(function* (
    this: HostEventsService,
    input: ListEventActivityInput,
  ) {
    yield* this.#requireRoutine({ owner: input.owner, id: input.routineId });
    const limit = input.limit ?? DEFAULT_ACTIVITY_LIMIT;
    return yield* eventStep(() => this.#options.routines.routes.listReceipts(input.owner.kind, input.routineId, limit));
  }).bind(this);

  readonly listRoutineRuns = Effect.fn("HostEvents.listRoutineRuns")(function* (
    this: HostEventsService,
    input: ListEventRoutineRunsInput,
  ) {
    yield* this.#requireRoutine({ owner: input.owner, id: input.routineId });
    return yield* eventStep(() =>
      this.#options.routines.listRuns(input.owner, input.routineId, input.limit ?? DEFAULT_RUN_LIMIT),
    );
  }).bind(this);

  readonly receive = Effect.fn("HostEvents.receive")(function* (
    this: HostEventsService,
    input: WebhookIngressDelivery,
  ): Effect.fn.Return<{ status: WebhookDeliveryStatus }, HostEventsFailure> {
    const { status } = yield* this.#deliver(input, false);
    return { status };
  }).bind(this);

  readonly sendTestEvent = Effect.fn("HostEvents.sendTestEvent")(function* (
    this: HostEventsService,
    input: EventRoutineRef,
  ): Effect.fn.Return<WebhookTestResult, HostEventsFailure> {
    const routine = yield* this.#requireRoutine(input);
    if (routine.trigger.kind !== "webhook")
      return yield* eventFailure(sourceText("error.backend.webhookSettingsInvalid"));
    const route = yield* this.#requireRoute(input);
    const secret = yield* eventStep(() => {
      const value = this.#options.cipher.decrypt(Buffer.from(route.secretCiphertext, "base64"));
      registerSecretValue(value);
      return value;
    });
    const eventType = routine.trigger.eventType ?? TEST_EVENT_TYPE;
    const body = new TextEncoder().encode(
      JSON.stringify({ type: eventType, data: testEventData(routine.trigger.filters) }),
    );
    const timestamp = String(Math.floor(Date.now() / 1000));
    const deliveryId = `openbot-test-${randomUUID()}`;
    const { status, received } = yield* this.#deliver(
      {
        routeId: route.routeId,
        deliveryId,
        timestamp,
        signature: signWebhookBody(secret, timestamp, deliveryId, body),
        body,
      },
      true,
    );
    if (received?.kind === "started")
      return { eventType, status: "started", reason: null, runId: runIdOf(received.run) };
    if (received?.kind === "ignored" && received.reason !== "busy" && received.reason !== "refused")
      return { eventType, status: "ignored", reason: received.reason, runId: null };
    return yield* eventFailure(
      sourceText(status === 503 ? "error.backend.webhookTestUnavailable" : "error.backend.webhookTestFailed"),
    );
  }).bind(this);

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
      const updatedOwners = new Map<string, WebhookRouteOwner>();
      let hostChecked = false;
      for (const route of current) {
        if (!isCurrent()) return true;
        if (this.#options.accountPrincipal() === null) {
          relay.setEnabled(false);
          return true;
        }
        if (!options.all && route.url !== null) continue;
        if (!hostChecked) {
          hostChecked = true;
          yield* relay.ensureHost();
          if (!isCurrent()) return true;
        }
        const ownerKey = `${route.owner.kind}:${route.owner.id}`;
        let { routeId, url } = route;
        let registered = yield* Effect.result(relay.registerRoute(routeId));
        if (!isCurrent()) return true;
        if (registered._tag === "Failure" && registered.failure instanceof WebhookRouteConflict) {
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
      if (changed && enabled) relay.refresh();
      relay.setEnabled(enabled);
      for (const owner of updatedOwners.values()) {
        if (owner.kind === "workflow") this.#options.workflows?.changed(owner.id);
        else this.#options.routines.changed(owner);
      }
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

  setAccountPrincipal(principalId: string | null): void {
    if (principalId === this.#accountPrincipal) return;
    this.#accountPrincipal = principalId;
    this.#accountGeneration += 1;
    this.#options.relay.setAccountActive(principalId !== null);
  }

  readonly #deliver = Effect.fn("HostEvents.deliver")(function* (
    this: HostEventsService,
    input: WebhookIngressDelivery,
    test: boolean,
  ): Effect.fn.Return<ProcessedDelivery, HostEventsFailure> {
    const started = performance.now();
    const outcome = yield* Effect.result(this.#process(input));
    const processed = outcome._tag === "Success" ? outcome.success : null;
    const received = processed?.received ?? null;
    this.#options.onDelivery?.({
      ownerKind: processed?.ownerKind ?? null,
      format: input.format === STANDARD_WEBHOOKS_FORMAT ? "standard" : "openbot",
      result: processed ? (processed.refusal ?? (received ? deliveryResult(received) : "failed")) : "failed",
      ignoredReason: received?.kind === "ignored" ? received.reason : null,
      status: processed?.status ?? 503,
      bodyBytes: input.body.byteLength,
      handleMs: performance.now() - started,
      ageMs: processed?.authenticated ? deliveryAgeMs(input.timestamp, Date.now()) : null,
      test,
    });
    if (outcome._tag === "Failure") return yield* outcome.failure;
    return outcome.success;
  });

  readonly #process = Effect.fn("HostEvents.process")(function* (
    this: HostEventsService,
    input: WebhookIngressDelivery,
  ): Effect.fn.Return<ProcessedDelivery, HostEventsFailure> {
    if (this.#options.accountPrincipal() === null) return refused(503, "signed_out");
    if (input.body.byteLength > WEBHOOK_DELIVERY_BODY_BYTES_LIMIT) return refused(413, "too_large");
    const route = yield* eventStep(() => this.#options.routines.routes.find(input.routeId));
    if (!route) return refused(404, "unknown_route");
    const ownerKind = route.owner.kind;
    const secret = yield* Effect.result(
      eventStep(() => {
        const value = this.#options.cipher.decrypt(Buffer.from(route.secretCiphertext, "base64"));
        registerSecretValue(value);
        return value;
      }),
    );
    if (secret._tag === "Failure") {
      logger.warn("A webhook signing secret could not be decrypted.");
      return refused(503, "secret_unreadable", ownerKind);
    }
    const standard = input.format === STANDARD_WEBHOOKS_FORMAT;
    const verify = standard ? verifyStandardWebhookSignature : verifyWebhookSignature;
    const authenticated = yield* Effect.result(eventStep(() => verify(secret.success, input, input.signature)));
    if (authenticated._tag === "Failure") return refused(401, "bad_signature", ownerKind);
    const body = standard ? decodeStandardWebhookBody(input.body) : decodeWebhookBody(input.body);
    if (!body) return refused(400, "bad_body", ownerKind, true);
    const receivedAt = new Date().toISOString();
    const event = {
      deliveryId: input.deliveryId,
      eventType: body.type,
      data: body.data,
      occurredAt: body.occurredAt ?? receivedAt,
      receivedAt,
    };
    const { owner } = route;
    const received: ReceivedDelivery =
      owner.kind === "workflow"
        ? yield* this.#receiveWorkflow({ workflowId: owner.id, nodeId: route.routineId, event })
        : yield* toHostEventsFailure(this.#options.routines.receiveWebhook(owner, route.routineId, event));
    return { status: deliveryStatus(received), received, refusal: null, ownerKind, authenticated: true };
  });

  #receiveWorkflow(delivery: WorkflowWebhookDelivery): Effect.Effect<ReceivedDelivery, HostEventsFailure> {
    const workflows = this.#options.workflows;
    if (!workflows) return Effect.succeed({ kind: "gone" });
    return toHostEventsFailure(workflows.receive(delivery));
  }

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
          ...(input.missedPolicy === undefined ? {} : { missedPolicy: input.missedPolicy }),
          ...(input.runIn === undefined ? {} : { runIn: input.runIn }),
        }),
      );
      if (existing && (existing.trigger.kind === "webhook") !== (trigger.kind === "webhook"))
        yield* this.#dropAgentKey({ owner, id: existing.id });
      return { saved, secret };
    },
    (operation) => this.#writes.withPermit(operation),
  );

  readonly #writeWorkflowSecret = Effect.fn("HostEvents.writeWorkflowSecret")(
    function* (this: HostEventsService, input: WorkflowTriggerInput) {
      const routes = this.#options.routines.routes;
      const known = yield* eventStep(() => routes.hasWorkflowRoute(input.workflowId, input.nodeId));
      if (!known && (yield* eventStep(() => routes.list())).length >= WEBHOOK_ROUTES_LIMIT)
        return yield* eventFailure(sourceText("error.backend.webhookRouteLimit", { limit: WEBHOOK_ROUTES_LIMIT }));
      const secret = newWebhookSecret();
      const secretCiphertext = yield* this.#encrypt(secret);
      const written = yield* eventStep(() =>
        routes.rotateWorkflowSecret(input.workflowId, input.nodeId, secretCiphertext),
      );
      if (!written) return yield* eventFailure(sourceText("error.workflow.webhookMissing"));
      return secret;
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

  readonly #requireRoute = Effect.fn("HostEvents.requireRoute")(function* (
    this: HostEventsService,
    ref: EventRoutineRef,
  ) {
    const route = yield* eventStep(() =>
      this.#options.routines.routes
        .list()
        .find(
          (item) => item.routineId === ref.id && item.owner.kind === ref.owner.kind && item.owner.id === ref.owner.id,
        ),
    );
    if (route) return route;
    return yield* eventFailure(sourceText("error.backend.routineGone"));
  });

  readonly #encrypt = Effect.fn("HostEvents.encrypt")(function* (this: HostEventsService, secret: string) {
    return yield* eventStep(() => {
      registerSecretValue(secret);
      return this.#options.cipher.encrypt(secret).toString("base64");
    });
  });
}

export function agentWebhookRoutineWriter(events: HostEventsService): WebhookRoutineWriter {
  const toolFailure = (failure: HostEventsFailure) => {
    const message = hostEventsFailureMessage(failure);
    return new RoutineOperationFailed({ cause: message === null ? failure : new RoutineInputError(message) });
  };
  return {
    save: ({ routineId, agentId, eventType, filters, ...routine }) =>
      events
        .saveRoutine({
          ...routine,
          ...(routineId === undefined ? {} : { id: routineId }),
          owner: { kind: "agent", id: agentId },
          trigger: { kind: "webhook", eventType, filters },
        })
        .pipe(
          Effect.map((saved) => saved.routine),
          Effect.mapError(toolFailure),
        ),
    delete: ({ agentId, routineId }) =>
      events.deleteRoutine({ owner: { kind: "agent", id: agentId }, id: routineId }).pipe(Effect.mapError(toolFailure)),
  };
}
