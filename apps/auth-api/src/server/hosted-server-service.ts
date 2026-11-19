import {
  BILLING_CURRENCIES,
  BILLING_INTERVALS,
  BILLING_OPTIONAL_CURRENCIES,
  BILLING_PLAN_IDS,
  type BillingCurrency,
  type BillingInterval,
  type BillingPlanId,
  isOpenBillingStatus,
  memberLimitForPlan,
  storageTierOf,
} from "@openbot/contracts/billing";
import {
  HOSTED_BOAT_PLAN_SIZE,
  HOSTED_PLAN_SIZE,
  HOSTED_SERVER_ENTRY_POINTS,
  type HostedServerActivityReport,
  type HostedServerCatalog,
  type HostedServerCheckout,
  type HostedServerClaim,
  type HostedServerEntryPoint,
  type HostedServerError,
  type HostedServerLifecycleInput,
  type HostedServerList,
  type HostedServerSize,
  type HostedServerState,
  type HostedServerStatus,
  type HostedServerSummary,
  hostedServerStorageGb,
  parseHostedServerName,
} from "@openbot/contracts/hosted-servers";
import { parseLicenseOrder } from "@openbot/contracts/license";
import { isDynamicRecord, isOneOf, isString } from "@openbot/contracts/runtime-values";
import type { RouteHostState } from "@openbot/contracts/signal-protocol/ingress-queue";
import { sourceText } from "@openbot/i18n/source";
import { Context, Effect, Layer, Result, Schema } from "effect";
import { SOLD_OUT_PLANS } from "../lib/pricing-page";
import {
  type AccountAnalytics,
  type AccountAnalyticsEvent,
  MAX_HOSTED_START_MS,
  NO_ACCOUNT_ANALYTICS,
} from "./account-analytics";
import { getServerEntitlement } from "./billing-entitlement";
import {
  BillingError,
  type BillingReturnTarget,
  type BillingService,
  type CheckoutOrder,
  type SubscriptionSync,
} from "./billing-service";
import {
  BoatApiError,
  BoatClient,
  type BoatFetch,
  type BoatSandboxState,
  isBoatState,
  verifyBoatWebhookSignature,
} from "./boat-client";
import { constantTimeEqual, deriveSecret, hmacSha256, randomToken, sha256 } from "./crypto";
import { createHostedPoolAlert, type HostedPoolAlert } from "./hosted-pool-alert";
import type { RemoteFailure } from "./remote-control-plane";
import { PERSISTENT_SESSION_EXPIRES_AT } from "./session-policy";
import { priceHasCurrency } from "./stripe-client";
import type { AuthUser, WorkerBindings } from "./types";

const CLAIM_TTL_MS = 60 * 60_000;
const CLAIM_REDEEM_RETRY_MS = 10 * 60_000;
const STUCK_AFTER_MS = 2 * 60_000;
const RATE_LIMIT_RETRY_MIN_MS = 30_000;
const RATE_LIMIT_RETRY_MAX_MS = 5 * 60_000;
const DELIVERY_RETENTION_MS = 7 * 24 * 60 * 60_000;
const MAX_SERVERS_PER_ACCOUNT = 50;
const TICK_BATCH_SIZE = 20;
const UNPAID_RETENTION_MS = 24 * 60 * 60_000;
const SETUP_RETRY_AFTER_MS = 10 * 60_000;
const CREATE_LOST_AFTER_MS = 10 * 60_000;
const POOL_PRODUCT_OF_PLAN: Record<BillingPlanId, string> = { starter: "VPS01", standard: "VPS02", pro: "VPS03" };
const POOL_HOST_PATTERN = /^leaseweb:\d{1,20}$/u;
export const POOL_SEEN_WITHIN_MS = 150_000;
const POOL_SEEN_WRITE_AFTER_MS = 60_000;
const POOL_START_LOST_AFTER_MS = 4 * 60_000;
const LOW_POOL_FREE = 1;
const POOL_CANDIDATES = 3;
const POOL_FIRST_START_SQL = `(operator_host IS NOT NULL AND observed_state = 'starting' AND last_wake_reason = 'create'
  AND provider_template IS NULL AND retired_sandbox_id IS NULL AND claim_redeemed_at IS NULL)`;
const SANDBOX_NAME_MAX_LENGTH = 120;
const IDLE_STOP_AFTER_MS = 15 * 60_000;
const RESIZE_AFTER_NO_USE_MS = 7 * 60_000;
const LEASE_TTL_SECONDS = 2 * 60 * 60;
const LEASE_EXTEND_BEFORE_MS = 60 * 60_000;
const HELD_RESUME_START_COMMAND =
  "if [ -e /run/openbot-pre-stop ]; then sudo -n rm -f /run/openbot-pre-stop && sudo -n systemctl start --no-block openbot.service && echo started; fi";
const HELD_RESUME_START_TIMEOUT_SECONDS = 10;
const FAILED_STOP_START_COMMAND =
  "if find /run/openbot-pre-stop -mmin +5 2>/dev/null | grep -q .; then sudo -n rm -f /run/openbot-pre-stop && sudo -n systemctl start --no-block openbot.service && echo started; fi";
const SCHEDULE_WAKE_BEFORE_MS = 10 * 60_000;
const RETENTION_WAKE_AFTER_MS = 10 * 24 * 60 * 60_000;
const RETENTION_DISK_KEPT_MS = 14 * 24 * 60 * 60_000;
const RETENTION_WAKE_EVERY_MINUTES = 10;
export const OPERATOR_HOST_DATA_KEPT_MS = 30 * 24 * 60 * 60_000;
const NEXT_RUN_MAX_AHEAD_MS = 400 * 24 * 60 * 60_000;
const CLAIM_OPEN_SQL = `(hosted_servers.auth_session_id IS NULL OR NOT EXISTS(
  SELECT 1 FROM auth_sessions WHERE auth_sessions.id = hosted_servers.auth_session_id AND auth_sessions.revoked_at IS NULL))`;
const OPEN_STATUSES_SQL = "('active', 'trialing', 'past_due', 'unpaid', 'paused')";

export type HostedServerBindings = Pick<
  WorkerBindings,
  | "DB"
  | "HOSTED_SERVERS_ENABLED"
  | "HOSTED_SERVERS_ALLOWED_USER_IDS"
  | "HOSTED_SERVERS_DEVELOPER_KEY"
  | "HOSTED_SERVER_TEMPLATE"
  | "BOAT_API_KEY"
  | "BOAT_WEBHOOK_SECRET"
  | "REMOTE_TICKET_PRIVATE_JWK"
  | "HOSTED_POOL_ALERT_WEBHOOK_URL"
>;

export class HostedServerServiceError extends Schema.TaggedError<HostedServerServiceError>()(
  "HostedServerServiceError",
  {
    status: Schema.Number,
    code: Schema.String,
    message: Schema.String,
  },
) {
  constructor(status: number, code: string, message: string) {
    super({ status, code, message });
  }
}
class HostedServerOperationError extends Schema.TaggedError<HostedServerOperationError>()(
  "HostedServerOperationError",
  {},
) {}
export type HostedFailure = HostedServerServiceError | BoatApiError | BillingError | HostedServerOperationError;
function hostedFailure(error: unknown): HostedFailure {
  return error instanceof HostedServerServiceError || error instanceof BoatApiError || error instanceof BillingError
    ? error
    : new HostedServerOperationError({});
}
function hostedCall<A>(operation: () => Promise<A>): Effect.Effect<A, HostedFailure>;
function hostedCall<A>(operation: () => Promise<A> | undefined): Effect.Effect<A | undefined, HostedFailure>;
function hostedCall<A>(operation: () => Promise<A> | undefined): Effect.Effect<A | undefined, HostedFailure> {
  return Effect.tryPromise({ try: () => Promise.resolve(operation()), catch: hostedFailure });
}
function hostedValidate<A>(operation: () => A): Effect.Effect<A, HostedFailure> {
  return Effect.try({ try: operation, catch: hostedFailure });
}

type DesiredState = "running" | "idle" | "stopped" | "deleted";
type WakeReason = "create" | "message" | "restart" | "schedule" | "retention";

interface HostedServerRow {
  server_id: string;
  owner_user_id: string;
  name: string;
  provider_sandbox_id: string | null;
  provider_template: string | null;
  operator_host: string | null;
  retired_sandbox_id: string | null;
  size: HostedServerSize;
  pending_size: HostedServerSize | null;
  plan: BillingPlanId;
  billing_interval: BillingInterval;
  currency: BillingCurrency;
  checkout_session_id: string | null;
  idempotency_key: string;
  desired_state: DesiredState;
  observed_state: HostedServerState;
  observed_error: HostedServerError | null;
  provider_event_at: number | null;
  auth_session_id: string | null;
  last_active_at: number | null;
  lease_until: number | null;
  next_run_at: number | null;
  last_wake_reason: Exclude<WakeReason, "retention"> | null;
  start_requested_at: number | null;
  created_at: number;
  updated_at: number;
  deletion_scheduled_at: number | null;
  deletion_subscription_id: string | null;
  storage_tier: number;
}

const ROW_COLUMNS = `server_id, owner_user_id, name, provider_sandbox_id, provider_template, operator_host, retired_sandbox_id, size, pending_size, plan, billing_interval, currency,
  checkout_session_id, idempotency_key, desired_state, observed_state, observed_error, provider_event_at, auth_session_id,
  last_active_at, lease_until, next_run_at, last_wake_reason, start_requested_at, created_at, updated_at, deletion_scheduled_at,
  deletion_subscription_id, storage_tier`;

export type HostedServerBilling = Pick<
  BillingService,
  | "catalog"
  | "license"
  | "createCheckout"
  | "closeCheckout"
  | "cancelServerPlans"
  | "cancelSubscription"
  | "refreshLapsedPlans"
  | "setServerRenewal"
  | "subscriptionEnded"
>;

export interface HostedServerServiceOptions {
  fetch?: BoatFetch;
  now?: () => number;
  removeHost?: ((ownerUserId: string, hostId: string) => Effect.Effect<void, RemoteFailure>) | null | undefined;
  billing?: HostedServerBilling | null;
  analytics?: AccountAnalytics;
  developerKey?: string | null;
  schedule?: (work: Effect.Effect<void>) => void;
}

export interface CheckoutReturn {
  target: BillingReturnTarget;
  origin: string;
  entryPoint?: HostedServerEntryPoint;
  promotionCode?: string;
}

export type HostedPoolAssignment = { state: "waiting" } | { state: "assigned"; serverId: string; claim: string };

export interface HostedServerTickResult {
  restarted: number;
  reconciled: number;
  deleted: number;
  provisioned: number;
  stopped: number;
  abandoned: number;
  resized: number;
  idle: number;
  scheduled: number;
  retained: number;
  failed: number;
}

class HostedServerDependencies extends Context.Service<
  HostedServerDependencies,
  {
    database: D1Database;
    boat: BoatClient | null;
    billing: HostedServerBilling | null;
    now: () => number;
    removeHost: ((ownerUserId: string, hostId: string) => Effect.Effect<void, RemoteFailure>) | null;
    analytics: AccountAnalytics;
    schedule: (work: Effect.Effect<void>) => void;
  }
>()("auth-api/HostedServerService/Dependencies") {}

export class HostedServerService {
  readonly #layer: Layer.Layer<HostedServerDependencies>;

  readonly #boat: BoatClient | null;
  readonly #template: string | null;
  readonly #ticketKey: string | null;
  readonly #webhookSecret: string | null;
  #claimSecret: string | null = null;
  readonly #enabled: boolean;
  readonly #allowed: ReadonlySet<string>;
  readonly #developerAccess: boolean;
  readonly #now: () => number;
  readonly #billing: HostedServerBilling | null;
  readonly #analytics: AccountAnalytics;
  readonly #poolAlert: HostedPoolAlert | null;

  constructor(bindings: HostedServerBindings, options: HostedServerServiceOptions = {}) {
    const database = bindings.DB;
    const apiKey = bindings.BOAT_API_KEY?.trim() || null;
    this.#boat = apiKey ? new BoatClient({ apiKey, fetch: options.fetch }) : null;
    this.#template = bindings.HOSTED_SERVER_TEMPLATE?.trim() || null;
    this.#webhookSecret = bindings.BOAT_WEBHOOK_SECRET?.trim() || null;
    this.#ticketKey = bindings.REMOTE_TICKET_PRIVATE_JWK?.trim() || null;
    this.#enabled =
      bindings.HOSTED_SERVERS_ENABLED === "true" &&
      this.#boat !== null &&
      this.#template !== null &&
      this.#ticketKey !== null;
    this.#allowed = new Set(
      (bindings.HOSTED_SERVERS_ALLOWED_USER_IDS ?? "")
        .split(",")
        .map((value) => (value.includes("@") ? value.trim().toLowerCase() : value.trim()))
        .filter(Boolean),
    );
    this.#developerAccess = isDeveloperKey(bindings.HOSTED_SERVERS_DEVELOPER_KEY, options.developerKey);
    this.#now = options.now ?? Date.now;
    const removeHost = options.removeHost ?? null;
    this.#billing = options.billing ?? null;
    this.#analytics = options.analytics ?? NO_ACCOUNT_ANALYTICS;
    this.#poolAlert = createHostedPoolAlert(
      bindings.HOSTED_POOL_ALERT_WEBHOOK_URL,
      options.fetch ?? ((input, init) => fetch(input, init)),
    );
    this.#layer = Layer.succeed(HostedServerDependencies, {
      database,
      boat: this.#boat,
      billing: this.#billing,
      now: this.#now,
      removeHost,
      analytics: this.#analytics,
      schedule: options.schedule ?? ((work) => void Effect.runFork(work)),
    });
  }

  isAvailableFor(user: Pick<AuthUser, "id" | "email">): boolean {
    const allowed =
      this.#developerAccess ||
      this.#allowed.has("*") ||
      this.#allowed.has(user.id) ||
      this.#allowed.has(user.email.toLowerCase());
    return this.#enabled && this.#billing !== null && allowed;
  }

  readonly plans = Effect.fn("HostedServerService.plans")(
    function* (
      this: HostedServerService,
      user: AuthUser,
    ): Effect.fn.Return<HostedServerCatalog, HostedFailure, HostedServerDependencies> {
      const { billing } = yield* hostedValidate(() => this.#requireAvailable(user));
      return yield* billing.catalog().pipe(Effect.mapError(hostedFailure));
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  readonly list = Effect.fn("HostedServerService.list")(
    function* (
      this: HostedServerService,
      user: AuthUser,
    ): Effect.fn.Return<HostedServerList, HostedFailure, HostedServerDependencies> {
      const dependencies = yield* HostedServerDependencies;
      const rows = yield* hostedCall(() =>
        dependencies.database
          .prepare(
            `SELECT ${ROW_COLUMNS} FROM hosted_servers
         WHERE owner_user_id = ? AND desired_state != 'deleted' ORDER BY created_at`,
          )
          .bind(user.id)
          .all<HostedServerRow>(),
      );
      return {
        available: this.isAvailableFor(user),
        lifecycleAvailable: true,
        servers: rows.results.map(summary),
        maxServers: MAX_SERVERS_PER_ACCOUNT,
      };
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  readonly create = Effect.fn("HostedServerService.create")(
    function* (
      this: HostedServerService,
      user: AuthUser,
      input: {
        name: unknown;
        plan: unknown;
        interval: unknown;
        currency: unknown;
        entryPoint?: unknown;
        license?: unknown;
        earlyStart?: unknown;
      },
      idempotencyKeyHeader: string | null,
      checkoutReturn: CheckoutReturn,
    ): Effect.fn.Return<HostedServerCheckout, HostedFailure, HostedServerDependencies> {
      const dependencies = yield* HostedServerDependencies;
      const returnTo: CheckoutReturn = isOneOf(HOSTED_SERVER_ENTRY_POINTS, input.entryPoint)
        ? { ...checkoutReturn, entryPoint: input.entryPoint }
        : checkoutReturn;
      const { billing } = yield* hostedValidate(() => this.#requireAvailable(user));
      const idempotencyKey = idempotencyKeyHeader?.trim() ?? "";
      if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/u.test(idempotencyKey)) {
        return yield* new HostedServerServiceError(
          400,
          "invalid_idempotency_key",
          "A valid Idempotency-Key header is required.",
        );
      }
      const name = yield* hostedValidate(() => serverName(input.name));
      if (!isOneOf(BILLING_PLAN_IDS, input.plan)) return yield* invalid("plan");
      if (!isOneOf(BILLING_INTERVALS, input.interval)) return yield* invalid("interval");
      if (!isOneOf(BILLING_CURRENCIES, input.currency)) return yield* invalid("currency");
      const license = input.license === undefined ? undefined : parseLicenseOrder(input.license);
      if (
        license === null ||
        (license &&
          ((input.plan === "starter" && license.tier !== "starter") || license.users > memberLimitForPlan(input.plan)))
      )
        return yield* invalid("license");
      const order: CheckoutOrder = {
        license: license ?? null,
        earlyStartAt: input.earlyStart === true ? dependencies.now() : null,
      };
      if (isOneOf(BILLING_OPTIONAL_CURRENCIES, input.currency)) {
        const catalog = yield* billing.catalog().pipe(Effect.mapError(hostedFailure));
        const currency = input.currency;
        if (!catalog.plans.some((plan) => plan.id === input.plan && plan.prices[currency] !== undefined))
          return yield* invalid("currency");
        if (license) {
          const licensePrice = yield* billing.license
            .price({ tier: license.tier, interval: input.interval, bundle: true })
            .pipe(Effect.mapError(hostedFailure));
          if (!licensePrice || !priceHasCurrency(licensePrice, currency)) return yield* invalid("currency");
        }
      }
      const size = HOSTED_PLAN_SIZE[input.plan];
      const previous = yield* hostedCall(() =>
        dependencies.database
          .prepare(`SELECT ${ROW_COLUMNS} FROM hosted_servers WHERE owner_user_id = ? AND idempotency_key = ?`)
          .bind(user.id, idempotencyKey)
          .first<HostedServerRow>(),
      );
      if (previous) return yield* this.#checkout(previous, user, billing, returnTo, order);
      if (SOLD_OUT_PLANS.has(input.plan)) return yield* planSoldOut();
      const unpaid = yield* hostedCall(() =>
        dependencies.database
          .prepare(
            `SELECT ${ROW_COLUMNS} FROM hosted_servers
         WHERE owner_user_id = ? AND observed_state = 'awaiting_payment' AND desired_state = 'running'
           AND NOT EXISTS(
             SELECT 1 FROM billing_subscriptions s
             WHERE s.server_id = hosted_servers.server_id AND s.status IN ${OPEN_STATUSES_SQL}
           )
         ORDER BY updated_at DESC LIMIT 1`,
          )
          .bind(user.id)
          .first<HostedServerRow>(),
      );
      if (unpaid) {
        const choice = { plan: input.plan, interval: input.interval, currency: input.currency };
        return yield* this.#reuseUnpaid(unpaid, choice, idempotencyKey, user, billing, returnTo, order);
      }
      const count = yield* hostedCall(() =>
        dependencies.database
          .prepare(
            "SELECT COUNT(*) AS count FROM hosted_servers WHERE owner_user_id = ? AND desired_state != 'deleted'",
          )
          .bind(user.id)
          .first<{ count: number }>(),
      );
      if ((count?.count ?? 0) >= MAX_SERVERS_PER_ACCOUNT) {
        return yield* new HostedServerServiceError(
          409,
          "hosted_server_limit",
          "This account has the maximum number of servers.",
        );
      }
      const serverId = crypto.randomUUID();
      const now = dependencies.now();
      const inserted = yield* hostedCall(() =>
        dependencies.database
          .prepare(
            `INSERT INTO hosted_servers(
           server_id, owner_user_id, name, size, plan, billing_interval, currency, desired_state, observed_state,
           idempotency_key, legacy_member_limits, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 'running', 'awaiting_payment', ?, 0, ?, ?)
         ON CONFLICT(owner_user_id, idempotency_key) DO NOTHING`,
          )
          .bind(serverId, user.id, name, size, input.plan, input.interval, input.currency, idempotencyKey, now, now)
          .run(),
      );
      if (inserted.meta.changes !== 1) {
        const concurrent = yield* hostedCall(() =>
          dependencies.database
            .prepare(`SELECT ${ROW_COLUMNS} FROM hosted_servers WHERE owner_user_id = ? AND idempotency_key = ?`)
            .bind(user.id, idempotencyKey)
            .first<HostedServerRow>(),
        );
        if (!concurrent)
          return yield* new HostedServerServiceError(409, "hosted_server_conflict", "Try the request again.");
        return yield* this.#checkout(concurrent, user, billing, returnTo, order);
      }
      return yield* this.#checkout(yield* this.#requireRow(serverId), user, billing, returnTo, order);
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  readonly checkout = Effect.fn("HostedServerService.checkout")(
    function* (
      this: HostedServerService,
      user: AuthUser,
      serverId: string,
      returnTo: CheckoutReturn,
    ): Effect.fn.Return<HostedServerCheckout, HostedFailure, HostedServerDependencies> {
      const dependencies = yield* HostedServerDependencies;
      const { billing } = yield* hostedValidate(() => this.#requireAvailable(user));
      const row = yield* hostedCall(() =>
        dependencies.database
          .prepare(
            `SELECT ${ROW_COLUMNS} FROM hosted_servers WHERE server_id = ? AND owner_user_id = ? AND desired_state != 'deleted'`,
          )
          .bind(serverId, user.id)
          .first<HostedServerRow>(),
      );
      if (!row) return yield* notFound();
      const resumed = row.observed_state === "awaiting_payment" && row.desired_state === "running";
      return yield* this.#checkout(
        row,
        user,
        billing,
        resumed ? { ...returnTo, entryPoint: "checkout_resume" } : returnTo,
        resumed ? "previous" : undefined,
      );
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  readonly onSubscriptionSynced = Effect.fn("HostedServerService.onSubscriptionSynced")(
    function* (
      this: HostedServerService,
      sync: SubscriptionSync,
    ): Effect.fn.Return<void, HostedFailure, HostedServerDependencies> {
      const dependencies = yield* HostedServerDependencies;
      const row = yield* hostedCall(() =>
        dependencies.database
          .prepare(`SELECT ${ROW_COLUMNS} FROM hosted_servers WHERE server_id = ? AND owner_user_id = ?`)
          .bind(sync.serverId, sync.userId)
          .first<HostedServerRow>(),
      );
      if (!row) return;
      if (row.desired_state === "deleted") {
        if (isOpenBillingStatus(sync.status) && dependencies.billing)
          yield* dependencies.billing.cancelSubscription(sync.subscriptionId).pipe(Effect.mapError(hostedFailure));
        return;
      }
      yield* hostedCall(() =>
        dependencies.database
          .prepare(
            `UPDATE hosted_servers SET deletion_scheduled_at = NULL, deletion_subscription_id = NULL
         WHERE server_id = ? AND deletion_scheduled_at IS NOT NULL AND EXISTS(
           SELECT 1 FROM billing_subscriptions s WHERE s.server_id = hosted_servers.server_id
           AND s.status IN ${OPEN_STATUSES_SQL} AND (s.cancel_at_period_end = 0
             OR s.stripe_subscription_id != hosted_servers.deletion_subscription_id
             OR (s.stripe_subscription_id = hosted_servers.deletion_subscription_id
             AND s.current_period_end > hosted_servers.deletion_scheduled_at)))`,
          )
          .bind(row.server_id)
          .run(),
      );
      if (isOpenBillingStatus(sync.status)) {
        yield* this.#followPlan(row, sync);
        yield* this.#followStorage(row, sync);
      }
      yield* this.#applyPlan(yield* this.#requireRow(row.server_id));
      yield* this.#resize(yield* this.#requireRow(row.server_id));
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  readonly lifecycle = Effect.fn("HostedServerService.lifecycle")(
    function* (
      this: HostedServerService,
      user: AuthUser,
      serverId: string,
      input: HostedServerLifecycleInput,
    ): Effect.fn.Return<void, HostedFailure, HostedServerDependencies> {
      const dependencies = yield* HostedServerDependencies;
      const row = yield* hostedCall(() =>
        dependencies.database
          .prepare(
            `SELECT ${ROW_COLUMNS} FROM hosted_servers WHERE server_id = ? AND owner_user_id = ? AND desired_state != 'deleted'`,
          )
          .bind(serverId, user.id)
          .first<HostedServerRow>(),
      );
      if (!row) return yield* notFound();
      if (input.action === "delete" && input.confirmName !== row.name) {
        return yield* new HostedServerServiceError(
          400,
          "hosted_server_confirm_mismatch",
          sourceText("error.billing.confirmMismatch"),
        );
      }
      const token = crypto.randomUUID();
      const claimed = yield* this.#claimLifecycle(serverId, token);
      if (!claimed) return yield* lifecycleFailure();
      yield* Effect.gen({ self: this }, function* () {
        if (input.action === "delete" && input.timing === "now") {
          yield* this.#deleteNow(user, serverId, input.confirmName);
          return;
        }
        if (!dependencies.billing) return yield* lifecycleFailure();
        const plan = yield* dependencies.billing
          .setServerRenewal(
            user.id,
            serverId,
            input.action !== "keep",
            input.action === "delete" ? input.expectedPeriodEnd : undefined,
          )
          .pipe(Effect.mapError(hostedFailure));
        if (
          input.action === "delete" &&
          input.expectedPeriodEnd !== undefined &&
          plan.periodEnd !== input.expectedPeriodEnd
        ) {
          return yield* lifecycleFailure();
        }
        const stored = yield* hostedCall(() =>
          dependencies.database
            .prepare(
              `UPDATE hosted_servers SET
           deletion_scheduled_at = CASE WHEN ? = 'cancel' THEN deletion_scheduled_at ELSE ? END,
           deletion_subscription_id = CASE WHEN ? = 'cancel' THEN deletion_subscription_id ELSE ? END,
           updated_at = ?
           WHERE server_id = ? AND desired_state != 'deleted' AND lifecycle_token = ? AND lifecycle_lease_until > ?`,
            )
            .bind(
              input.action,
              input.action === "delete" ? plan.periodEnd : null,
              input.action,
              input.action === "delete" ? plan.subscriptionId : null,
              dependencies.now(),
              serverId,
              token,
              dependencies.now(),
            )
            .run(),
        );
        if (stored.meta.changes !== 1) return yield* lifecycleFailure();
      }).pipe(Effect.ensuring(this.#releaseLifecycle(serverId, token).pipe(Effect.orDie)));
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  readonly #claimLifecycle = Effect.fn("HostedServerService.claimLifecycle")(function* (
    this: HostedServerService,
    serverId: string,
    token: string,
  ) {
    const dependencies = yield* HostedServerDependencies;
    const now = dependencies.now();
    const claimed = yield* hostedCall(() =>
      dependencies.database
        .prepare(
          `UPDATE hosted_servers SET lifecycle_token = ?, lifecycle_lease_until = ?
       WHERE server_id = ? AND desired_state != 'deleted' AND (lifecycle_token IS NULL OR lifecycle_lease_until <= ?)`,
        )
        .bind(token, now + 120_000, serverId, now)
        .run(),
    );
    return claimed.meta.changes === 1;
  });

  readonly #releaseLifecycle = Effect.fn("HostedServerService.releaseLifecycle")(function* (
    this: HostedServerService,
    serverId: string,
    token: string,
  ) {
    const dependencies = yield* HostedServerDependencies;
    yield* hostedCall(() =>
      dependencies.database
        .prepare(
          "UPDATE hosted_servers SET lifecycle_token = NULL, lifecycle_lease_until = NULL WHERE server_id = ? AND lifecycle_token = ?",
        )
        .bind(serverId, token)
        .run(),
    );
  });

  readonly #deleteScheduled = Effect.fn("HostedServerService.deleteScheduled")(function* (
    this: HostedServerService,
    row: HostedServerRow,
  ) {
    const dependencies = yield* HostedServerDependencies;
    const billing = dependencies.billing;
    const subscriptionId = row.deletion_subscription_id;
    if (!billing || !subscriptionId) return;
    const token = crypto.randomUUID();
    if (!(yield* this.#claimLifecycle(row.server_id, token))) return;
    yield* Effect.gen({ self: this }, function* () {
      if (!(yield* billing.subscriptionEnded(subscriptionId).pipe(Effect.mapError(hostedFailure)))) return;
      const claimed = yield* hostedCall(() =>
        dependencies.database
          .prepare(
            `UPDATE hosted_servers SET desired_state = 'deleted', updated_at = ?
         WHERE server_id = ? AND desired_state != 'deleted' AND lifecycle_token = ? AND lifecycle_lease_until > ?
         AND deletion_scheduled_at = ? AND deletion_scheduled_at <= ? AND deletion_subscription_id = ?
         AND NOT EXISTS(SELECT 1 FROM billing_subscriptions s WHERE s.server_id = hosted_servers.server_id
           AND (s.status IN ${OPEN_STATUSES_SQL} OR (s.stripe_subscription_id = hosted_servers.deletion_subscription_id
             AND s.current_period_end > hosted_servers.deletion_scheduled_at)))`,
          )
          .bind(
            dependencies.now(),
            row.server_id,
            token,
            dependencies.now(),
            row.deletion_scheduled_at,
            dependencies.now(),
            row.deletion_subscription_id,
          )
          .run(),
      );
      if (claimed.meta.changes === 1) yield* this.#finishDelete(yield* this.#requireRow(row.server_id));
    }).pipe(Effect.ensuring(this.#releaseLifecycle(row.server_id, token).pipe(Effect.orDie)));
  });

  readonly #deleteExpired = Effect.fn("HostedServerService.deleteExpired")(function* (
    this: HostedServerService,
    row: HostedServerRow & { plan_ended_at: number },
  ) {
    const dependencies = yield* HostedServerDependencies;
    const billing = dependencies.billing;
    if (!billing) return;
    const newest = yield* hostedCall(() =>
      dependencies.database
        .prepare(
          `SELECT stripe_subscription_id,
           EXISTS(SELECT 1 FROM billing_subscriptions o WHERE o.server_id = ? AND o.status IN ${OPEN_STATUSES_SQL}) AS open
         FROM billing_subscriptions WHERE server_id = ?
         ORDER BY COALESCE(current_period_end, 0) DESC, updated_at DESC LIMIT 1`,
        )
        .bind(row.server_id, row.server_id)
        .first<{ stripe_subscription_id: string; open: number }>(),
    );
    if (!newest || newest.open) return;
    const token = crypto.randomUUID();
    if (!(yield* this.#claimLifecycle(row.server_id, token))) return;
    yield* Effect.gen({ self: this }, function* () {
      if (!(yield* billing.subscriptionEnded(newest.stripe_subscription_id).pipe(Effect.mapError(hostedFailure))))
        return;
      const checkout = (yield* this.#requireRow(row.server_id)).checkout_session_id;
      if (checkout && (yield* this.#closeCheckout(checkout)) !== "closed") return;
      const claimed = yield* hostedCall(() =>
        dependencies.database
          .prepare(
            `UPDATE hosted_servers SET desired_state = 'deleted', updated_at = ?
         WHERE server_id = ? AND desired_state = 'stopped' AND operator_host IS NOT NULL AND plan_ended_at = ?
         AND lifecycle_token = ? AND lifecycle_lease_until > ?
         AND NOT EXISTS(SELECT 1 FROM billing_subscriptions s WHERE s.server_id = hosted_servers.server_id
           AND s.status IN ${OPEN_STATUSES_SQL})`,
          )
          .bind(dependencies.now(), row.server_id, row.plan_ended_at, token, dependencies.now())
          .run(),
      );
      if (claimed.meta.changes !== 1) return;
      this.#track(row, { name: "hosted_server_action", action: "deleted", plan: row.plan, size: row.size });
      yield* this.#finishDelete(yield* this.#requireRow(row.server_id));
    }).pipe(Effect.ensuring(this.#releaseLifecycle(row.server_id, token).pipe(Effect.orDie)));
  });

  readonly delete = Effect.fn("HostedServerService.delete")(
    function* (
      this: HostedServerService,
      user: AuthUser,
      serverId: string,
      confirmName: unknown,
    ): Effect.fn.Return<void, HostedFailure, HostedServerDependencies> {
      if (typeof confirmName !== "string")
        return yield* new HostedServerServiceError(
          400,
          "hosted_server_confirm_mismatch",
          sourceText("error.billing.confirmMismatch"),
        );
      const row = yield* this.#requireRow(serverId);
      if (row.desired_state === "deleted") return yield* this.#deleteNow(user, serverId, confirmName);
      yield* this.lifecycle(user, serverId, { serverId, action: "delete", timing: "now", confirmName });
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  readonly #deleteNow = Effect.fn("HostedServerService.deleteNow")(
    function* (
      this: HostedServerService,
      user: AuthUser,
      serverId: string,
      confirmName: unknown,
    ): Effect.fn.Return<void, HostedFailure, HostedServerDependencies> {
      const dependencies = yield* HostedServerDependencies;
      const row = yield* hostedCall(() =>
        dependencies.database
          .prepare(`SELECT ${ROW_COLUMNS} FROM hosted_servers WHERE server_id = ? AND owner_user_id = ?`)
          .bind(serverId, user.id)
          .first<HostedServerRow>(),
      );
      if (!row || row.observed_state === "deleted") return yield* notFound();
      if (confirmName !== row.name) {
        return yield* new HostedServerServiceError(
          400,
          "hosted_server_confirm_mismatch",
          "Type the server name to delete it.",
        );
      }
      yield* this.#cancelPlans(row);
      yield* hostedCall(() =>
        dependencies.database
          .prepare("UPDATE hosted_servers SET desired_state = 'deleted', updated_at = ? WHERE server_id = ?")
          .bind(dependencies.now(), serverId)
          .run(),
      );
      this.#track(row, { name: "hosted_server_action", action: "deleted", plan: row.plan, size: row.size });
      if (dependencies.billing)
        yield* dependencies.billing.cancelServerPlans(row.owner_user_id, row.server_id).pipe(
          Effect.catch((error) =>
            Effect.sync(() => {
              console.warn("Hosted server plan cancel failed.", {
                serverId: row.server_id,
                error: safeErrorCode(error),
              });
            }),
          ),
        );
      yield* this.#finishDelete(yield* this.#requireRow(serverId));
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  readonly status = Effect.fn("HostedServerService.status")(
    function* (
      this: HostedServerService,
      user: AuthUser,
      serverId: string,
    ): Effect.fn.Return<HostedServerStatus, HostedFailure, HostedServerDependencies> {
      const row = yield* this.#requireUsableRow(user, serverId);
      return {
        serverId: row.server_id,
        state: row.observed_state,
        error: row.observed_error,
        sleeping: row.desired_state === "idle",
      };
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  readonly wake = Effect.fn("HostedServerService.wake")(
    function* (
      this: HostedServerService,
      user: AuthUser,
      serverId: string,
    ): Effect.fn.Return<HostedServerSummary, HostedFailure, HostedServerDependencies> {
      const row = yield* this.#requireUsableRow(user, serverId);
      if (row.desired_state === "stopped") {
        return yield* new HostedServerServiceError(
          402,
          "plan_required",
          "The plan of this server ended. Renew it to start the server.",
        );
      }
      yield* this.#startForUse(row);
      const current = yield* this.#requireRow(serverId);
      if (
        (current.observed_state === "running" || current.observed_state === "stopping") &&
        current.provider_sandbox_id
      ) {
        const stopFailing = yield* this.#refresh(current);
        yield* this.#startAfterFailedStop(yield* this.#requireRow(serverId), stopFailing);
      }
      return summary(yield* this.#requireRow(serverId));
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  readonly restart = Effect.fn("HostedServerService.restart")(
    function* (
      this: HostedServerService,
      user: AuthUser,
      serverId: string,
    ): Effect.fn.Return<HostedServerSummary, HostedFailure, HostedServerDependencies> {
      const dependencies = yield* HostedServerDependencies;
      const row = yield* this.#requireUsableRow(user, serverId, "admins");
      if (row.desired_state === "stopped") {
        return yield* new HostedServerServiceError(402, "plan_required", sourceText("error.billing.planRequired"));
      }
      if (row.operator_host) {
        return yield* new HostedServerServiceError(
          409,
          "hosted_server_restart_unavailable",
          sourceText("error.billing.restartUnavailable"),
        );
      }
      const sandboxId = row.provider_sandbox_id;
      const boat = dependencies.boat;
      if (row.observed_state !== "running" || !sandboxId) {
        yield* this.#startForUse(row);
        return summary(yield* this.#requireRow(serverId));
      }
      if (!boat)
        return yield* new HostedServerServiceError(503, "hosting_not_configured", "Hosting is not configured.");
      const now = dependencies.now();
      const claimed = yield* hostedCall(() =>
        dependencies.database
          .prepare(
            `UPDATE hosted_servers SET desired_state = 'running', observed_state = 'stopping', last_active_at = ?,
           updated_at = ?
         WHERE server_id = ? AND desired_state IN ('running', 'idle') AND observed_state = 'running'`,
          )
          .bind(now, now, serverId)
          .run(),
      );
      if (claimed.meta.changes !== 1) return summary(yield* this.#requireRow(serverId));
      yield* boat.stopSandbox(sandboxId).pipe(
        Effect.catch((error) =>
          Effect.gen(function* () {
            yield* hostedCall(() =>
              dependencies.database
                .prepare(
                  `UPDATE hosted_servers SET observed_state = 'running', updated_at = ?
             WHERE server_id = ? AND observed_state = 'stopping'`,
                )
                .bind(dependencies.now(), serverId)
                .run(),
            );
            if (!(error instanceof BoatApiError && error.status === 409)) return yield* error;
            return yield* new HostedServerServiceError(
              409,
              "hosted_server_restart_busy",
              sourceText("error.billing.restartBusy"),
            );
          }),
        ),
      );
      return summary(yield* this.#requireRow(serverId));
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  readonly routeState = Effect.fn("HostedServerService.routeState")(
    function* (
      this: HostedServerService,
      hostId: string,
    ): Effect.fn.Return<RouteHostState, HostedFailure, HostedServerDependencies> {
      const dependencies = yield* HostedServerDependencies;
      const row = yield* hostedCall(() =>
        dependencies.database
          .prepare(`SELECT ${ROW_COLUMNS} FROM hosted_servers WHERE server_id = ? AND desired_state != 'deleted'`)
          .bind(hostId)
          .first<HostedServerRow>(),
      );
      if (!row) return "not_hosted";
      if (row.desired_state === "stopped" || row.observed_state === "awaiting_payment") return "ended";
      return row.desired_state === "idle" ? "sleeping" : "starting";
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  readonly startForRoute = Effect.fn("HostedServerService.startForRoute")(
    function* (
      this: HostedServerService,
      hostId: string,
    ): Effect.fn.Return<void, HostedFailure, HostedServerDependencies> {
      const row = yield* this.#requireRow(hostId);
      if (row.desired_state === "stopped" || row.desired_state === "deleted") return;
      yield* this.#startForUse(row);
      const current = yield* this.#requireRow(hostId);
      if (
        (current.observed_state === "running" || current.observed_state === "stopping") &&
        current.provider_sandbox_id
      ) {
        const stopFailing = yield* this.#refresh(current);
        yield* this.#startAfterFailedStop(yield* this.#requireRow(hostId), stopFailing);
      }
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  readonly reportActivity = Effect.fn("HostedServerService.reportActivity")(
    function* (
      this: HostedServerService,
      sessionToken: string,
      serverId: string,
      report: HostedServerActivityReport,
    ): Effect.fn.Return<void, HostedFailure, HostedServerDependencies> {
      const dependencies = yield* HostedServerDependencies;
      const sessionTokenHash = yield* sha256(sessionToken).pipe(Effect.mapError(hostedFailure));
      const now = dependencies.now();
      const row = yield* hostedCall(() =>
        dependencies.database
          .prepare(
            `SELECT ${ROW_COLUMNS} FROM hosted_servers
         WHERE server_id = ? AND desired_state != 'deleted' AND auth_session_id = (
           SELECT id FROM auth_sessions WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?
         )`,
          )
          .bind(serverId, sessionTokenHash, now)
          .first<HostedServerRow>(),
      );
      if (!row) return yield* notFound();
      const reported = report.nextRunAt;
      const nextRunAt =
        reported === undefined
          ? row.next_run_at
          : reported !== null && reported > now && reported <= now + NEXT_RUN_MAX_AHEAD_MS
            ? reported
            : null;
      const active = report.inUse && row.desired_state === "running";
      if (!active && nextRunAt === row.next_run_at) return;
      yield* hostedCall(() =>
        dependencies.database
          .prepare(
            `UPDATE hosted_servers SET next_run_at = ?,
           last_active_at = CASE WHEN ? AND desired_state = 'running' THEN ? ELSE last_active_at END
         WHERE server_id = ? AND desired_state != 'deleted'`,
          )
          .bind(nextRunAt, active ? 1 : 0, now, row.server_id)
          .run(),
      );
      if (active) yield* this.#extendLease(row, now);
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  readonly redeemClaim = Effect.fn("HostedServerService.redeemClaim")(
    function* (
      this: HostedServerService,
      claim: unknown,
    ): Effect.fn.Return<HostedServerClaim, HostedFailure, HostedServerDependencies> {
      const dependencies = yield* HostedServerDependencies;
      if (!isString(claim) || claim.length < 16 || claim.length > 128) return yield* invalidClaim();
      const claimHash = yield* sha256(claim).pipe(Effect.mapError(hostedFailure));
      const now = dependencies.now();
      const row = yield* hostedCall(() =>
        dependencies.database
          .prepare(
            `SELECT server_id, name, owner_user_id, auth_session_id, operator_host FROM hosted_servers
         WHERE claim_token_hash = ? AND claim_expires_at > ? AND desired_state != 'deleted'`,
          )
          .bind(claimHash, now)
          .first<{
            server_id: string;
            name: string;
            owner_user_id: string;
            auth_session_id: string | null;
            operator_host: string | null;
          }>(),
      );
      if (!row) return yield* invalidClaim();
      const sessionId = crypto.randomUUID();
      const sessionToken = randomToken();
      const sessionTokenHash = yield* sha256(sessionToken).pipe(Effect.mapError(hostedFailure));
      const poolStart = row.operator_host
        ? yield* hostedCall(() =>
            dependencies.database
              .prepare(`SELECT ${ROW_COLUMNS} FROM hosted_servers WHERE server_id = ? AND ${POOL_FIRST_START_SQL}`)
              .bind(row.server_id)
              .first<HostedServerRow>(),
          )
        : null;
      const [redeemed] = yield* hostedCall(() =>
        dependencies.database.batch([
          dependencies.database
            .prepare(
              `UPDATE hosted_servers SET observed_state = CASE WHEN ${POOL_FIRST_START_SQL} THEN 'running' ELSE observed_state END,
             claim_redeemed_at = COALESCE(claim_redeemed_at, ?),
             claim_expires_at = MIN(claim_expires_at, ?), auth_session_id = ?, updated_at = ?
           WHERE server_id = ? AND claim_token_hash = ? AND claim_expires_at > ? AND auth_session_id IS ?`,
            )
            .bind(now, now + CLAIM_REDEEM_RETRY_MS, sessionId, now, row.server_id, claimHash, now, row.auth_session_id),
          dependencies.database
            .prepare(
              `INSERT INTO auth_sessions(id, user_id, token_hash, expires_at, created_at, last_used_at)
           SELECT ?, owner_user_id, ?, ?, ?, ? FROM hosted_servers
           WHERE server_id = ? AND auth_session_id = ?`,
            )
            .bind(sessionId, sessionTokenHash, PERSISTENT_SESSION_EXPIRES_AT, now, now, row.server_id, sessionId),
          dependencies.database
            .prepare(
              `UPDATE auth_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL
             AND EXISTS(SELECT 1 FROM hosted_servers WHERE server_id = ? AND auth_session_id = ?)`,
            )
            .bind(now, row.auth_session_id, row.server_id, sessionId),
          ...(row.operator_host
            ? [
                dependencies.database
                  .prepare(
                    `UPDATE operator_hosts SET assign_token_hash = NULL WHERE host_id = ? AND assign_token_hash IS NOT NULL
                   AND EXISTS(SELECT 1 FROM hosted_servers WHERE server_id = ? AND auth_session_id = ? AND operator_host = ?)`,
                  )
                  .bind(row.operator_host, row.server_id, sessionId, row.operator_host),
              ]
            : []),
        ]),
      );
      if (redeemed?.meta.changes !== 1) return yield* invalidClaim();
      if (poolStart) yield* this.#recordReady(poolStart, now);
      const user = yield* hostedCall(() =>
        dependencies.database
          .prepare("SELECT id, email, name, avatar_url FROM users WHERE id = ?")
          .bind(row.owner_user_id)
          .first<{ id: string; email: string; name: string | null; avatar_url: string | null }>(),
      );
      if (!user) return yield* invalidClaim();
      return {
        hostId: row.server_id,
        name: row.name,
        sessionToken,
        user: { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatar_url },
      };
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  readonly poolAssignment = Effect.fn("HostedServerService.poolAssignment")(
    function* (
      this: HostedServerService,
      hostId: unknown,
      token: unknown,
    ): Effect.fn.Return<HostedPoolAssignment, HostedFailure, HostedServerDependencies> {
      const dependencies = yield* HostedServerDependencies;
      if (!isString(hostId) || !POOL_HOST_PATTERN.test(hostId)) return yield* invalidPoolToken();
      if (!isString(token) || token.length < 32 || token.length > 128) return yield* invalidPoolToken();
      const tokenHash = yield* sha256(token).pipe(Effect.mapError(hostedFailure));
      const now = dependencies.now();
      const machine = yield* hostedCall(() =>
        dependencies.database
          .prepare("SELECT assign_token_hash, seen_at FROM operator_hosts WHERE host_id = ? AND removed_at IS NULL")
          .bind(hostId)
          .first<{ assign_token_hash: string | null; seen_at: number | null }>(),
      );
      const encoder = new TextEncoder();
      if (
        !machine?.assign_token_hash ||
        !constantTimeEqual(encoder.encode(machine.assign_token_hash), encoder.encode(tokenHash))
      )
        return yield* invalidPoolToken();
      if (machine.seen_at === null || machine.seen_at <= now - POOL_SEEN_WRITE_AFTER_MS) {
        yield* hostedCall(() =>
          dependencies.database
            .prepare("UPDATE operator_hosts SET seen_at = ? WHERE host_id = ? AND assign_token_hash = ?")
            .bind(now, hostId, tokenHash)
            .run(),
        );
      }
      const row = yield* hostedCall(() =>
        dependencies.database
          .prepare(
            `SELECT server_id, claim_token_hash FROM hosted_servers
         WHERE operator_host = ? AND desired_state = 'running' AND claim_expires_at > ? AND ${POOL_FIRST_START_SQL}`,
          )
          .bind(hostId, now)
          .first<{ server_id: string; claim_token_hash: string | null }>(),
      );
      const secret = yield* this.#claimKey();
      if (!row?.claim_token_hash || !secret) return { state: "waiting" };
      const claim = yield* hostedPoolClaim(secret, row.server_id, hostId).pipe(Effect.mapError(hostedFailure));
      const claimHash = yield* sha256(claim).pipe(Effect.mapError(hostedFailure));
      if (claimHash !== row.claim_token_hash) return { state: "waiting" };
      return { state: "assigned", serverId: row.server_id, claim };
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  readonly handleWebhook = Effect.fn("HostedServerService.handleWebhook")(
    function* (
      this: HostedServerService,
      input: { deliveryId: string; timestamp: string; signature: string; body: string },
    ): Effect.fn.Return<void, HostedFailure, HostedServerDependencies> {
      const dependencies = yield* HostedServerDependencies;
      const webhookSecret = this.#webhookSecret;
      if (!webhookSecret) {
        return yield* new HostedServerServiceError(503, "hosting_not_configured", "Hosted servers are not configured.");
      }
      const now = dependencies.now();
      const valid =
        /^[A-Za-z0-9_-]{1,128}$/u.test(input.deliveryId) &&
        (yield* verifyBoatWebhookSignature({ ...input, secret: webhookSecret, now }).pipe(
          Effect.mapError(hostedFailure),
        ));
      if (!valid)
        return yield* new HostedServerServiceError(401, "webhook_signature_invalid", "The signature is invalid.");
      const seen = yield* hostedCall(() =>
        dependencies.database
          .prepare("SELECT 1 AS seen FROM hosting_webhook_deliveries WHERE delivery_id = ?")
          .bind(input.deliveryId)
          .first<{ seen: number }>(),
      );
      if (seen) return;
      const event = parseWebhookEvent(input.body, now);
      if (event) {
        const row = yield* hostedCall(() =>
          dependencies.database
            .prepare(`SELECT ${ROW_COLUMNS} FROM hosted_servers WHERE provider_sandbox_id = ?`)
            .bind(event.sandboxId)
            .first<HostedServerRow>(),
        );
        if (row?.observed_state === "stopping" && isUsable(event.state)) yield* this.#refresh(row);
        else if (row) yield* this.#observe(row, event.state, event.createdAt);
      }
      yield* hostedCall(() =>
        dependencies.database
          .prepare(
            "INSERT INTO hosting_webhook_deliveries(delivery_id, received_at) VALUES (?, ?) ON CONFLICT DO NOTHING",
          )
          .bind(input.deliveryId, now)
          .run(),
      );
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  readonly tick = Effect.fn("HostedServerService.tick")(
    function* (
      this: HostedServerService,
      now = this.#now(),
    ): Effect.fn.Return<HostedServerTickResult, HostedFailure, HostedServerDependencies> {
      const dependencies = yield* HostedServerDependencies;
      const result: HostedServerTickResult = {
        restarted: 0,
        reconciled: 0,
        deleted: 0,
        provisioned: 0,
        stopped: 0,
        abandoned: 0,
        resized: 0,
        idle: 0,
        scheduled: 0,
        retained: 0,
        failed: 0,
      };
      yield* hostedCall(() =>
        dependencies.database
          .prepare(
            `UPDATE hosted_servers SET claim_token_hash = NULL
         WHERE claim_token_hash IS NOT NULL AND claim_expires_at <= ?`,
          )
          .bind(now)
          .run(),
      );
      yield* hostedCall(() =>
        dependencies.database
          .prepare("DELETE FROM hosting_webhook_deliveries WHERE received_at < ?")
          .bind(now - DELIVERY_RETENTION_MS)
          .run(),
      );
      const boat = dependencies.boat;
      if (!boat) return result;
      const run = <Row extends HostedServerRow>(
        rows: Row[],
        action: (row: Row) => Effect.Effect<unknown, HostedFailure, HostedServerDependencies>,
      ) =>
        Effect.gen({ self: this }, function* () {
          let done = 0;
          for (const row of rows) {
            const operationResult0 = yield* Effect.result(
              Effect.gen({ self: this }, function* () {
                yield* action(row);
                done += 1;
              }),
            );
            if (Result.isFailure(operationResult0)) {
              const error = operationResult0.failure;

              result.failed += 1;
              console.warn("Hosted server task failed.", { serverId: row.server_id, error: safeErrorCode(error) });
            }
          }
          return done;
        });
      const billing = dependencies.billing;
      if (billing) {
        yield* billing.refreshLapsedPlans(now).pipe(Effect.mapError(hostedFailure));
        const planChanged = yield* hostedCall(() =>
          dependencies.database
            .prepare(
              `SELECT ${ROW_COLUMNS} FROM hosted_servers h
           WHERE h.desired_state != 'deleted' AND h.updated_at <= ?
             AND (h.observed_state = 'awaiting_payment' OR h.desired_state = 'stopped') = EXISTS(
               SELECT 1 FROM billing_subscriptions s
               WHERE s.server_id = h.server_id AND s.user_id = h.owner_user_id
                 AND (s.status IN ('active', 'trialing') OR (s.status = 'past_due' AND s.current_period_end > ?))
             )
           LIMIT ?`,
            )
            .bind(now - STUCK_AFTER_MS, now, TICK_BATCH_SIZE)
            .all<HostedServerRow>(),
        );
        yield* run(planChanged.results, (row) =>
          Effect.gen({ self: this }, function* () {
            const change = yield* this.#applyPlan(row);
            if (change === "provisioned") result.provisioned += 1;
            if (change === "stopped") result.stopped += 1;
          }),
        );
        const abandoned = yield* hostedCall(() =>
          dependencies.database
            .prepare(
              `SELECT ${ROW_COLUMNS} FROM hosted_servers
           WHERE observed_state = 'awaiting_payment' AND desired_state = 'running' AND updated_at <= ?
             AND NOT EXISTS(
               SELECT 1 FROM billing_subscriptions s
               WHERE s.server_id = hosted_servers.server_id AND s.status IN ${OPEN_STATUSES_SQL}
             )
           LIMIT ?`,
            )
            .bind(now - UNPAID_RETENTION_MS, TICK_BATCH_SIZE)
            .all<HostedServerRow>(),
        );
        yield* run(abandoned.results, (row) =>
          Effect.gen({ self: this }, function* () {
            if (yield* this.#removeUnpaid(row, now)) result.abandoned += 1;
          }),
        );
        const failedSetups = yield* hostedCall(() =>
          dependencies.database
            .prepare(
              `SELECT ${ROW_COLUMNS} FROM hosted_servers
           WHERE desired_state = 'running' AND observed_state = 'error' AND provider_sandbox_id IS NULL
             AND operator_host IS NULL AND updated_at <= ? LIMIT ?`,
            )
            .bind(now - SETUP_RETRY_AFTER_MS, TICK_BATCH_SIZE)
            .all<HostedServerRow>(),
        );
        yield* run(failedSetups.results, (row) =>
          Effect.gen({ self: this }, function* () {
            if (yield* this.#retrySetup(row)) result.provisioned += 1;
          }),
        );
      }
      yield* hostedCall(() =>
        dependencies.database
          .prepare(
            `UPDATE hosted_servers SET observed_state = 'error', observed_error = 'provider_error', claim_token_hash = NULL,
           updated_at = ?
         WHERE observed_state = 'creating' AND provider_sandbox_id IS NULL AND updated_at <= ?`,
          )
          .bind(now, now - CREATE_LOST_AFTER_MS)
          .run(),
      );
      const lostPoolStarts = yield* hostedCall(() =>
        dependencies.database
          .prepare(
            `SELECT ${ROW_COLUMNS} FROM hosted_servers
         WHERE desired_state != 'deleted' AND start_requested_at <= ? AND ${POOL_FIRST_START_SQL} LIMIT ?`,
          )
          .bind(now - POOL_START_LOST_AFTER_MS, TICK_BATCH_SIZE)
          .all<HostedServerRow>(),
      );
      yield* run(lostPoolStarts.results, (row) =>
        Effect.gen({ self: this }, function* () {
          if (yield* this.#leavePoolMachine(row)) result.provisioned += 1;
        }),
      );
      const unused = yield* hostedCall(() =>
        dependencies.database
          .prepare(
            `SELECT ${ROW_COLUMNS} FROM hosted_servers
         WHERE desired_state = 'running' AND observed_state = 'running' AND provider_sandbox_id IS NOT NULL
           AND COALESCE(last_active_at, 0) <= ? AND updated_at <= ?
           AND (next_run_at IS NULL OR next_run_at <= ? OR next_run_at > ?) LIMIT ?`,
          )
          .bind(now - IDLE_STOP_AFTER_MS, now - IDLE_STOP_AFTER_MS, now, now + SCHEDULE_WAKE_BEFORE_MS, TICK_BATCH_SIZE)
          .all<HostedServerRow>(),
      );
      result.idle = yield* run(unused.results, (row) => this.#stopIdle(row, now));
      const scheduled = yield* hostedCall(() =>
        dependencies.database
          .prepare(
            `SELECT ${ROW_COLUMNS} FROM hosted_servers
         WHERE desired_state = 'idle' AND observed_state = 'stopped' AND next_run_at <= ? LIMIT ?`,
          )
          .bind(now + SCHEDULE_WAKE_BEFORE_MS, TICK_BATCH_SIZE)
          .all<HostedServerRow>(),
      );
      result.scheduled = yield* run(scheduled.results, (row) => this.#wakeForSchedule(row, now));
      if (new Date(now).getUTCMinutes() % RETENTION_WAKE_EVERY_MINUTES === 0) {
        const expiring = yield* hostedCall(() =>
          dependencies.database
            .prepare(
              `SELECT ${ROW_COLUMNS} FROM hosted_servers
           WHERE desired_state = 'idle' AND observed_state = 'stopped' AND provider_sandbox_id IS NOT NULL
             AND last_active_at > ? AND last_active_at <= ?
             AND (deletion_scheduled_at IS NULL OR deletion_scheduled_at > ?)
           ORDER BY updated_at LIMIT 1`,
            )
            .bind(now - RETENTION_DISK_KEPT_MS, now - RETENTION_WAKE_AFTER_MS, now)
            .all<HostedServerRow>(),
        );
        result.retained = yield* run(expiring.results, (row) => this.#wakeForRetention(row, now));
      }
      const unstopped = yield* hostedCall(() =>
        dependencies.database
          .prepare(
            `SELECT ${ROW_COLUMNS} FROM hosted_servers
         WHERE desired_state IN ('idle', 'stopped') AND provider_sandbox_id IS NOT NULL
           AND observed_state IN ('starting', 'running', 'waking') AND updated_at <= ? LIMIT ?`,
          )
          .bind(now - STUCK_AFTER_MS, TICK_BATCH_SIZE)
          .all<HostedServerRow>(),
      );
      result.stopped += yield* run(unstopped.results, (row) => this.#stop(row));
      const stopped = yield* hostedCall(() =>
        dependencies.database
          .prepare(
            `SELECT ${ROW_COLUMNS} FROM hosted_servers
         WHERE desired_state = 'running' AND observed_state = 'stopped' AND operator_host IS NULL
           AND updated_at <= ? LIMIT ?`,
          )
          .bind(now - STUCK_AFTER_MS, TICK_BATCH_SIZE)
          .all<HostedServerRow>(),
      );
      result.restarted = yield* run(stopped.results, (row) => this.#wake(row, "restart"));
      const rateLimited = yield* hostedCall(() =>
        dependencies.database
          .prepare(
            `SELECT ${ROW_COLUMNS} FROM hosted_servers
         WHERE desired_state = 'running' AND provider_sandbox_id IS NOT NULL AND observed_state = 'waking'
           AND observed_error = 'provider_limit'
           AND updated_at + MIN(?, MAX(?, updated_at - COALESCE(provider_event_at, updated_at))) <= ? LIMIT ?`,
          )
          .bind(RATE_LIMIT_RETRY_MAX_MS, RATE_LIMIT_RETRY_MIN_MS, now, TICK_BATCH_SIZE)
          .all<HostedServerRow>(),
      );
      result.restarted += yield* run(rateLimited.results, (row) => this.#wake(row, "restart"));
      const stuck = yield* hostedCall(() =>
        dependencies.database
          .prepare(
            `SELECT ${ROW_COLUMNS} FROM hosted_servers
         WHERE desired_state != 'deleted' AND provider_sandbox_id IS NOT NULL
           AND observed_state IN ('starting', 'stopping', 'waking')
           AND NOT (observed_state = 'waking' AND observed_error IS 'provider_limit') AND updated_at <= ? LIMIT ?`,
          )
          .bind(now - STUCK_AFTER_MS, TICK_BATCH_SIZE)
          .all<HostedServerRow>(),
      );
      result.reconciled = yield* run(stuck.results, (row) => this.#refresh(row));
      const resizing = yield* hostedCall(() =>
        dependencies.database
          .prepare(
            `SELECT ${ROW_COLUMNS} FROM hosted_servers
         WHERE desired_state = 'running' AND observed_state = 'running' AND pending_size IS NOT NULL
           AND provider_sandbox_id IS NOT NULL AND updated_at <= ? AND COALESCE(last_active_at, 0) <= ? LIMIT ?`,
          )
          .bind(now - STUCK_AFTER_MS, now - RESIZE_AFTER_NO_USE_MS, TICK_BATCH_SIZE)
          .all<HostedServerRow>(),
      );
      result.resized = yield* run(resizing.results, (row) => this.#resize(row));
      const scheduledDeletes = yield* hostedCall(() =>
        dependencies.database
          .prepare(
            `SELECT ${ROW_COLUMNS} FROM hosted_servers WHERE desired_state != 'deleted' AND deletion_scheduled_at <= ? LIMIT ?`,
          )
          .bind(now, TICK_BATCH_SIZE)
          .all<HostedServerRow>(),
      );
      yield* run(scheduledDeletes.results, (row) => this.#deleteScheduled(row));
      yield* hostedCall(() =>
        dependencies.database
          .prepare(
            "UPDATE hosted_servers SET plan_ended_at = ? WHERE desired_state = 'stopped' AND plan_ended_at IS NULL",
          )
          .bind(now)
          .run(),
      );
      const expired = yield* hostedCall(() =>
        dependencies.database
          .prepare(
            `SELECT ${ROW_COLUMNS}, plan_ended_at FROM hosted_servers
         WHERE operator_host IS NOT NULL AND desired_state = 'stopped' AND plan_ended_at <= ?
           AND EXISTS(SELECT 1 FROM billing_subscriptions s WHERE s.server_id = hosted_servers.server_id)
           AND NOT EXISTS(SELECT 1 FROM billing_subscriptions s WHERE s.server_id = hosted_servers.server_id
             AND s.status IN ${OPEN_STATUSES_SQL})
         ORDER BY plan_ended_at LIMIT ?`,
          )
          .bind(now - OPERATOR_HOST_DATA_KEPT_MS, TICK_BATCH_SIZE)
          .all<HostedServerRow & { plan_ended_at: number }>(),
      );
      yield* run(expired.results, (row) => this.#deleteExpired(row));
      const deleting = yield* hostedCall(() =>
        dependencies.database
          .prepare(
            `SELECT ${ROW_COLUMNS} FROM hosted_servers
         WHERE desired_state = 'deleted' AND observed_state != 'deleted' LIMIT ?`,
          )
          .bind(TICK_BATCH_SIZE)
          .all<HostedServerRow>(),
      );
      result.deleted = yield* run(deleting.results, (row) => this.#finishDelete(row));
      return result;
    },
    (operation, _now?: number) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  readonly #checkout = Effect.fn("HostedServerService.checkout")(function* (
    this: HostedServerService,
    row: HostedServerRow,
    user: AuthUser,
    billing: HostedServerBilling,
    returnTo: CheckoutReturn,
    order?: CheckoutOrder | "previous",
  ): Effect.fn.Return<HostedServerCheckout, HostedFailure, HostedServerDependencies> {
    const dependencies = yield* HostedServerDependencies;
    if (row.deletion_scheduled_at !== null) return yield* lifecycleFailure();
    const awaiting = row.observed_state === "awaiting_payment" && row.desired_state === "running";
    const ended = row.desired_state === "stopped";
    if (!awaiting && !ended) return { server: summary(row), checkoutUrl: null };
    if (ended && (yield* this.#openPlanExists(row))) {
      return yield* new HostedServerServiceError(
        409,
        "hosted_server_payment_due",
        "Update the payment method in Billing.",
      );
    }
    const previous = row.checkout_session_id;
    const closed = previous ? yield* billing.closeCheckout(previous).pipe(Effect.mapError(hostedFailure)) : null;
    if (closed?.status === "paid") {
      return { server: summary(yield* this.#requireRow(row.server_id)), checkoutUrl: null };
    }
    if (awaiting && SOLD_OUT_PLANS.has(row.plan)) return yield* planSoldOut();
    const chosen = order === "previous" ? closed : order;
    const license = chosen?.license;
    const earlyStartAt = chosen?.earlyStartAt;
    const session = yield* billing
      .createCheckout({
        user: { id: user.id, email: user.email },
        serverId: row.server_id,
        plan: row.plan,
        interval: row.billing_interval,
        currency: row.currency,
        target: returnTo.target,
        origin: returnTo.origin,
        ...(returnTo.entryPoint ? { entryPoint: returnTo.entryPoint } : {}),
        ...(returnTo.promotionCode ? { promotionCode: returnTo.promotionCode } : {}),
        ...(license ? { license } : {}),
        ...(earlyStartAt != null ? { earlyStartAt } : {}),
      })
      .pipe(Effect.mapError(hostedFailure));
    const stored = yield* hostedCall(() =>
      dependencies.database
        .prepare(
          `UPDATE hosted_servers SET checkout_session_id = ?, updated_at = ?
         WHERE server_id = ? AND checkout_session_id IS ? AND idempotency_key = ?
           AND ((observed_state = 'awaiting_payment' AND desired_state = 'running') OR desired_state = 'stopped')`,
        )
        .bind(session.sessionId, dependencies.now(), row.server_id, previous, row.idempotency_key)
        .run(),
    );
    if (stored.meta.changes !== 1) {
      yield* this.#closeCheckout(session.sessionId);
      return yield* new HostedServerServiceError(409, "hosted_server_conflict", "Try the request again.");
    }
    return { server: summary(yield* this.#requireRow(row.server_id)), checkoutUrl: session.url };
  });

  readonly #reuseUnpaid = Effect.fn("HostedServerService.reuseUnpaid")(function* (
    this: HostedServerService,
    row: HostedServerRow,
    choice: { plan: BillingPlanId; interval: BillingInterval; currency: BillingCurrency },
    idempotencyKey: string,
    user: AuthUser,
    billing: HostedServerBilling,
    returnTo: CheckoutReturn,
    order: CheckoutOrder,
  ): Effect.fn.Return<HostedServerCheckout, HostedFailure, HostedServerDependencies> {
    const dependencies = yield* HostedServerDependencies;
    const previous = row.checkout_session_id;
    if (previous && (yield* billing.closeCheckout(previous).pipe(Effect.mapError(hostedFailure))).status === "paid") {
      yield* hostedCall(() =>
        dependencies.database
          .prepare("UPDATE OR IGNORE hosted_servers SET idempotency_key = ? WHERE server_id = ?")
          .bind(idempotencyKey, row.server_id)
          .run(),
      );
      return { server: summary(yield* this.#requireRow(row.server_id)), checkoutUrl: null };
    }
    const updated = yield* hostedCall(() =>
      dependencies.database
        .prepare(
          `UPDATE hosted_servers SET plan = ?, size = ?, billing_interval = ?, currency = ?, idempotency_key = ?,
           checkout_session_id = NULL, updated_at = ?
         WHERE server_id = ? AND checkout_session_id IS ? AND idempotency_key = ?
           AND observed_state = 'awaiting_payment' AND desired_state = 'running'`,
        )
        .bind(
          choice.plan,
          HOSTED_PLAN_SIZE[choice.plan],
          choice.interval,
          choice.currency,
          idempotencyKey,
          dependencies.now(),
          row.server_id,
          previous,
          row.idempotency_key,
        )
        .run(),
    );
    const claimed = yield* this.#requireRow(row.server_id);
    if (updated.meta.changes !== 1 || claimed.idempotency_key !== idempotencyKey)
      return yield* new HostedServerServiceError(409, "hosted_server_conflict", "Try the request again.");
    return yield* this.#checkout(claimed, user, billing, returnTo, order);
  });

  readonly #followPlan = Effect.fn("HostedServerService.followPlan")(function* (
    this: HostedServerService,
    row: HostedServerRow,
    sync: SubscriptionSync,
  ): Effect.fn.Return<void, HostedFailure, HostedServerDependencies> {
    const dependencies = yield* HostedServerDependencies;
    if (row.plan === sync.plan && row.billing_interval === sync.interval && row.currency === sync.currency) return;
    const size = HOSTED_PLAN_SIZE[sync.plan];
    const boatSize = HOSTED_BOAT_PLAN_SIZE[sync.plan];
    yield* hostedCall(() =>
      dependencies.database
        .prepare(
          `UPDATE hosted_servers SET plan = ?, billing_interval = ?, currency = ?,
           size = CASE WHEN provider_template IS NULL OR operator_host IS NOT NULL THEN ? ELSE size END,
           pending_size = CASE WHEN provider_template IS NULL OR operator_host IS NOT NULL OR size = ? THEN NULL
             ELSE ? END, updated_at = ?
         WHERE server_id = ? AND desired_state != 'deleted'`,
        )
        .bind(sync.plan, sync.interval, sync.currency, size, boatSize, boatSize, dependencies.now(), row.server_id)
        .run(),
    );
    if (row.provider_sandbox_id) yield* this.#rename({ ...row, plan: sync.plan }, row.provider_sandbox_id);
  });

  readonly #followStorage = Effect.fn("HostedServerService.followStorage")(function* (
    this: HostedServerService,
    row: HostedServerRow,
    sync: SubscriptionSync,
  ): Effect.fn.Return<void, HostedFailure, HostedServerDependencies> {
    const dependencies = yield* HostedServerDependencies;
    if (storageTierOf(row.storage_tier) === sync.storageTier) return;
    yield* hostedCall(() =>
      dependencies.database
        .prepare(
          `UPDATE hosted_servers SET storage_tier = ?, updated_at = ?
         WHERE server_id = ? AND storage_tier != ? AND desired_state != 'deleted'`,
        )
        .bind(sync.storageTier, dependencies.now(), row.server_id, sync.storageTier)
        .run(),
    );
  });

  readonly #resize = Effect.fn("HostedServerService.resize")(function* (
    this: HostedServerService,
    row: HostedServerRow,
  ): Effect.fn.Return<void, HostedFailure, HostedServerDependencies> {
    const dependencies = yield* HostedServerDependencies;
    const sandboxId = row.provider_sandbox_id;
    const boat = dependencies.boat;
    if (!boat || !sandboxId || !row.pending_size) return;
    const now = dependencies.now();
    const claimed = yield* hostedCall(() =>
      dependencies.database
        .prepare(
          `UPDATE hosted_servers SET observed_state = 'stopping', updated_at = ?
         WHERE server_id = ? AND desired_state = 'running' AND observed_state = 'running'
           AND pending_size IS NOT NULL AND COALESCE(last_active_at, 0) <= ? AND operator_host IS NULL`,
        )
        .bind(now, row.server_id, now - RESIZE_AFTER_NO_USE_MS)
        .run(),
    );
    if (claimed.meta.changes !== 1) return;
    return yield* boat.stopSandbox(sandboxId).pipe(
      Effect.catch((error) =>
        Effect.gen({ self: this }, function* () {
          if (error instanceof BoatApiError && error.status === 409) {
            yield* hostedCall(() =>
              dependencies.database
                .prepare(
                  `UPDATE hosted_servers SET observed_state = 'running', updated_at = ?
             WHERE server_id = ? AND observed_state = 'stopping'`,
                )
                .bind(dependencies.now(), row.server_id)
                .run(),
            );
            return;
          }
          return yield* error;
        }),
      ),
    );
  });

  readonly #applyPlan = Effect.fn("HostedServerService.applyPlan")(function* (
    this: HostedServerService,
    row: HostedServerRow,
  ): Effect.fn.Return<"provisioned" | "renewed" | "stopped" | null, HostedFailure, HostedServerDependencies> {
    const dependencies = yield* HostedServerDependencies;
    if (row.desired_state === "deleted") return null;
    const entitlement = yield* getServerEntitlement(dependencies.database, row.server_id, dependencies.now()).pipe(
      Effect.mapError(hostedFailure),
    );
    if (entitlement) {
      if (row.observed_state === "awaiting_payment") {
        yield* this.#provision(row);
        return "provisioned";
      }
      if (row.desired_state === "stopped") {
        yield* this.#renew(row);
        return "renewed";
      }
      return null;
    }
    if (
      (row.desired_state === "running" || row.desired_state === "idle") &&
      row.observed_state !== "awaiting_payment"
    ) {
      yield* this.#endPlan(row);
      return "stopped";
    }
    return null;
  });

  readonly #provision = Effect.fn("HostedServerService.provision")(function* (
    this: HostedServerService,
    row: HostedServerRow,
    pool = true,
    boatReason: string | null = null,
  ): Effect.fn.Return<void, HostedFailure, HostedServerDependencies> {
    const dependencies = yield* HostedServerDependencies;
    if (row.operator_host) return;
    const secret = yield* this.#claimKey();
    if (pool && secret) {
      const assigned = yield* this.#assignPoolMachine(row, secret).pipe(
        Effect.catch((error) =>
          Effect.sync(() => {
            console.warn("Hosted server pool assignment failed.", {
              serverId: row.server_id,
              error: safeErrorCode(error),
            });
            return "the pool query failed";
          }),
        ),
      );
      if (assigned === true) return;
      boatReason = assigned;
    }
    const boat = dependencies.boat;
    const template = this.#template;
    if (!boat || !template || !secret) {
      return yield* new HostedServerServiceError(503, "hosting_not_configured", "Hosted servers are not configured.");
    }
    const claim = yield* hostedClaim(secret, row.server_id).pipe(Effect.mapError(hostedFailure));
    const claimHash = yield* sha256(claim).pipe(Effect.mapError(hostedFailure));
    const from = row.provider_template ?? template;
    const size = row.provider_template ? row.size : HOSTED_BOAT_PLAN_SIZE[row.plan];
    const now = dependencies.now();
    const claimed = yield* hostedCall(() =>
      dependencies.database
        .prepare(
          `UPDATE hosted_servers SET observed_state = 'creating', last_wake_reason = 'create', start_requested_at = ?,
           claim_token_hash = CASE WHEN ${CLAIM_OPEN_SQL} THEN ? ELSE claim_token_hash END,
           claim_expires_at = CASE WHEN ${CLAIM_OPEN_SQL} THEN ? ELSE claim_expires_at END,
           claim_redeemed_at = CASE WHEN ${CLAIM_OPEN_SQL} THEN NULL ELSE claim_redeemed_at END,
           size = CASE WHEN provider_template IS NULL THEN ? ELSE size END,
           provider_template = COALESCE(provider_template, ?), checkout_session_id = NULL, provider_event_at = ?,
           last_active_at = ?, lease_until = ?, updated_at = ?
         WHERE server_id = ? AND observed_state = 'awaiting_payment' AND desired_state = 'running'
           AND operator_host IS NULL`,
        )
        .bind(
          now,
          claimHash,
          now + CLAIM_TTL_MS,
          size,
          from,
          now,
          now,
          now + LEASE_TTL_SECONDS * 1000,
          now,
          row.server_id,
        )
        .run(),
    );
    if (claimed.meta.changes !== 1) return;
    if (boatReason) yield* this.#alertBoatStart(row, boatReason);
    const request = createRequest({ ...row, size }, from, claim);
    return yield* Effect.gen({ self: this }, function* () {
      const sandbox = yield* boat.createSandbox(request).pipe(
        Effect.catch((error) => {
          if (error instanceof BoatApiError && error.code === "network_error") return boat.createSandbox(request);
          return Effect.fail(error);
        }),
      );
      const stored = yield* hostedCall(() =>
        dependencies.database
          .prepare(
            `UPDATE hosted_servers SET provider_sandbox_id = ?, observed_state = ?, updated_at = ?
           WHERE server_id = ? AND observed_state = 'creating'`,
          )
          .bind(sandbox.id, isUsable(sandbox.state) ? "running" : "starting", dependencies.now(), row.server_id)
          .run(),
      );
      if (stored.meta.changes !== 1 && !(yield* this.#adopt(row, sandbox, claim))) {
        console.warn("Hosted server sandbox has no row.", { serverId: row.server_id });
        yield* boat.deleteSandbox(sandbox.id).pipe(
          Effect.catch((error) =>
            Effect.sync(() => {
              console.warn("Hosted server sandbox delete failed.", {
                serverId: row.server_id,
                error: safeErrorCode(error),
              });
            }),
          ),
        );
        return;
      }
      this.#track(row, {
        name: "hosted_server_action",
        action: "provisioned",
        plan: row.plan,
        size,
        machine: "boat",
      });
      if (stored.meta.changes === 1 && isUsable(sandbox.state))
        yield* this.#recordReady({ ...row, last_wake_reason: "create", start_requested_at: now }, dependencies.now());
      yield* this.#rename(row, sandbox.id);
    }).pipe(
      Effect.catch((error) =>
        Effect.gen({ self: this }, function* () {
          console.warn("Hosted server provisioning failed.", { serverId: row.server_id, error: safeErrorCode(error) });
          const failed = providerError(error);
          yield* hostedCall(() =>
            dependencies.database
              .prepare(
                `UPDATE hosted_servers SET observed_state = 'error', observed_error = ?, claim_token_hash = NULL, updated_at = ?
           WHERE server_id = ? AND observed_state = 'creating' AND provider_sandbox_id IS NULL`,
              )
              .bind(failed, dependencies.now(), row.server_id)
              .run(),
          );
          this.#track(row, {
            name: "hosted_server_action",
            action: "setup_failed",
            plan: row.plan,
            error: failed,
            machine: "boat",
          });
        }),
      ),
    );
  });

  readonly #assignPoolMachine = Effect.fn("HostedServerService.assignPoolMachine")(function* (
    this: HostedServerService,
    row: HostedServerRow,
    secret: string,
  ): Effect.fn.Return<true | string | null, HostedFailure, HostedServerDependencies> {
    const dependencies = yield* HostedServerDependencies;
    if (row.provider_template || row.provider_sandbox_id) return null;
    const now = dependencies.now();
    const seenAfter = now - POOL_SEEN_WITHIN_MS;
    const locations = poolLocations(row.currency);
    const candidates = yield* hostedCall(() =>
      dependencies.database
        .prepare(
          `SELECT o.host_id, o.location FROM operator_hosts o
         WHERE o.removed_at IS NULL AND o.product = ? AND o.assign_token_hash IS NOT NULL AND o.seen_at > ?
           AND o.location IN (${locations.map(() => "?").join(", ")})
           AND NOT EXISTS(SELECT 1 FROM hosted_servers h WHERE h.operator_host = o.host_id)
         ORDER BY (o.location = ?) DESC, o.added_at, o.host_id LIMIT ?`,
        )
        .bind(POOL_PRODUCT_OF_PLAN[row.plan], seenAfter, ...locations, locations[0], POOL_CANDIDATES)
        .all<{ host_id: string; location: string }>(),
    );
    for (const { host_id: hostId, location } of candidates.results) {
      const claim = yield* hostedPoolClaim(secret, row.server_id, hostId).pipe(Effect.mapError(hostedFailure));
      const claimHash = yield* sha256(claim).pipe(Effect.mapError(hostedFailure));
      const assigned = yield* hostedCall(() =>
        dependencies.database
          .prepare(
            `UPDATE hosted_servers SET operator_host = ?, observed_state = 'starting', last_wake_reason = 'create',
             start_requested_at = ?, claim_token_hash = ?, claim_expires_at = ?, claim_redeemed_at = NULL,
             checkout_session_id = NULL, provider_event_at = ?, last_active_at = ?, updated_at = ?
           WHERE server_id = ? AND observed_state = 'awaiting_payment' AND desired_state = 'running'
             AND operator_host IS NULL AND provider_sandbox_id IS NULL AND provider_template IS NULL
             AND retired_sandbox_id IS NULL AND ${CLAIM_OPEN_SQL}
             AND EXISTS(SELECT 1 FROM operator_hosts o WHERE o.host_id = ? AND o.removed_at IS NULL
               AND o.assign_token_hash IS NOT NULL AND o.seen_at > ?)
             AND NOT EXISTS(SELECT 1 FROM hosted_servers h WHERE h.operator_host = ?)`,
          )
          .bind(hostId, now, claimHash, now + CLAIM_TTL_MS, now, now, now, row.server_id, hostId, seenAfter, hostId)
          .run(),
      );
      if (assigned.meta.changes !== 1) continue;
      this.#track(row, {
        name: "hosted_server_action",
        action: "provisioned",
        plan: row.plan,
        size: row.size,
        machine: "pool",
      });
      yield* this.#alertLowPool(POOL_PRODUCT_OF_PLAN[row.plan], location, seenAfter);
      return true;
    }
    return `no ready ${POOL_PRODUCT_OF_PLAN[row.plan]} in ${locations.join(", ")}`;
  });

  #alertBoatStart(row: HostedServerRow, reason: string): Effect.Effect<void, never, HostedServerDependencies> {
    return this.#alertPool(
      `⛵ **Boat start** · ${row.plan} server · ${row.currency} · ${row.server_id.slice(0, 8)} · ${reason}`,
    );
  }

  readonly #alertLowPool = Effect.fn("HostedServerService.alertLowPool")(function* (
    this: HostedServerService,
    product: string,
    location: string,
    seenAfter: number,
  ): Effect.fn.Return<void, never, HostedServerDependencies> {
    if (!this.#poolAlert) return;
    const dependencies = yield* HostedServerDependencies;
    const free = yield* hostedCall(() =>
      dependencies.database
        .prepare(
          `SELECT count(*) AS n FROM operator_hosts o
         WHERE o.removed_at IS NULL AND o.product = ? AND o.location = ? AND o.assign_token_hash IS NOT NULL
           AND o.seen_at > ? AND NOT EXISTS(SELECT 1 FROM hosted_servers h WHERE h.operator_host = o.host_id)`,
        )
        .bind(product, location, seenAfter)
        .first<{ n: number }>(),
    ).pipe(
      Effect.map((result) => result?.n ?? null),
      Effect.catch(() =>
        Effect.sync(() => {
          console.warn("Hosted pool count failed.");
          return null;
        }),
      ),
    );
    if (free === null || free > LOW_POOL_FREE) return;
    yield* this.#alertPool(`${free === 0 ? "🔴" : "🟠"} **Pool** ${location} ${product} · ${free} free left`);
  });

  readonly #alertPool = Effect.fn("HostedServerService.alertPool")(function* (
    this: HostedServerService,
    text: string,
  ): Effect.fn.Return<void, never, HostedServerDependencies> {
    if (!this.#poolAlert) return;
    const dependencies = yield* HostedServerDependencies;
    dependencies.schedule(this.#poolAlert(text));
  });

  readonly #leavePoolMachine = Effect.fn("HostedServerService.leavePoolMachine")(function* (
    this: HostedServerService,
    row: HostedServerRow,
  ): Effect.fn.Return<boolean, HostedFailure, HostedServerDependencies> {
    const dependencies = yield* HostedServerDependencies;
    const hostId = row.operator_host;
    if (!hostId) return false;
    const now = dependencies.now();
    const [left] = yield* hostedCall(() =>
      dependencies.database.batch([
        dependencies.database
          .prepare(
            `UPDATE hosted_servers SET operator_host = NULL,
             observed_state = CASE WHEN desired_state = 'running' THEN 'awaiting_payment' ELSE 'error' END,
             claim_token_hash = NULL, start_requested_at = NULL, updated_at = ?
           WHERE server_id = ? AND operator_host = ? AND desired_state != 'deleted' AND ${POOL_FIRST_START_SQL}`,
          )
          .bind(now, row.server_id, hostId),
        dependencies.database
          .prepare(
            `UPDATE operator_hosts SET assign_token_hash = NULL WHERE host_id = ?
             AND NOT EXISTS(SELECT 1 FROM hosted_servers h WHERE h.operator_host = ?)`,
          )
          .bind(hostId, hostId),
      ]),
    );
    if (left?.meta.changes !== 1) return false;
    console.warn("Hosted server left its pool machine.", { serverId: row.server_id });
    this.#track(row, {
      name: "hosted_server_action",
      action: "setup_failed",
      plan: row.plan,
      error: "start_failed",
      machine: "pool",
    });
    const current = yield* this.#requireRow(row.server_id);
    yield* this.#alertPool(
      `🛠️ **Pool start lost** · ${row.plan} server · ${row.server_id.slice(0, 8)} · machine ${hostId} · prepare it again`,
    );
    if (current.observed_state !== "awaiting_payment") return false;
    yield* this.#provision(current, false, `pool machine ${hostId} did not start it`);
    return true;
  });

  readonly #adopt = Effect.fn("HostedServerService.adopt")(function* (
    this: HostedServerService,
    row: HostedServerRow,
    sandbox: { id: string; state: BoatSandboxState },
    claim: string,
  ): Effect.fn.Return<boolean, HostedFailure, HostedServerDependencies> {
    const dependencies = yield* HostedServerDependencies;
    const claimHash = yield* sha256(claim).pipe(Effect.mapError(hostedFailure));
    const now = dependencies.now();
    const adopted = yield* hostedCall(() =>
      dependencies.database
        .prepare(
          `UPDATE hosted_servers SET provider_sandbox_id = ?, observed_state = ?,
           observed_error = CASE WHEN observed_error = 'plan_ended' THEN observed_error ELSE NULL END,
           claim_token_hash = CASE WHEN ${CLAIM_OPEN_SQL} THEN ? ELSE claim_token_hash END,
           claim_expires_at = CASE WHEN ${CLAIM_OPEN_SQL} THEN ? ELSE claim_expires_at END, updated_at = ?
         WHERE server_id = ? AND observed_state = 'error' AND provider_sandbox_id IS NULL AND desired_state != 'deleted'`,
        )
        .bind(
          sandbox.id,
          isUsable(sandbox.state) ? "running" : "starting",
          claimHash,
          now + CLAIM_TTL_MS,
          now,
          row.server_id,
        )
        .run(),
    );
    return adopted.meta.changes === 1;
  });

  readonly #rename = Effect.fn("HostedServerService.rename")(function* (
    this: HostedServerService,
    row: HostedServerRow,
    sandboxId: string,
  ): Effect.fn.Return<void, HostedFailure, HostedServerDependencies> {
    const dependencies = yield* HostedServerDependencies;
    const boat = dependencies.boat;
    if (!boat) return;
    return yield* Effect.gen({ self: this }, function* () {
      const owner = yield* hostedCall(() =>
        dependencies.database
          .prepare("SELECT email FROM users WHERE id = ?")
          .bind(row.owner_user_id)
          .first<{ email: string }>(),
      );
      if (!owner) return;
      yield* boat.renameSandbox(sandboxId, sandboxName(row.plan, owner.email, row.server_id));
    }).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          console.warn("Hosted server rename failed.", { serverId: row.server_id, error: safeErrorCode(error) });
        }),
      ),
    );
  });

  readonly #removeUnpaid = Effect.fn("HostedServerService.removeUnpaid")(function* (
    this: HostedServerService,
    row: HostedServerRow,
    now: number,
  ): Effect.fn.Return<boolean, HostedFailure, HostedServerDependencies> {
    const dependencies = yield* HostedServerDependencies;
    const checkoutId = row.checkout_session_id;
    if (
      checkoutId &&
      dependencies.billing &&
      (yield* dependencies.billing.closeCheckout(checkoutId).pipe(Effect.mapError(hostedFailure))).status === "paid"
    ) {
      return false;
    }
    const removed = yield* hostedCall(() =>
      dependencies.database
        .prepare(
          `UPDATE hosted_servers SET desired_state = 'deleted', observed_state = 'deleted', checkout_session_id = NULL,
           deleted_at = ?, updated_at = ?
         WHERE server_id = ? AND observed_state = 'awaiting_payment' AND desired_state = 'running'
           AND checkout_session_id IS ?`,
        )
        .bind(now, now, row.server_id, checkoutId)
        .run(),
    );
    return removed.meta.changes === 1;
  });

  readonly #refresh = Effect.fn("HostedServerService.refresh")(function* (
    this: HostedServerService,
    row: HostedServerRow,
  ): Effect.fn.Return<boolean, HostedFailure, HostedServerDependencies> {
    const dependencies = yield* HostedServerDependencies;
    const boat = dependencies.boat;
    const sandboxId = row.provider_sandbox_id;
    if (!boat || !sandboxId) return false;
    const readAt = dependencies.now();
    const sandbox = yield* boat.getSandbox(sandboxId).pipe(
      Effect.map((value) => ({ state: value.state, stopFailing: value.stopFailing })),
      Effect.catch((error) =>
        error.status === 404 ? Effect.succeed({ state: "cancelled" as const, stopFailing: false }) : Effect.fail(error),
      ),
    );
    return yield* this.#observe(row, sandbox.state, readAt, sandbox.stopFailing);
  });

  readonly #retrySetup = Effect.fn("HostedServerService.retrySetup")(function* (
    this: HostedServerService,
    row: HostedServerRow,
  ): Effect.fn.Return<boolean, HostedFailure, HostedServerDependencies> {
    const dependencies = yield* HostedServerDependencies;
    if (row.desired_state !== "running" || row.observed_state !== "error" || row.provider_sandbox_id) return false;
    if (row.operator_host) return false;
    if (
      !(yield* getServerEntitlement(dependencies.database, row.server_id, dependencies.now()).pipe(
        Effect.mapError(hostedFailure),
      ))
    )
      return false;
    const reset = yield* hostedCall(() =>
      dependencies.database
        .prepare(
          `UPDATE hosted_servers SET observed_state = 'awaiting_payment', observed_error = NULL, updated_at = ?
         WHERE server_id = ? AND desired_state = 'running' AND observed_state = 'error' AND provider_sandbox_id IS NULL
           AND operator_host IS NULL`,
        )
        .bind(dependencies.now(), row.server_id)
        .run(),
    );
    if (reset.meta.changes !== 1) return false;
    yield* this.#provision(yield* this.#requireRow(row.server_id));
    return true;
  });

  readonly #renew = Effect.fn("HostedServerService.renew")(function* (
    this: HostedServerService,
    row: HostedServerRow,
  ): Effect.fn.Return<void, HostedFailure, HostedServerDependencies> {
    const dependencies = yield* HostedServerDependencies;
    if (!row.provider_sandbox_id && !row.operator_host) {
      const reset = yield* hostedCall(() =>
        dependencies.database
          .prepare(
            `UPDATE hosted_servers SET desired_state = 'running', observed_state = 'awaiting_payment',
             observed_error = NULL, updated_at = ?
           WHERE server_id = ? AND desired_state = 'stopped' AND provider_sandbox_id IS NULL
             AND operator_host IS NULL`,
          )
          .bind(dependencies.now(), row.server_id)
          .run(),
      );
      if (reset.meta.changes !== 1) return;
      this.#track(row, { name: "hosted_server_action", action: "renewed", plan: row.plan, size: row.size });
      yield* this.#provision(yield* this.#requireRow(row.server_id));
      return;
    }
    const renewed = yield* hostedCall(() =>
      dependencies.database
        .prepare(
          `UPDATE hosted_servers SET desired_state = 'running', checkout_session_id = NULL,
           observed_error = CASE WHEN observed_error = 'plan_ended' THEN NULL ELSE observed_error END, updated_at = ?
         WHERE server_id = ? AND desired_state = 'stopped'`,
        )
        .bind(dependencies.now(), row.server_id)
        .run(),
    );
    if (renewed.meta.changes !== 1) return;
    this.#track(row, { name: "hosted_server_action", action: "renewed", plan: row.plan, size: row.size });
    yield* this.#wake(yield* this.#requireRow(row.server_id), "restart");
  });

  readonly #endPlan = Effect.fn("HostedServerService.endPlan")(function* (
    this: HostedServerService,
    row: HostedServerRow,
  ): Effect.fn.Return<void, HostedFailure, HostedServerDependencies> {
    const dependencies = yield* HostedServerDependencies;
    const ended = yield* hostedCall(() =>
      dependencies.database
        .prepare(
          `UPDATE hosted_servers SET desired_state = 'stopped', observed_error = 'plan_ended', claim_token_hash = NULL,
           plan_ended_at = ?, updated_at = ?
         WHERE server_id = ? AND desired_state IN ('running', 'idle')`,
        )
        .bind(dependencies.now(), dependencies.now(), row.server_id)
        .run(),
    );
    if (ended.meta.changes !== 1) return;
    this.#track(row, { name: "hosted_server_action", action: "plan_stopped", plan: row.plan, size: row.size });
    return yield* Effect.gen({ self: this }, function* () {
      yield* this.#stop(yield* this.#requireRow(row.server_id));
    }).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          console.warn("Hosted server stop failed.", { serverId: row.server_id, error: safeErrorCode(error) });
        }),
      ),
    );
  });

  readonly #stop = Effect.fn("HostedServerService.stop")(function* (
    this: HostedServerService,
    row: HostedServerRow,
  ): Effect.fn.Return<void, HostedFailure, HostedServerDependencies> {
    const dependencies = yield* HostedServerDependencies;
    const sandboxId = row.provider_sandbox_id;
    const boat = dependencies.boat;
    if (!boat || !sandboxId || row.observed_state === "stopping" || row.observed_state === "stopped") {
      return;
    }
    const operationResult1 = yield* Effect.result(boat.stopSandbox(sandboxId));
    if (Result.isFailure(operationResult1)) {
      const error = operationResult1.failure;

      if (error instanceof BoatApiError && error.status === 409) {
        yield* this.#refresh(row);
        return;
      }
      return yield* error;
    }
    yield* hostedCall(() =>
      dependencies.database
        .prepare(
          `UPDATE hosted_servers SET observed_state = 'stopping', updated_at = ?
         WHERE server_id = ? AND desired_state IN ('idle', 'stopped') AND observed_state = ?`,
        )
        .bind(dependencies.now(), row.server_id, row.observed_state)
        .run(),
    );
  });

  readonly #stopIdle = Effect.fn("HostedServerService.stopIdle")(function* (
    this: HostedServerService,
    row: HostedServerRow,
    now: number,
  ): Effect.fn.Return<void, HostedFailure, HostedServerDependencies> {
    const dependencies = yield* HostedServerDependencies;
    const idle = yield* hostedCall(() =>
      dependencies.database
        .prepare(
          `UPDATE hosted_servers SET desired_state = 'idle', updated_at = ?
         WHERE server_id = ? AND desired_state = 'running' AND observed_state = 'running'
           AND COALESCE(last_active_at, 0) <= ? AND operator_host IS NULL`,
        )
        .bind(dependencies.now(), row.server_id, now - IDLE_STOP_AFTER_MS)
        .run(),
    );
    if (idle.meta.changes !== 1) return;
    this.#track(row, { name: "hosted_server_action", action: "idle_stopped", plan: row.plan, size: row.size });
    yield* this.#stop({ ...row, desired_state: "idle" });
  });

  readonly #wakeForSchedule = Effect.fn("HostedServerService.wakeForSchedule")(function* (
    this: HostedServerService,
    row: HostedServerRow,
    now: number,
  ): Effect.fn.Return<void, HostedFailure, HostedServerDependencies> {
    const dependencies = yield* HostedServerDependencies;
    const started = yield* hostedCall(() =>
      dependencies.database
        .prepare(
          `UPDATE hosted_servers SET desired_state = 'running', next_run_at = NULL, last_active_at = ?, updated_at = ?
         WHERE server_id = ? AND desired_state = 'idle' AND next_run_at = ?`,
        )
        .bind(now, now, row.server_id, row.next_run_at)
        .run(),
    );
    if (started.meta.changes !== 1) return;
    yield* this.#wakeFromCron(row, "schedule");
  });

  readonly #wakeForRetention = Effect.fn("HostedServerService.wakeForRetention")(function* (
    this: HostedServerService,
    row: HostedServerRow,
    now: number,
  ): Effect.fn.Return<void, HostedFailure, HostedServerDependencies> {
    const dependencies = yield* HostedServerDependencies;
    const started = yield* hostedCall(() =>
      dependencies.database
        .prepare(
          `UPDATE hosted_servers SET desired_state = 'running', last_active_at = ?, updated_at = ?
         WHERE server_id = ? AND desired_state = 'idle' AND observed_state = 'stopped' AND last_active_at = ?`,
        )
        .bind(now, now, row.server_id, row.last_active_at)
        .run(),
    );
    if (started.meta.changes !== 1) return;
    yield* this.#wakeFromCron(row, "retention");
  });

  readonly #wakeFromCron = Effect.fn("HostedServerService.wakeFromCron")(function* (
    this: HostedServerService,
    row: HostedServerRow,
    reason: "schedule" | "retention",
  ): Effect.fn.Return<void, HostedFailure, HostedServerDependencies> {
    const dependencies = yield* HostedServerDependencies;
    const woken = yield* Effect.result(this.#wake(yield* this.#requireRow(row.server_id), reason));
    if (Result.isSuccess(woken)) return;
    const error = woken.failure;
    if (!(error instanceof BoatApiError && error.status === 404)) {
      yield* hostedCall(() =>
        dependencies.database
          .prepare(
            `UPDATE hosted_servers SET desired_state = 'idle', observed_state = 'stopped', observed_error = NULL,
             last_active_at = ?, updated_at = ?
           WHERE server_id = ? AND desired_state = 'running' AND observed_state = 'error'`,
          )
          .bind(row.last_active_at, dependencies.now(), row.server_id)
          .run(),
      );
    }
    return yield* error;
  });

  readonly #extendLease = Effect.fn("HostedServerService.extendLease")(function* (
    this: HostedServerService,
    row: HostedServerRow,
    now: number,
  ): Effect.fn.Return<void, HostedFailure, HostedServerDependencies> {
    const dependencies = yield* HostedServerDependencies;
    const sandboxId = row.provider_sandbox_id;
    const boat = dependencies.boat;
    if (!boat || !sandboxId || row.observed_state !== "running") return;
    if (row.lease_until !== null && row.lease_until - now > LEASE_EXTEND_BEFORE_MS) return;
    yield* boat.extendSandbox(sandboxId, LEASE_TTL_SECONDS);
    yield* hostedCall(() =>
      dependencies.database
        .prepare("UPDATE hosted_servers SET lease_until = ? WHERE server_id = ?")
        .bind(now + LEASE_TTL_SECONDS * 1000, row.server_id)
        .run(),
    );
  });

  readonly #cancelPlans = Effect.fn("HostedServerService.cancelPlans")(function* (
    this: HostedServerService,
    row: HostedServerRow,
  ): Effect.fn.Return<void, HostedFailure, HostedServerDependencies> {
    const dependencies = yield* HostedServerDependencies;
    const billing = dependencies.billing;
    if (!billing) {
      if (yield* this.#openPlanExists(row)) return yield* billingFailed();
      return;
    }
    if (row.checkout_session_id && (yield* this.#closeCheckout(row.checkout_session_id)) === "paid") {
      return yield* new HostedServerServiceError(
        409,
        "hosted_server_paid",
        "The payment for this server finished. Delete it again to cancel the plan with no refund.",
      );
    }
    return yield* Effect.gen({ self: this }, function* () {
      yield* billing.cancelServerPlans(row.owner_user_id, row.server_id).pipe(Effect.mapError(hostedFailure));
    }).pipe(
      Effect.catch((error) =>
        Effect.gen({ self: this }, function* () {
          console.warn("Hosted server plan cancel failed.", { serverId: row.server_id, error: safeErrorCode(error) });
          return yield* billingFailed();
        }),
      ),
    );
  });

  readonly #openPlanExists = Effect.fn("HostedServerService.openPlanExists")(function* (
    this: HostedServerService,
    row: HostedServerRow,
  ): Effect.fn.Return<boolean, HostedFailure, HostedServerDependencies> {
    const dependencies = yield* HostedServerDependencies;
    const open = yield* hostedCall(() =>
      dependencies.database
        .prepare(
          `SELECT 1 AS open FROM billing_subscriptions
         WHERE server_id = ? AND user_id = ? AND status IN ${OPEN_STATUSES_SQL} LIMIT 1`,
        )
        .bind(row.server_id, row.owner_user_id)
        .first<{ open: number }>(),
    );
    return open !== null;
  });

  readonly #closeCheckout = Effect.fn("HostedServerService.closeCheckout")(function* (
    this: HostedServerService,
    sessionId: string,
  ): Effect.fn.Return<"closed" | "paid" | null, HostedFailure, HostedServerDependencies> {
    const dependencies = yield* HostedServerDependencies;
    return yield* Effect.gen({ self: this }, function* () {
      return dependencies.billing
        ? (yield* dependencies.billing.closeCheckout(sessionId).pipe(Effect.mapError(hostedFailure))).status
        : null;
    }).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          console.warn("Checkout close failed.", { error: safeErrorCode(error) });
          return null;
        }),
      ),
    );
  });

  readonly #startForUse = Effect.fn("HostedServerService.startForUse")(function* (
    this: HostedServerService,
    row: HostedServerRow,
  ): Effect.fn.Return<void, HostedFailure, HostedServerDependencies> {
    const dependencies = yield* HostedServerDependencies;
    if (row.desired_state === "idle") {
      const now = dependencies.now();
      yield* hostedCall(() =>
        dependencies.database
          .prepare(
            `UPDATE hosted_servers SET desired_state = 'running', last_active_at = ?, updated_at = ?
           WHERE server_id = ? AND desired_state = 'idle'`,
          )
          .bind(now, now, row.server_id)
          .run(),
      );
      yield* this.#wakeForClient(yield* this.#requireRow(row.server_id));
    } else if (!(yield* this.#retrySetup(row))) {
      yield* this.#wakeForClient(row);
    }
  });

  readonly #startAfterFailedStop = Effect.fn("HostedServerService.startAfterFailedStop")(function* (
    this: HostedServerService,
    row: HostedServerRow,
    stopFailing: boolean,
  ): Effect.fn.Return<void, never, HostedServerDependencies> {
    const dependencies = yield* HostedServerDependencies;
    const boat = dependencies.boat;
    const sandboxId = row.provider_sandbox_id;
    if (!boat || !sandboxId) return;
    if (row.observed_state !== "running" && !(stopFailing && row.observed_state === "stopping")) return;
    dependencies.schedule(startOpenBot(boat, row.server_id, sandboxId, "failed stop"));
  });

  readonly #wakeForClient = Effect.fn("HostedServerService.wakeForClient")(function* (
    this: HostedServerService,
    row: HostedServerRow,
  ): Effect.fn.Return<void, HostedFailure, HostedServerDependencies> {
    return yield* Effect.gen({ self: this }, function* () {
      yield* this.#wake(row, "message");
    }).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          console.warn("Hosted server wake failed.", { serverId: row.server_id, error: safeErrorCode(error) });
        }),
      ),
    );
  });

  readonly #wake = Effect.fn("HostedServerService.wake")(function* (
    this: HostedServerService,
    row: HostedServerRow,
    reason: WakeReason,
  ): Effect.fn.Return<void, HostedFailure, HostedServerDependencies> {
    const dependencies = yield* HostedServerDependencies;
    if (row.operator_host) return;
    const now = dependencies.now();
    const rateLimited = isRateLimitedStart(row);
    if (rateLimited && now < rateLimitRetryAt(row)) return;
    if (
      !rateLimited &&
      row.observed_state !== "stopped" &&
      !(row.observed_state === "error" && row.provider_sandbox_id)
    )
      return;
    const secret = yield* this.#claimKey();
    const claim = secret ? yield* hostedClaim(secret, row.server_id).pipe(Effect.mapError(hostedFailure)) : null;
    const claimHash = claim ? yield* sha256(claim).pipe(Effect.mapError(hostedFailure)) : null;
    const waking = yield* hostedCall(() =>
      dependencies.database
        .prepare(
          `UPDATE hosted_servers SET observed_state = 'waking', observed_error = ?,
           last_wake_reason = CASE WHEN ? = 1 THEN last_wake_reason ELSE ? END, provider_event_at = ?,
           start_requested_at = CASE WHEN ? = 1 THEN start_requested_at ELSE ? END, last_active_at = ?, lease_until = ?,
           claim_token_hash = CASE WHEN ${CLAIM_OPEN_SQL} THEN ? ELSE claim_token_hash END,
           claim_expires_at = CASE WHEN ${CLAIM_OPEN_SQL} THEN ? ELSE claim_expires_at END,
           updated_at = ?
         WHERE server_id = ? AND observed_state = ? AND desired_state = 'running' AND (? = 0 OR updated_at = ?)`,
        )
        .bind(
          rateLimited ? row.observed_error : null,
          rateLimited ? 1 : 0,
          reason === "retention" ? "schedule" : reason,
          rateLimited ? row.provider_event_at : now,
          rateLimited ? 1 : 0,
          now,
          now,
          now + LEASE_TTL_SECONDS * 1000,
          claimHash,
          now + CLAIM_TTL_MS,
          now,
          row.server_id,
          row.observed_state,
          rateLimited ? 1 : 0,
          row.updated_at,
        )
        .run(),
    );
    if (waking.meta.changes !== 1) return;
    if (reason !== "create" && !rateLimited) {
      this.#track(row, { name: "hosted_server_action", action: "woken", plan: row.plan, size: row.size, reason });
    }
    yield* this.#resume(row);
  });

  readonly #resume = Effect.fn("HostedServerService.resume")(function* (
    this: HostedServerService,
    row: HostedServerRow,
  ): Effect.fn.Return<void, HostedFailure, HostedServerDependencies> {
    const dependencies = yield* HostedServerDependencies;
    const sandboxId = row.provider_sandbox_id;
    const boat = dependencies.boat;
    if (!boat || !sandboxId) return;
    const size = row.pending_size;
    const operationResult2 = yield* Effect.result(boat.resumeSandbox(sandboxId, LEASE_TTL_SECONDS, size ?? undefined));
    if (Result.isFailure(operationResult2)) {
      const error = operationResult2.failure;

      if (size && error instanceof BoatApiError && error.code === "type_too_small") {
        console.warn("Hosted server resize refused.", { serverId: row.server_id, error: safeErrorCode(error) });
        yield* hostedCall(() =>
          dependencies.database
            .prepare(
              "UPDATE hosted_servers SET pending_size = NULL, updated_at = ? WHERE server_id = ? AND pending_size = ?",
            )
            .bind(dependencies.now(), row.server_id, size)
            .run(),
        );
        return yield* this.#resume({ ...row, pending_size: null });
      }
      if (error instanceof BoatApiError && error.status === 409) {
        yield* hostedCall(() =>
          dependencies.database
            .prepare(
              `UPDATE hosted_servers SET lease_until = NULL,
               observed_error = CASE WHEN observed_state = 'waking' AND observed_error = 'provider_limit'
                 THEN NULL ELSE observed_error END
             WHERE server_id = ?`,
            )
            .bind(row.server_id)
            .run(),
        );
        return;
      }
      if (error instanceof BoatApiError && error.status === 429) {
        console.warn("Hosted server start rate limited.", { serverId: row.server_id, error: safeErrorCode(error) });
        yield* hostedCall(() =>
          dependencies.database
            .prepare(
              `UPDATE hosted_servers SET observed_error = 'provider_limit', lease_until = NULL, updated_at = ?
             WHERE server_id = ? AND observed_state = 'waking'`,
            )
            .bind(dependencies.now(), row.server_id)
            .run(),
        );
        return;
      }
      yield* hostedCall(() =>
        dependencies.database
          .prepare(
            `UPDATE hosted_servers SET observed_state = 'error', observed_error = ?, updated_at = ?
           WHERE server_id = ? AND observed_state = 'waking'`,
          )
          .bind(providerError(error), dependencies.now(), row.server_id)
          .run(),
      );
      return yield* error;
    }
    if (row.observed_error === "provider_limit") {
      yield* hostedCall(() =>
        dependencies.database
          .prepare(
            `UPDATE hosted_servers SET observed_error = NULL, updated_at = ?
           WHERE server_id = ? AND observed_state = 'waking' AND observed_error = 'provider_limit'`,
          )
          .bind(dependencies.now(), row.server_id)
          .run(),
      );
    }
    if (size) {
      yield* hostedCall(() =>
        dependencies.database
          .prepare(
            "UPDATE hosted_servers SET size = ?, pending_size = NULL, updated_at = ? WHERE server_id = ? AND pending_size = ?",
          )
          .bind(size, dependencies.now(), row.server_id, size)
          .run(),
      );
      this.#track(row, { name: "hosted_server_action", action: "resized", plan: row.plan, size });
    }
    if (operationResult2.success) dependencies.schedule(startOpenBot(boat, row.server_id, sandboxId, "held resume"));
  });

  readonly #observe = Effect.fn("HostedServerService.observe")(function* (
    this: HostedServerService,
    row: HostedServerRow,
    state: BoatSandboxState,
    eventAt: number,
    stopFailing = false,
  ): Effect.fn.Return<boolean, HostedFailure, HostedServerDependencies> {
    const dependencies = yield* HostedServerDependencies;
    if (row.desired_state === "deleted") return false;
    if (row.provider_event_at !== null && eventAt < row.provider_event_at) return false;
    let observed = row.observed_state;
    let error = row.observed_error;
    const failingStop = stopFailing && isUsable(state);
    if (isUsable(state)) {
      observed = failingStop ? "stopping" : "running";
      error = row.desired_state === "stopped" ? "plan_ended" : null;
    } else if (state === "archiving") {
      observed = "stopping";
    } else if (state === "archived") {
      observed = "stopped";
    } else if (state === "error" || state === "cancelled") {
      observed = "error";
      error = row.desired_state === "stopped" ? "plan_ended" : "provider_error";
    } else if (row.observed_state === "creating") {
      observed = "starting";
    }
    const updated = yield* hostedCall(() =>
      dependencies.database
        .prepare(
          `UPDATE hosted_servers SET observed_state = ?, observed_error = ?, provider_event_at = ?, updated_at = ?
         WHERE server_id = ? AND desired_state != 'deleted' AND (provider_event_at IS NULL OR provider_event_at <= ?)
           AND operator_host IS NULL`,
        )
        .bind(observed, error, eventAt, dependencies.now(), row.server_id, eventAt)
        .run(),
    );
    if (updated.meta.changes !== 1) return false;
    if (failingStop) {
      console.warn("Hosted server stop is failing.", { serverId: row.server_id, desiredState: row.desired_state });
      return true;
    }
    if (observed === "running") yield* this.#recordReady(row, eventAt);
    if (observed !== "stopped") return false;
    yield* this.#wake(yield* this.#requireRow(row.server_id), "restart");
    return false;
  });

  readonly #finishDelete = Effect.fn("HostedServerService.finishDelete")(function* (
    this: HostedServerService,
    row: HostedServerRow,
  ): Effect.fn.Return<void, HostedFailure, HostedServerDependencies> {
    const dependencies = yield* HostedServerDependencies;
    if (row.observed_state === "creating" && !row.provider_sandbox_id) return;
    const sandboxId =
      row.provider_sandbox_id ?? (row.operator_host ? row.retired_sandbox_id : yield* this.#findLostSandbox(row));
    if (sandboxId) {
      const boat = dependencies.boat;
      if (!boat)
        return yield* new HostedServerServiceError(503, "hosting_not_configured", "Hosting is not configured.");
      const operationResult3 = yield* Effect.result(boat.deleteSandbox(sandboxId));
      if (Result.isFailure(operationResult3)) {
        const error = operationResult3.failure;

        return yield* new HostedServerServiceError(
          502,
          "hosted_server_provider_failed",
          `Deletion failed: ${safeErrorCode(error)}`,
        );
      }
    }
    if (dependencies.removeHost)
      yield* dependencies.removeHost(row.owner_user_id, row.server_id).pipe(Effect.mapError(hostedFailure));
    const now = dependencies.now();
    yield* hostedCall(() =>
      dependencies.database.batch([
        dependencies.database
          .prepare(
            `UPDATE hosted_servers SET observed_state = 'deleted', claim_token_hash = NULL,
             deleted_at = ?, updated_at = ?
           WHERE server_id = ?`,
          )
          .bind(now, now, row.server_id),
        dependencies.database
          .prepare("UPDATE auth_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL")
          .bind(now, row.auth_session_id),
      ]),
    );
  });

  readonly #findLostSandbox = Effect.fn("HostedServerService.findLostSandbox")(function* (
    this: HostedServerService,
    row: HostedServerRow,
  ): Effect.fn.Return<string | null, HostedFailure, HostedServerDependencies> {
    const dependencies = yield* HostedServerDependencies;
    const providerTemplate = row.provider_template;
    const boat = dependencies.boat;
    const secret = yield* this.#claimKey();
    if (!boat || !secret || !providerTemplate) return null;
    return yield* Effect.gen({ self: this }, function* () {
      const request = createRequest(
        row,
        providerTemplate,
        yield* hostedClaim(secret, row.server_id).pipe(Effect.mapError(hostedFailure)),
      );
      return (yield* boat.createSandbox(request)).id;
    }).pipe(
      Effect.catch((error) =>
        Effect.gen({ self: this }, function* () {
          return yield* new HostedServerServiceError(
            502,
            "hosted_server_provider_failed",
            `Deletion failed: ${safeErrorCode(error)}`,
          );
        }),
      ),
    );
  });

  readonly #claimKey = Effect.fn("HostedServerService.claimKey")(function* (
    this: HostedServerService,
  ): Effect.fn.Return<string | null, HostedFailure, HostedServerDependencies> {
    const ticketKey = this.#ticketKey;
    if (!ticketKey) return null;
    const privateValue = yield* hostedValidate(() => ticketPrivateValue(ticketKey));
    this.#claimSecret ??= yield* deriveSecret(privateValue, "openbot-hosted-claim-key:v1").pipe(
      Effect.mapError(hostedFailure),
    );
    return this.#claimSecret;
  });

  readonly #recordReady = Effect.fn("HostedServerService.recordReady")(function* (
    this: HostedServerService,
    row: HostedServerRow,
    readyAt: number,
  ): Effect.fn.Return<void, never, HostedServerDependencies> {
    const dependencies = yield* HostedServerDependencies;
    const requestedAt = row.start_requested_at;
    if (typeof requestedAt !== "number") return;
    const cleared = yield* hostedCall(() =>
      dependencies.database
        .prepare("UPDATE hosted_servers SET start_requested_at = NULL WHERE server_id = ? AND start_requested_at = ?")
        .bind(row.server_id, requestedAt)
        .run(),
    ).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          console.warn("Hosted server start time was not cleared.", {
            serverId: row.server_id,
            error: safeErrorCode(error),
          });
          return null;
        }),
      ),
    );
    const durationMs = Math.round(readyAt - requestedAt);
    if (cleared?.meta.changes !== 1 || durationMs < 0 || durationMs > MAX_HOSTED_START_MS) return;
    this.#track(row, {
      name: "hosted_server_action",
      action: "ready",
      plan: row.plan,
      size: row.size,
      ...(row.last_wake_reason ? { reason: row.last_wake_reason } : {}),
      durationMs,
      machine: row.operator_host ? "pool" : "boat",
    });
  });

  #track(row: HostedServerRow, event: AccountAnalyticsEvent): void {
    this.#analytics.track(row.owner_user_id, event);
  }

  #requireAvailable(user: AuthUser): { billing: HostedServerBilling } {
    if (!this.isAvailableFor(user) || !this.#billing) {
      throw new HostedServerServiceError(
        403,
        "hosting_unavailable",
        "Hosted servers are not available for this account.",
      );
    }
    return { billing: this.#billing };
  }

  readonly #requireUsableRow = Effect.fn("HostedServerService.requireUsableRow")(function* (
    this: HostedServerService,
    user: AuthUser,
    serverId: string,
    members: "all" | "admins" = "all",
  ): Effect.fn.Return<HostedServerRow, HostedFailure, HostedServerDependencies> {
    const dependencies = yield* HostedServerDependencies;
    const roles = members === "admins" ? " AND m.role IN ('owner', 'admin')" : "";
    const row = yield* hostedCall(() =>
      dependencies.database
        .prepare(
          `SELECT ${ROW_COLUMNS} FROM hosted_servers h
         WHERE h.server_id = ? AND h.desired_state != 'deleted' AND (h.owner_user_id = ? OR EXISTS(
           SELECT 1 FROM remote_memberships m
           WHERE m.host_id = h.server_id AND m.user_id = ? AND m.status = 'active'${roles}
         ))`,
        )
        .bind(serverId, user.id, user.id)
        .first<HostedServerRow>(),
    );
    if (!row) return yield* notFound();
    return row;
  });

  readonly #requireRow = Effect.fn("HostedServerService.requireRow")(function* (
    this: HostedServerService,
    serverId: string,
  ): Effect.fn.Return<HostedServerRow, HostedFailure, HostedServerDependencies> {
    const dependencies = yield* HostedServerDependencies;
    const row = yield* hostedCall(() =>
      dependencies.database
        .prepare(`SELECT ${ROW_COLUMNS} FROM hosted_servers WHERE server_id = ?`)
        .bind(serverId)
        .first<HostedServerRow>(),
    );
    if (!row) return yield* notFound();
    return row;
  });
}

function summary(row: HostedServerRow): HostedServerSummary {
  return {
    serverId: row.server_id,
    deletionScheduledAt: row.deletion_scheduled_at,
    name: row.name,
    size: row.size,
    plan: row.plan,
    interval: row.billing_interval,
    currency: row.currency,
    state: row.observed_state,
    error: row.observed_error,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    storageGb: hostedServerStorageGb(
      row.plan,
      row.operator_host !== null,
      row.provider_template === null ? null : (row.pending_size ?? row.size),
      storageTierOf(row.storage_tier),
    ),
  };
}

function createRequest(row: HostedServerRow, from: string, claim: string) {
  return {
    type: row.size,
    from,
    env: { OPENBOT_HOSTED_CLAIM: claim, OPENBOT_HOSTED_HOST_ID: row.server_id },
    ttlSeconds: LEASE_TTL_SECONDS,
    idempotencyKey: row.server_id,
  };
}

function ticketPrivateValue(jwk: string): string {
  const parsed = JSON.parse(jwk);
  if (!isDynamicRecord(parsed) || !isString(parsed.d) || !parsed.d) {
    throw new Error("REMOTE_TICKET_PRIVATE_JWK is invalid.");
  }
  return parsed.d;
}

function isDeveloperKey(expected: string | undefined, provided: string | null | undefined): boolean {
  const key = expected?.trim() ?? "";
  if (key.length < 32 || !provided) return false;
  const encoder = new TextEncoder();
  return constantTimeEqual(encoder.encode(key), encoder.encode(provided.trim()));
}

function hostedClaim(secret: string, serverId: string) {
  return hmacSha256(secret, `openbot-hosted-claim:v1:${serverId}`);
}

function hostedPoolClaim(secret: string, serverId: string, hostId: string) {
  return hmacSha256(secret, `openbot-hosted-pool-claim:v1:${serverId}:${hostId}`);
}

function poolLocations(currency: BillingCurrency): readonly [string, ...string[]] {
  return currency === "usd" || currency === "brl" ? ["WDC-02", "AMS-01"] : ["AMS-01"];
}

function sandboxName(plan: BillingPlanId, email: string, serverId: string): string {
  const slug = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, "-")
      .replace(/^-+|-+$/gu, "");
  const prefix = `openbot-${plan}-`;
  const suffix = `-${slug(serverId).slice(0, 8)}`;
  const owner = slug(email)
    .slice(0, SANDBOX_NAME_MAX_LENGTH - prefix.length - suffix.length)
    .replace(/-+$/u, "");
  return `${prefix}${owner || "account"}${suffix}`;
}

function isUsable(state: BoatSandboxState): boolean {
  return state === "ready" || state === "idle" || state === "running";
}

function parseWebhookEvent(
  body: string,
  now: number,
): { sandboxId: string; state: BoatSandboxState; createdAt: number } | null {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return null;
  }
  if (!isDynamicRecord(payload) || !isDynamicRecord(payload.data) || !isDynamicRecord(payload.data.sandbox))
    return null;
  const sandboxId = payload.data.sandbox.id;
  if (!isString(sandboxId)) return null;
  const state =
    payload.type === "sandbox.archived"
      ? "archived"
      : payload.type === "sandbox.error"
        ? "error"
        : payload.type === "sandbox.ready" && isBoatState(payload.data.state)
          ? payload.data.state
          : null;
  if (!state) return null;
  const createdAt = isString(payload.createdAt) ? Date.parse(payload.createdAt) : Number.NaN;
  return { sandboxId, state, createdAt: Number.isFinite(createdAt) ? createdAt : now };
}

function providerError(error: unknown): HostedServerError {
  if (!(error instanceof BoatApiError)) return "provider_error";
  if (error.status === 402 || error.code === "billing_required" || error.code === "trial_auto_stop_required") {
    return "provider_billing";
  }
  if (error.status === 429 || error.code === "trial_machine_class_not_allowed") return "provider_limit";
  return "provider_error";
}

function isRateLimitedStart(row: HostedServerRow): boolean {
  return row.observed_state === "waking" && row.observed_error === "provider_limit";
}

function rateLimitRetryAt(row: HostedServerRow): number {
  const waited = row.updated_at - (row.provider_event_at ?? row.updated_at);
  return row.updated_at + Math.min(RATE_LIMIT_RETRY_MAX_MS, Math.max(RATE_LIMIT_RETRY_MIN_MS, waited));
}

const startOpenBot = Effect.fn("HostedServerService.startOpenBot")(function* (
  boat: BoatClient,
  serverId: string,
  sandboxId: string,
  after: "held resume" | "failed stop",
) {
  const command = after === "held resume" ? HELD_RESUME_START_COMMAND : FAILED_STOP_START_COMMAND;
  const result = yield* Effect.result(boat.runCommand(sandboxId, command, HELD_RESUME_START_TIMEOUT_SECONDS));
  if (Result.isFailure(result)) {
    console.warn(`Hosted server start after a ${after} failed.`, {
      serverId,
      error: safeErrorCode(result.failure),
    });
  } else if (result.success.exitCode !== 0) {
    console.warn(`Hosted server start after a ${after} failed.`, { serverId, exitCode: result.success.exitCode });
  } else if (result.success.stdout.trim() === "started") {
    console.info(`Hosted server started after a ${after}.`, { serverId });
  }
});

function safeErrorCode(error: unknown): string {
  if (error instanceof BoatApiError) return `${error.status}:${error.code}`;
  if (error instanceof HostedServerServiceError || error instanceof BillingError) return error.code;
  return "unknown";
}

function serverName(value: unknown): string {
  const name = isString(value) ? parseHostedServerName(value) : null;
  if (!name) throw invalid("name");
  return name;
}

function invalid(name: string): HostedServerServiceError {
  return new HostedServerServiceError(400, "invalid_hosted_server_request", `The ${name} is invalid.`);
}

function billingFailed(): HostedServerServiceError {
  return new HostedServerServiceError(
    502,
    "hosted_server_billing_failed",
    "The plan of this server could not be cancelled. The server was kept. Try again later.",
  );
}

function notFound(): HostedServerServiceError {
  return new HostedServerServiceError(404, "hosted_server_not_found", "The server does not exist.");
}

function invalidClaim(): HostedServerServiceError {
  return new HostedServerServiceError(401, "hosted_claim_invalid", "The server claim is invalid or used.");
}

function invalidPoolToken(): HostedServerServiceError {
  return new HostedServerServiceError(401, "hosted_pool_token_invalid", "The pool machine token is invalid.");
}

function planSoldOut(): HostedServerServiceError {
  return new HostedServerServiceError(409, "plan_sold_out", sourceText("error.billing.planSoldOut"));
}

function lifecycleFailure() {
  return new HostedServerServiceError(
    409,
    "hosted_server_lifecycle_failed",
    sourceText("error.billing.lifecycleFailed"),
  );
}
