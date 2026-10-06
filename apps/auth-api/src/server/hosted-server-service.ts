import {
  BILLING_CURRENCIES,
  BILLING_INTERVALS,
  BILLING_PLAN_IDS,
  type BillingCurrency,
  type BillingInterval,
  type BillingPlanId,
  isOpenBillingStatus,
} from "@openbot/contracts/billing";
import {
  HOSTED_PLAN_SIZE,
  type HostedServerActivityReport,
  type HostedServerCatalog,
  type HostedServerCheckout,
  type HostedServerClaim,
  type HostedServerError,
  type HostedServerList,
  type HostedServerSize,
  type HostedServerState,
  type HostedServerStatus,
  type HostedServerSummary,
  parseHostedServerName,
} from "@openbot/contracts/hosted-servers";
import { isDynamicRecord, isOneOf, isString } from "@openbot/contracts/runtime-values";
import { Context, Effect, Layer, Result, Schema } from "effect";
import { type AccountAnalytics, type AccountAnalyticsEvent, NO_ACCOUNT_ANALYTICS } from "./account-analytics";
import { getServerEntitlement } from "./billing-entitlement";
import { BillingError, type BillingReturnTarget, type BillingService, type SubscriptionSync } from "./billing-service";
import {
  BoatApiError,
  BoatClient,
  type BoatFetch,
  type BoatSandboxState,
  isBoatState,
  verifyBoatWebhookSignature,
} from "./boat-client";
import { deriveSecret, hmacSha256, randomToken, sha256 } from "./crypto";
import type { RemoteFailure } from "./remote-control-plane";
import { PERSISTENT_SESSION_EXPIRES_AT } from "./session-policy";
import type { AuthUser, WorkerBindings } from "./types";

const CLAIM_TTL_MS = 60 * 60_000;
/**
 * After the first redeem the claim works for this long, so a server whose response was lost can
 * redeem it again. Each redeem revokes the session of the one before it.
 */
const CLAIM_REDEEM_RETRY_MS = 10 * 60_000;
/** The cron asks the provider about a server that has been in a transition state this long. */
const STUCK_AFTER_MS = 2 * 60_000;
/** boat retries a delivery for hours, so a delivery ID is kept longer than the 5 minute replay window. */
const DELIVERY_RETENTION_MS = 7 * 24 * 60 * 60_000;
const MAX_SERVERS_PER_ACCOUNT = 3;
const TICK_BATCH_SIZE = 20;
/**
 * A server that waits for its first payment this long is removed. Its Checkout page (35 minutes)
 * closed long before, and it has no sandbox, so no data is lost.
 */
const UNPAID_RETENTION_MS = 24 * 60 * 60_000;
/**
 * The cron sets up a paid server again this long after its setup failed. boat frees the idempotency
 * key of a create that failed before the sandbox existed in about 2 minutes.
 */
const SETUP_RETRY_AFTER_MS = 10 * 60_000;
/**
 * A create call ends in seconds. A server in `creating` this long lost its Worker during the call, so
 * the cron marks the setup failed and sets it up again.
 */
const CREATE_LOST_AFTER_MS = 10 * 60_000;
/** boat allows 120 characters in a sandbox name. */
const SANDBOX_NAME_MAX_LENGTH = 120;
/** A server that reports no activity this long stops. The next use starts it again. */
const IDLE_STOP_AFTER_MS = 15 * 60_000;
/**
 * A server in use reports each 5 minutes (`src/main/hosted-server-activity.ts`). A resize stops the
 * server, so it waits until the server sent no report for this long.
 */
const RESIZE_AFTER_NO_USE_MS = 7 * 60_000;
/**
 * boat stops a sandbox this long after its create or resume, so a server that the Worker loses stops.
 * A boat trial refuses more than 2 hours. Activity extends the time when less than an hour is left.
 */
const LEASE_TTL_SECONDS = 2 * 60 * 60;
const LEASE_EXTEND_BEFORE_MS = 60 * 60_000;
/**
 * The cron starts an idle server this long before its next routine run: one cron interval (5 minutes)
 * and the time that the server takes to start. A server does not stop for no use in this time.
 */
const SCHEDULE_WAKE_BEFORE_MS = 10 * 60_000;
/** A server can report a routine run at most this far ahead. A later run is reported when it comes nearer. */
const NEXT_RUN_MAX_AHEAD_MS = 400 * 24 * 60 * 60_000;
/**
 * The VM of the row has no session that works: it never signed in, or the owner revoked its session.
 * Only then does the claim work again.
 */
const CLAIM_OPEN_SQL = `(hosted_servers.auth_session_id IS NULL OR NOT EXISTS(
  SELECT 1 FROM auth_sessions WHERE auth_sessions.id = hosted_servers.auth_session_id AND auth_sessions.revoked_at IS NULL))`;
/** The same list as `isOpenBillingStatus`: a subscription that Stripe can still charge. */
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

/**
 * A server stops and keeps its data when it has no use for 15 minutes (`idle`) or when its plan ends
 * (`stopped`). An idle server starts again on the next use; a stopped one only on renewal.
 */
type DesiredState = "running" | "idle" | "stopped" | "deleted";
type WakeReason = "create" | "message" | "restart" | "schedule";

interface HostedServerRow {
  server_id: string;
  owner_user_id: string;
  name: string;
  provider_sandbox_id: string | null;
  provider_template: string | null;
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
  created_at: number;
  updated_at: number;
}

const ROW_COLUMNS = `server_id, owner_user_id, name, provider_sandbox_id, provider_template, size, pending_size, plan, billing_interval, currency,
  checkout_session_id, idempotency_key, desired_state, observed_state, observed_error, provider_event_at, auth_session_id,
  last_active_at, lease_until, next_run_at, created_at, updated_at`;

/** The billing calls that hosted servers use. */
export type HostedServerBilling = Pick<
  BillingService,
  "catalog" | "createCheckout" | "closeCheckout" | "cancelServerPlans" | "cancelSubscription" | "refreshLapsedPlans"
>;

export interface HostedServerServiceOptions {
  fetch?: BoatFetch;
  now?: () => number;
  /** Removes the Remote host of a deleted server. It is null when Remote is not configured. */
  removeHost?: ((ownerUserId: string, hostId: string) => Effect.Effect<void, RemoteFailure>) | null | undefined;
  /** Null when the deployment has no Stripe key. Then no server can be created, and plans are not checked. */
  billing?: HostedServerBilling | null;
  analytics?: AccountAnalytics;
  /** The developer key that the request sent. It lets the account create servers when it is the Worker's key. */
  developerKey?: string | null;
}

/** Where Stripe sends the user back after Checkout. */
export interface CheckoutReturn {
  target: BillingReturnTarget;
  origin: string;
}

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
  /** Account IDs and emails (lowercase) that can create servers. `*` allows each account. */
  readonly #allowed: ReadonlySet<string>;
  readonly #developerAccess: boolean;
  readonly #now: () => number;
  readonly #billing: HostedServerBilling | null;
  readonly #analytics: AccountAnalytics;

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
    this.#layer = Layer.succeed(HostedServerDependencies, {
      database,
      boat: this.#boat,
      billing: this.#billing,
      now: this.#now,
      removeHost,
      analytics: this.#analytics,
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

  /** The plans and prices that the create dialog shows. */

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
        servers: rows.results.map(summary),
        maxServers: MAX_SERVERS_PER_ACCOUNT,
      };
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  /**
   * Adds a server that waits for payment, and returns its Stripe Checkout page. The sandbox is made only
   * when Stripe confirms the payment. The same Idempotency-Key returns the same server with a new page.
   */

  readonly create = Effect.fn("HostedServerService.create")(
    function* (
      this: HostedServerService,
      user: AuthUser,
      input: { name: unknown; plan: unknown; interval: unknown; currency: unknown },
      idempotencyKeyHeader: string | null,
      returnTo: CheckoutReturn,
    ): Effect.fn.Return<HostedServerCheckout, HostedFailure, HostedServerDependencies> {
      const dependencies = yield* HostedServerDependencies;
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
      const size = HOSTED_PLAN_SIZE[input.plan];
      const previous = yield* hostedCall(() =>
        dependencies.database
          .prepare(`SELECT ${ROW_COLUMNS} FROM hosted_servers WHERE owner_user_id = ? AND idempotency_key = ?`)
          .bind(user.id, idempotencyKey)
          .first<HostedServerRow>(),
      );
      if (previous) return yield* this.#checkout(previous, user, billing, returnTo);
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
        return yield* this.#reuseUnpaid(unpaid, choice, idempotencyKey, user, billing, returnTo);
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
           idempotency_key, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 'running', 'awaiting_payment', ?, ?, ?)
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
        return yield* this.#checkout(concurrent, user, billing, returnTo);
      }
      return yield* this.#checkout(yield* this.#requireRow(serverId), user, billing, returnTo);
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  /** A new Checkout page for a server of the owner that still waits for its first payment. */

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
      return yield* this.#checkout(row, user, billing, returnTo);
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  /**
   * Stripe runs this after it stores a subscription that names a server. The plan decides: a paid
   * server is made or started again, and a server whose plan ended stops.
   */

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
        // A Checkout that finished after the owner deleted the server: no server takes this payment.
        if (isOpenBillingStatus(sync.status) && dependencies.billing)
          yield* dependencies.billing.cancelSubscription(sync.subscriptionId).pipe(Effect.mapError(hostedFailure));
        return;
      }
      if (isOpenBillingStatus(sync.status)) yield* this.#followPlan(row, sync);
      yield* this.#applyPlan(yield* this.#requireRow(row.server_id));
      yield* this.#resize(yield* this.#requireRow(row.server_id));
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  readonly delete = Effect.fn("HostedServerService.delete")(
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
      // From here the webhook and the wake paths ignore the row, and the cron finishes a failed deletion.
      yield* hostedCall(() =>
        dependencies.database
          .prepare("UPDATE hosted_servers SET desired_state = 'deleted', updated_at = ? WHERE server_id = ?")
          .bind(dependencies.now(), serverId)
          .run(),
      );
      this.#track(row, { name: "hosted_server_action", action: "deleted", plan: row.plan, size: row.size });
      // A payment that the webhook stored after the first cancel. A later one sees the deleted row.
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
      // Read again: a setup that ran at the same time can have stored its sandbox.
      yield* this.#finishDelete(yield* this.#requireRow(serverId));
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  /**
   * The state of a server for its owner or a member. It changes nothing, so a client can ask on each lost
   * connection whether the server sleeps, and wake it only on the user's next input.
   */

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
      const dependencies = yield* HostedServerDependencies;
      const row = yield* this.#requireUsableRow(user, serverId);
      if (row.desired_state === "stopped") {
        return yield* new HostedServerServiceError(
          402,
          "plan_required",
          "The plan of this server ended. Renew it to start the server.",
        );
      }
      if (row.desired_state === "idle") {
        const now = dependencies.now();
        // The start counts as use, so the server does not stop again before its first client connects.
        yield* hostedCall(() =>
          dependencies.database
            .prepare(
              `UPDATE hosted_servers SET desired_state = 'running', last_active_at = ?, updated_at = ?
           WHERE server_id = ? AND desired_state = 'idle'`,
            )
            .bind(now, now, row.server_id)
            .run(),
        );
        // A server that still stops starts again when the provider reports that it stopped.
        yield* this.#wakeForClient(yield* this.#requireRow(serverId));
      } else if (!(yield* this.#retrySetup(row))) {
        yield* this.#wakeForClient(row);
      }
      const current = yield* this.#requireRow(serverId);
      // A client asks for a start because it cannot reach the server. When the row says it runs, a lost
      // provider event can hide a stop, so the provider is asked.
      if (current.observed_state === "running" && current.provider_sandbox_id) yield* this.#refresh(current);
      return summary(yield* this.#requireRow(serverId));
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  /**
   * The server reports whether it is in use (a client works with it or an agent works) and when its next
   * routine runs. Only the session that the server got from its claim can report for it. A report with
   * no body is from an older server: it is in use and does not change the next run.
   */

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
      // A run that is due now is the server's own work: it runs, so the cron has no start to make for it.
      const reported = report.nextRunAt;
      const nextRunAt =
        reported === undefined
          ? row.next_run_at
          : reported !== null && reported > now && reported <= now + NEXT_RUN_MAX_AHEAD_MS
            ? reported
            : null;
      // An idle server already stops. Its next start comes from a client or from its next run.
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
            `SELECT server_id, name, owner_user_id, auth_session_id FROM hosted_servers
         WHERE claim_token_hash = ? AND claim_expires_at > ? AND desired_state != 'deleted'`,
          )
          .bind(claimHash, now)
          .first<{ server_id: string; name: string; owner_user_id: string; auth_session_id: string | null }>(),
      );
      if (!row) return yield* invalidClaim();
      const sessionId = crypto.randomUUID();
      const sessionToken = randomToken();
      const sessionTokenHash = yield* sha256(sessionToken).pipe(Effect.mapError(hostedFailure));
      const [redeemed] = yield* hostedCall(() =>
        dependencies.database.batch([
          // The first redeem shortens the claim lifetime to the retry window. A later one does not extend it.
          dependencies.database
            .prepare(
              `UPDATE hosted_servers SET claim_redeemed_at = COALESCE(claim_redeemed_at, ?),
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
          // The session of an earlier redeem, or of an earlier VM of this server.
          dependencies.database
            .prepare(
              `UPDATE auth_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL
             AND EXISTS(SELECT 1 FROM hosted_servers WHERE server_id = ? AND auth_session_id = ?)`,
            )
            .bind(now, row.auth_session_id, row.server_id, sessionId),
        ]),
      );
      if (redeemed?.meta.changes !== 1) return yield* invalidClaim();
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
        if (row) yield* this.#observe(row, event.state, event.createdAt);
      }
      // Recorded after the change, so a delivery that failed half way is applied again on retry.
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
      const run = (
        rows: HostedServerRow[],
        action: (row: HostedServerRow) => Effect.Effect<unknown, HostedFailure, HostedServerDependencies>,
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
        // The Stripe webhook applies a plan at once. This catches a webhook that failed. Without billing,
        // no plan is checked, so a deployment that loses its Stripe key does not stop each server.
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
             AND updated_at <= ? LIMIT ?`,
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
      // A running server with no use for 15 minutes stops. A state change also counts as use, so a new or
      // resized server has time for its first client.
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
      // An idle server starts before its next routine run. The run is forgotten, so a server that does not
      // report again is not started again for it.
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
      // A server that must stop and still runs: the first stop did not happen.
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
      // The webhook starts a stopped server at once. This catches a start that did not happen.
      const stopped = yield* hostedCall(() =>
        dependencies.database
          .prepare(
            `SELECT ${ROW_COLUMNS} FROM hosted_servers
         WHERE desired_state = 'running' AND observed_state = 'stopped' AND updated_at <= ? LIMIT ?`,
          )
          .bind(now - STUCK_AFTER_MS, TICK_BATCH_SIZE)
          .all<HostedServerRow>(),
      );
      result.restarted = yield* run(stopped.results, (row) => this.#wake(row, "restart"));
      const stuck = yield* hostedCall(() =>
        dependencies.database
          .prepare(
            `SELECT ${ROW_COLUMNS} FROM hosted_servers
         WHERE desired_state != 'deleted' AND provider_sandbox_id IS NOT NULL
           AND observed_state IN ('starting', 'stopping', 'waking') AND updated_at <= ? LIMIT ?`,
          )
          .bind(now - STUCK_AFTER_MS, TICK_BATCH_SIZE)
          .all<HostedServerRow>(),
      );
      result.reconciled = yield* run(stuck.results, (row) => this.#refresh(row));
      // The Stripe webhook starts a resize when the server is not in use. This catches a server that was in
      // use or busy then, or a failed stop.
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

  /** A Checkout page for a server that waits for payment, or none when the server needs no page. */
  readonly #checkout = Effect.fn("HostedServerService.checkout")(function* (
    this: HostedServerService,
    row: HostedServerRow,
    user: AuthUser,
    billing: HostedServerBilling,
    returnTo: CheckoutReturn,
  ): Effect.fn.Return<HostedServerCheckout, HostedFailure, HostedServerDependencies> {
    const dependencies = yield* HostedServerDependencies;
    // A new server waits for its first payment. A server whose plan was cancelled gets a new plan.
    const awaiting = row.observed_state === "awaiting_payment" && row.desired_state === "running";
    // Only the end of a plan sets `stopped`. A provider error on the way can replace the reason.
    const ended = row.desired_state === "stopped";
    if (!awaiting && !ended) return { server: summary(row), checkoutUrl: null };
    // A plan that is open but not paid gets its payment in the Customer Portal, not a second plan.
    if (ended && (yield* this.#openPlanExists(row))) {
      return yield* new HostedServerServiceError(
        409,
        "hosted_server_payment_due",
        "Update the payment method in Billing.",
      );
    }
    const previous = row.checkout_session_id;
    // Only one page can be open, so a user cannot pay twice for one server.
    if (previous && (yield* billing.closeCheckout(previous).pipe(Effect.mapError(hostedFailure))) === "paid") {
      return { server: summary(yield* this.#requireRow(row.server_id)), checkoutUrl: null };
    }
    const session = yield* billing
      .createCheckout({
        user: { id: user.id, email: user.email },
        serverId: row.server_id,
        plan: row.plan,
        interval: row.billing_interval,
        currency: row.currency,
        target: returnTo.target,
        origin: returnTo.origin,
      })
      .pipe(Effect.mapError(hostedFailure));
    // A new plan choice changes the key of an unpaid server, so a page for the plan before it is not stored.
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
      // A second request stored its page first. This page closes, so only that one can take a payment.
      yield* this.#closeCheckout(session.sessionId);
      return yield* new HostedServerServiceError(409, "hosted_server_conflict", "Try the request again.");
    }
    return { server: summary(yield* this.#requireRow(row.server_id)), checkoutUrl: session.url };
  });

  /**
   * Gives the account's unpaid server the plan of a new create, so an account has at most one server
   * that waits for its first payment. A cancelled or abandoned Checkout page then adds no server, also
   * when the client lost its Idempotency-Key. The old page closes first: when the user paid on it, the
   * server keeps its plan and the create returns it with no page.
   */
  readonly #reuseUnpaid = Effect.fn("HostedServerService.reuseUnpaid")(function* (
    this: HostedServerService,
    row: HostedServerRow,
    choice: { plan: BillingPlanId; interval: BillingInterval; currency: BillingCurrency },
    idempotencyKey: string,
    user: AuthUser,
    billing: HostedServerBilling,
    returnTo: CheckoutReturn,
  ): Effect.fn.Return<HostedServerCheckout, HostedFailure, HostedServerDependencies> {
    const dependencies = yield* HostedServerDependencies;
    const previous = row.checkout_session_id;
    if (previous && (yield* billing.closeCheckout(previous).pipe(Effect.mapError(hostedFailure))) === "paid") {
      // A retry of this request then returns the same server, and does not add a second one.
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
    // A second request changed the server first, or changed it again before its page was made.
    if (updated.meta.changes !== 1 || claimed.idempotency_key !== idempotencyKey)
      return yield* new HostedServerServiceError(409, "hosted_server_conflict", "Try the request again.");
    return yield* this.#checkout(claimed, user, billing, returnTo);
  });

  /**
   * Stores a plan change from the Customer Portal, so the list and a renewal use the plan that the
   * owner pays for. A server with a sandbox gets the new machine at its next resume (`pending_size`).
   */
  readonly #followPlan = Effect.fn("HostedServerService.followPlan")(function* (
    this: HostedServerService,
    row: HostedServerRow,
    sync: SubscriptionSync,
  ): Effect.fn.Return<void, HostedFailure, HostedServerDependencies> {
    const dependencies = yield* HostedServerDependencies;
    if (row.plan === sync.plan && row.billing_interval === sync.interval && row.currency === sync.currency) return;
    const size = HOSTED_PLAN_SIZE[sync.plan];
    yield* hostedCall(() =>
      dependencies.database
        .prepare(
          `UPDATE hosted_servers SET plan = ?, billing_interval = ?, currency = ?,
           size = CASE WHEN provider_template IS NULL THEN ? ELSE size END,
           pending_size = CASE WHEN provider_template IS NULL OR size = ? THEN NULL ELSE ? END, updated_at = ?
         WHERE server_id = ? AND desired_state != 'deleted'`,
        )
        .bind(sync.plan, sync.interval, sync.currency, size, size, size, dependencies.now(), row.server_id)
        .run(),
    );
    if (row.provider_sandbox_id) yield* this.#rename({ ...row, plan: sync.plan }, row.provider_sandbox_id);
  });

  /**
   * Moves a running server to the machine of its new plan. boat changes the size only on a resume, so
   * the server stops first: boat saves the disk, and the restart after the stop (`#observe`) resumes
   * the sandbox on the new machine. The server is offline for this time, so a server in use keeps its
   * machine until its use stops, or until its idle stop, after which the next wake uses the new machine.
   */
  readonly #resize = Effect.fn("HostedServerService.resize")(function* (
    this: HostedServerService,
    row: HostedServerRow,
  ): Effect.fn.Return<void, HostedFailure, HostedServerDependencies> {
    const dependencies = yield* HostedServerDependencies;
    const sandboxId = row.provider_sandbox_id;
    const boat = dependencies.boat;
    if (!boat || !sandboxId || !row.pending_size) return;
    // Claimed before the stop: the cron reads its rows first, and activity that comes in after that keeps
    // the server running.
    const now = dependencies.now();
    const claimed = yield* hostedCall(() =>
      dependencies.database
        .prepare(
          `UPDATE hosted_servers SET observed_state = 'stopping', updated_at = ?
         WHERE server_id = ? AND desired_state = 'running' AND observed_state = 'running'
           AND pending_size IS NOT NULL AND COALESCE(last_active_at, 0) <= ?`,
        )
        .bind(now, row.server_id, now - RESIZE_AFTER_NO_USE_MS)
        .run(),
    );
    if (claimed.meta.changes !== 1) return;
    return yield* boat.stopSandbox(sandboxId).pipe(
      Effect.catch((error) =>
        Effect.gen({ self: this }, function* () {
          // 409: the sandbox cannot stop in its current state. The cron tries again.
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

  /** Makes the server match its plan. `getServerEntitlement` is the only place that decides the plan. */
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

  /** Makes the sandbox of a paid server. Only one caller wins the change from `awaiting_payment`. */
  readonly #provision = Effect.fn("HostedServerService.provision")(function* (
    this: HostedServerService,
    row: HostedServerRow,
  ): Effect.fn.Return<void, HostedFailure, HostedServerDependencies> {
    const dependencies = yield* HostedServerDependencies;
    const boat = dependencies.boat;
    const template = this.#template;
    const secret = yield* this.#claimKey();
    // Thrown before the row changes, so the webhook retry or the cron provisions it later.
    if (!boat || !template || !secret) {
      return yield* new HostedServerServiceError(503, "hosting_not_configured", "Hosted servers are not configured.");
    }
    // The claim works from now, so its lifetime counts from the start of the sandbox, not from the payment page.
    // A VM that signed in during a lost attempt keeps its session, and the claim stays spent.
    const claim = yield* hostedClaim(secret, row.server_id).pipe(Effect.mapError(hostedFailure));
    const claimHash = yield* sha256(claim).pipe(Effect.mapError(hostedFailure));
    // A retry sends the request of the first attempt, also after a deploy that changed the template.
    const from = row.provider_template ?? template;
    const now = dependencies.now();
    const claimed = yield* hostedCall(() =>
      dependencies.database
        .prepare(
          `UPDATE hosted_servers SET observed_state = 'creating', last_wake_reason = 'create',
           claim_token_hash = CASE WHEN ${CLAIM_OPEN_SQL} THEN ? ELSE claim_token_hash END,
           claim_expires_at = CASE WHEN ${CLAIM_OPEN_SQL} THEN ? ELSE claim_expires_at END,
           claim_redeemed_at = CASE WHEN ${CLAIM_OPEN_SQL} THEN NULL ELSE claim_redeemed_at END,
           provider_template = COALESCE(provider_template, ?), checkout_session_id = NULL, provider_event_at = ?,
           last_active_at = ?, lease_until = ?, updated_at = ?
         WHERE server_id = ? AND observed_state = 'awaiting_payment' AND desired_state = 'running'`,
        )
        .bind(claimHash, now + CLAIM_TTL_MS, from, now, now, now + LEASE_TTL_SECONDS * 1000, now, row.server_id)
        .run(),
    );
    if (claimed.meta.changes !== 1) return;
    const request = createRequest(row, from, claim);
    return yield* Effect.gen({ self: this }, function* () {
      // The same idempotency key and request body make a retry safe: boat returns the sandbox that it made.
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
        // The server was deleted after the cron gave up on this create. The sandbox costs money until it is deleted.
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
      this.#track(row, { name: "hosted_server_action", action: "provisioned", plan: row.plan, size: row.size });
      yield* this.#rename(row, sandbox.id);
    }).pipe(
      Effect.catch((error) =>
        Effect.gen({ self: this }, function* () {
          console.warn("Hosted server provisioning failed.", { serverId: row.server_id, error: safeErrorCode(error) });
          const failed = providerError(error);
          // Only the setup that is still running: a delete or the end of the plan keeps its own state.
          yield* hostedCall(() =>
            dependencies.database
              .prepare(
                `UPDATE hosted_servers SET observed_state = 'error', observed_error = ?, claim_token_hash = NULL, updated_at = ?
           WHERE server_id = ? AND observed_state = 'creating' AND provider_sandbox_id IS NULL`,
              )
              .bind(failed, dependencies.now(), row.server_id)
              .run(),
          );
          this.#track(row, { name: "hosted_server_action", action: "setup_failed", plan: row.plan, error: failed });
        }),
      ),
    );
  });

  /**
   * Stores a sandbox whose create the cron gave up on. Only a Worker that stops during the call leaves a
   * create for the cron, so this is a guard for that case. A server deleted since then does not keep it.
   * The claim works again, so the VM can sign in, and the VM restarts until it does.
   */
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

  /**
   * Gives the sandbox a name that an operator can find in the boat dashboard: the plan, the owner's
   * email and the start of the server ID. The name is not an address. A failure keeps the old name.
   */
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

  /** Removes a server whose first payment never came. A Checkout paid at the last minute keeps it. */
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
      (yield* dependencies.billing.closeCheckout(checkoutId).pipe(Effect.mapError(hostedFailure))) === "paid"
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

  /** Reads the real state of the sandbox from the provider. A sandbox that boat does not have is gone. */
  readonly #refresh = Effect.fn("HostedServerService.refresh")(function* (
    this: HostedServerService,
    row: HostedServerRow,
  ): Effect.fn.Return<void, HostedFailure, HostedServerDependencies> {
    const dependencies = yield* HostedServerDependencies;
    const boat = dependencies.boat;
    const sandboxId = row.provider_sandbox_id;
    if (!boat || !sandboxId) return;
    const state = yield* boat.getSandbox(sandboxId).pipe(
      Effect.map((sandbox) => sandbox.state),
      Effect.catch((error) => (error.status === 404 ? Effect.succeed("cancelled" as const) : Effect.fail(error))),
    );
    yield* this.#observe(row, state, dependencies.now());
  });

  /**
   * Sets up a paid server again after its setup failed. It has no sandbox, so it has no data. The retry
   * sends the same idempotency key and request body. When the failed call made a sandbox, boat returns
   * that sandbox, and the row stores it.
   */
  readonly #retrySetup = Effect.fn("HostedServerService.retrySetup")(function* (
    this: HostedServerService,
    row: HostedServerRow,
  ): Effect.fn.Return<boolean, HostedFailure, HostedServerDependencies> {
    const dependencies = yield* HostedServerDependencies;
    if (row.desired_state !== "running" || row.observed_state !== "error" || row.provider_sandbox_id) return false;
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
         WHERE server_id = ? AND desired_state = 'running' AND observed_state = 'error' AND provider_sandbox_id IS NULL`,
        )
        .bind(dependencies.now(), row.server_id)
        .run(),
    );
    if (reset.meta.changes !== 1) return false;
    yield* this.#provision(yield* this.#requireRow(row.server_id));
    return true;
  });

  /**
   * The plan of a stopped server is open again, so the server starts with its data. A server whose first
   * setup failed has no sandbox and no data, so it is set up again.
   */
  readonly #renew = Effect.fn("HostedServerService.renew")(function* (
    this: HostedServerService,
    row: HostedServerRow,
  ): Effect.fn.Return<void, HostedFailure, HostedServerDependencies> {
    const dependencies = yield* HostedServerDependencies;
    if (!row.provider_sandbox_id) {
      const reset = yield* hostedCall(() =>
        dependencies.database
          .prepare(
            `UPDATE hosted_servers SET desired_state = 'running', observed_state = 'awaiting_payment',
             observed_error = NULL, updated_at = ?
           WHERE server_id = ? AND desired_state = 'stopped' AND provider_sandbox_id IS NULL`,
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
    // A server that still stops starts again when the provider reports that it stopped.
    yield* this.#wake(yield* this.#requireRow(row.server_id), "restart");
  });

  /** The plan ended: the server stops and keeps its data. It is never deleted for this. */
  readonly #endPlan = Effect.fn("HostedServerService.endPlan")(function* (
    this: HostedServerService,
    row: HostedServerRow,
  ): Effect.fn.Return<void, HostedFailure, HostedServerDependencies> {
    const dependencies = yield* HostedServerDependencies;
    const ended = yield* hostedCall(() =>
      dependencies.database
        .prepare(
          `UPDATE hosted_servers SET desired_state = 'stopped', observed_error = 'plan_ended', claim_token_hash = NULL,
           updated_at = ?
         WHERE server_id = ? AND desired_state IN ('running', 'idle')`,
        )
        .bind(dependencies.now(), row.server_id)
        .run(),
    );
    if (ended.meta.changes !== 1) return;
    this.#track(row, { name: "hosted_server_action", action: "plan_stopped", plan: row.plan, size: row.size });
    return yield* Effect.gen({ self: this }, function* () {
      yield* this.#stop(yield* this.#requireRow(row.server_id));
    }).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          // The row records the stop, and the cron sends it again.
          console.warn("Hosted server stop failed.", { serverId: row.server_id, error: safeErrorCode(error) });
        }),
      ),
    );
  });

  /** boat saves the disk before it stops the sandbox, and refuses the stop when the save fails. */
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

      // 409: the sandbox cannot stop in its current state. A lost event can hide that it is stopped
      // already, so the provider is asked. Else the cron tries again.
      if (error instanceof BoatApiError && error.status === 409) return yield* this.#refresh(row);
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

  /** Stops a server with no use. Activity that comes in first keeps it running. */
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
           AND COALESCE(last_active_at, 0) <= ?`,
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
    yield* this.#wake(yield* this.#requireRow(row.server_id), "schedule");
  });

  /** Moves the boat stop time of a server in use, so boat does not stop it. */
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

  /**
   * Cancels the plan of a server that its owner deletes: now, with no refund. A failure keeps the
   * server, so the owner never pays for a server that is gone.
   */
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
    // A payment that finished just now keeps the server, so the owner does not lose it with no refund
    // before they see it. A payment on this page after the close is cancelled by `onSubscriptionSynced`.
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
        ? yield* dependencies.billing.closeCheckout(sessionId).pipe(Effect.mapError(hostedFailure))
        : null;
    }).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          // The page closes by itself after 35 minutes.
          console.warn("Checkout close failed.", { error: safeErrorCode(error) });
          return null;
        }),
      ),
    );
  });

  /** The row keeps the reason of a failed resume, so the client gets it in the summary, not as a 500. */
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
    const now = dependencies.now();
    // A stopping server starts again when the provider reports that it stopped.
    if (row.observed_state !== "stopped" && !(row.observed_state === "error" && row.provider_sandbox_id)) return;
    // A VM that never signed in, or whose session the owner revoked, has its claim in its env file. The
    // claim works again for this start.
    const secret = yield* this.#claimKey();
    const claim = secret ? yield* hostedClaim(secret, row.server_id).pipe(Effect.mapError(hostedFailure)) : null;
    const claimHash = claim ? yield* sha256(claim).pipe(Effect.mapError(hostedFailure)) : null;
    const waking = yield* hostedCall(() =>
      dependencies.database
        .prepare(
          `UPDATE hosted_servers SET observed_state = 'waking', observed_error = NULL,
           last_wake_reason = ?, provider_event_at = ?, last_active_at = ?, lease_until = ?,
           claim_token_hash = CASE WHEN ${CLAIM_OPEN_SQL} THEN ? ELSE claim_token_hash END,
           claim_expires_at = CASE WHEN ${CLAIM_OPEN_SQL} THEN ? ELSE claim_expires_at END,
           updated_at = ?
         WHERE server_id = ? AND observed_state = ? AND desired_state = 'running'`,
        )
        .bind(
          reason,
          now,
          now,
          now + LEASE_TTL_SECONDS * 1000,
          claimHash,
          now + CLAIM_TTL_MS,
          now,
          row.server_id,
          row.observed_state,
        )
        .run(),
    );
    if (waking.meta.changes !== 1) return;
    if (reason !== "create") {
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
        // The data does not fit the smaller machine of the new plan. The server keeps its machine, and
        // the Worker does not try again until the next plan change.
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
      // 409: the provider already resumes or runs it; the webhook or the cron reports the result. boat
      // kept its old stop time, so the next activity sets a new one.
      if (error instanceof BoatApiError && error.status === 409) {
        yield* hostedCall(() =>
          dependencies.database
            .prepare("UPDATE hosted_servers SET lease_until = NULL WHERE server_id = ?")
            .bind(row.server_id)
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
  });

  readonly #observe = Effect.fn("HostedServerService.observe")(function* (
    this: HostedServerService,
    row: HostedServerRow,
    state: BoatSandboxState,
    eventAt: number,
  ): Effect.fn.Return<void, HostedFailure, HostedServerDependencies> {
    const dependencies = yield* HostedServerDependencies;
    if (row.desired_state === "deleted") return;
    if (row.provider_event_at !== null && eventAt < row.provider_event_at) return;
    let observed = row.observed_state;
    let error = row.observed_error;
    if (isUsable(state)) {
      observed = "running";
      // A server whose plan ended keeps the reason until the stop is done.
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
         WHERE server_id = ? AND desired_state != 'deleted' AND (provider_event_at IS NULL OR provider_event_at <= ?)`,
        )
        .bind(observed, error, eventAt, dependencies.now(), row.server_id, eventAt)
        .run(),
    );
    if (updated.meta.changes !== 1 || observed !== "stopped") return;
    // The provider stops a server, for example for maintenance or at the end of its lease, and a resize
    // stops it. A server in use must run, so it starts again. An idle server stays stopped (`#wake`).
    yield* this.#wake(yield* this.#requireRow(row.server_id), "restart");
  });

  readonly #finishDelete = Effect.fn("HostedServerService.finishDelete")(function* (
    this: HostedServerService,
    row: HostedServerRow,
  ): Effect.fn.Return<void, HostedFailure, HostedServerDependencies> {
    const dependencies = yield* HostedServerDependencies;
    // A create call runs and can still return a sandbox. The cron deletes it after the call ends.
    if (row.observed_state === "creating" && !row.provider_sandbox_id) return;
    const sandboxId = row.provider_sandbox_id ?? (yield* this.#findLostSandbox(row));
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
    // Before the row is final, so the cron removes the host again when this fails.
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

  /**
   * A create whose answer was lost can have made a sandbox that the row does not name. The same request
   * returns that sandbox, so the delete removes it too. The deleted row refuses the claim of the VM.
   */
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
          // A refusal does not prove that the earlier create made no sandbox: the template can be gone
          // since. The deletion stays pending, and the cron asks again.
          return yield* new HostedServerServiceError(
            502,
            "hosted_server_provider_failed",
            `Deletion failed: ${safeErrorCode(error)}`,
          );
        }),
      ),
    );
  });

  /**
   * The key of the claims. It comes from the Remote ticket key, which only the Worker has, so hosting
   * needs no secret of its own. It uses only the private value `d`: the same key in other JSON gives the
   * same claims. A new ticket key changes each claim (see docs/hosted-servers.md).
   */
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

  /** A server that is not deleted, of which the user is the owner or an active member. */
  readonly #requireUsableRow = Effect.fn("HostedServerService.requireUsableRow")(function* (
    this: HostedServerService,
    user: AuthUser,
    serverId: string,
  ): Effect.fn.Return<HostedServerRow, HostedFailure, HostedServerDependencies> {
    const dependencies = yield* HostedServerDependencies;
    const row = yield* hostedCall(() =>
      dependencies.database
        .prepare(
          `SELECT ${ROW_COLUMNS} FROM hosted_servers h
         WHERE h.server_id = ? AND h.desired_state != 'deleted' AND (h.owner_user_id = ? OR EXISTS(
           SELECT 1 FROM remote_memberships m WHERE m.host_id = h.server_id AND m.user_id = ? AND m.status = 'active'
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
    name: row.name,
    size: row.size,
    plan: row.plan,
    interval: row.billing_interval,
    currency: row.currency,
    state: row.observed_state,
    error: row.observed_error,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

/** `openbot-{plan}-{email}-{first 8 characters of the server ID}`, in the characters of a boat name. */
/**
 * The claim of a server is the same on each call, so a create retry sends the same request body and
 * boat returns the sandbox that it made. The Worker stores only its hash, and accepts it only while
 * the row says so: from a create or a start of a VM that never signed in, until it expires.
 */
/** The create request of a server. Each attempt sends the same one, so boat can return a sandbox that it made. */
function createRequest(row: HostedServerRow, from: string, claim: string) {
  return {
    type: row.size,
    from,
    // The claim is the only secret that the VM gets. It works for a short time after its first use, and expires.
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

/** A key shorter than 32 characters is not a key: the Worker then gives no developer access. */
function isDeveloperKey(expected: string | undefined, provided: string | null | undefined): boolean {
  const key = expected?.trim() ?? "";
  if (key.length < 32 || !provided) return false;
  const encoder = new TextEncoder();
  const left = encoder.encode(key);
  const right = encoder.encode(provided.trim());
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  return difference === 0;
}

function hostedClaim(secret: string, serverId: string) {
  return hmacSha256(secret, `openbot-hosted-claim:v1:${serverId}`);
}

export function sandboxName(plan: BillingPlanId, email: string, serverId: string): string {
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
  // A boat trial also refuses a server with no auto-stop. Only a paid boat plan lifts that limit.
  if (error.status === 402 || error.code === "billing_required" || error.code === "trial_auto_stop_required") {
    return "provider_billing";
  }
  if (error.status === 429 || error.code === "trial_machine_class_not_allowed") return "provider_limit";
  return "provider_error";
}

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
