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
  type HostedServerCatalog,
  type HostedServerCheckout,
  type HostedServerClaim,
  type HostedServerError,
  type HostedServerList,
  type HostedServerSize,
  type HostedServerState,
  type HostedServerSummary,
  parseHostedServerName,
} from "@openbot/contracts/hosted-servers";
import { isDynamicRecord, isOneOf, isString } from "@openbot/contracts/runtime-values";
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
 * boat stops a sandbox this long after its create or resume, so a server that the Worker loses stops.
 * A boat trial refuses more than 2 hours. Activity extends the time when less than an hour is left.
 */
const LEASE_TTL_SECONDS = 2 * 60 * 60;
const LEASE_EXTEND_BEFORE_MS = 60 * 60_000;
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
  | "HOSTED_SERVER_TEMPLATE"
  | "BOAT_API_KEY"
  | "BOAT_WEBHOOK_SECRET"
  | "REMOTE_TICKET_PRIVATE_JWK"
>;

export class HostedServerServiceError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * A server stops and keeps its data when it has no use for 15 minutes (`idle`) or when its plan ends
 * (`stopped`). An idle server starts again on the next use; a stopped one only on renewal.
 */
type DesiredState = "running" | "idle" | "stopped" | "deleted";
type WakeReason = "create" | "message" | "restart";

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
  desired_state: DesiredState;
  observed_state: HostedServerState;
  observed_error: HostedServerError | null;
  provider_event_at: number | null;
  auth_session_id: string | null;
  last_active_at: number | null;
  lease_until: number | null;
  created_at: number;
  updated_at: number;
}

const ROW_COLUMNS = `server_id, owner_user_id, name, provider_sandbox_id, provider_template, size, pending_size, plan, billing_interval, currency,
  checkout_session_id, desired_state, observed_state, observed_error, provider_event_at, auth_session_id,
  last_active_at, lease_until, created_at, updated_at`;

/** The billing calls that hosted servers use. */
export type HostedServerBilling = Pick<
  BillingService,
  "catalog" | "createCheckout" | "closeCheckout" | "cancelServerPlans" | "cancelSubscription" | "refreshLapsedPlans"
>;

export interface HostedServerServiceOptions {
  fetch?: BoatFetch;
  now?: () => number;
  /** Removes the Remote host of a deleted server. It is null when Remote is not configured. */
  removeHost?: ((ownerUserId: string, hostId: string) => Promise<void>) | null | undefined;
  /** Null when the deployment has no Stripe key. Then no server can be created, and plans are not checked. */
  billing?: HostedServerBilling | null;
  analytics?: AccountAnalytics;
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
  failed: number;
}

export class HostedServerService {
  readonly #database: D1Database;
  readonly #boat: BoatClient | null;
  readonly #template: string | null;
  readonly #webhookSecret: string | null;
  readonly #ticketKey: string | null;
  #claimSecret: Promise<string> | null = null;
  readonly #enabled: boolean;
  readonly #allowedUserIds: ReadonlySet<string>;
  readonly #now: () => number;
  readonly #removeHost: ((ownerUserId: string, hostId: string) => Promise<void>) | null;
  readonly #billing: HostedServerBilling | null;
  readonly #analytics: AccountAnalytics;

  constructor(bindings: HostedServerBindings, options: HostedServerServiceOptions = {}) {
    this.#database = bindings.DB;
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
    this.#allowedUserIds = new Set(
      (bindings.HOSTED_SERVERS_ALLOWED_USER_IDS ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    );
    this.#now = options.now ?? Date.now;
    this.#removeHost = options.removeHost ?? null;
    this.#billing = options.billing ?? null;
    this.#analytics = options.analytics ?? NO_ACCOUNT_ANALYTICS;
  }

  isAvailableFor(userId: string): boolean {
    return (
      this.#enabled && this.#billing !== null && (this.#allowedUserIds.has("*") || this.#allowedUserIds.has(userId))
    );
  }

  /** The plans and prices that the create dialog shows. */
  plans(user: AuthUser): Promise<HostedServerCatalog> {
    return this.#requireAvailable(user.id).billing.catalog();
  }

  async list(user: AuthUser): Promise<HostedServerList> {
    const rows = await this.#database
      .prepare(
        `SELECT ${ROW_COLUMNS} FROM hosted_servers
         WHERE owner_user_id = ? AND desired_state != 'deleted' ORDER BY created_at`,
      )
      .bind(user.id)
      .all<HostedServerRow>();
    return { available: this.isAvailableFor(user.id), servers: rows.results.map(summary) };
  }

  /**
   * Adds a server that waits for payment, and returns its Stripe Checkout page. The sandbox is made only
   * when Stripe confirms the payment. The same Idempotency-Key returns the same server with a new page.
   */
  async create(
    user: AuthUser,
    input: { name: unknown; plan: unknown; interval: unknown; currency: unknown },
    idempotencyKeyHeader: string | null,
    returnTo: CheckoutReturn,
  ): Promise<HostedServerCheckout> {
    const { billing } = this.#requireAvailable(user.id);
    const idempotencyKey = idempotencyKeyHeader?.trim() ?? "";
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/u.test(idempotencyKey)) {
      throw new HostedServerServiceError(400, "invalid_idempotency_key", "A valid Idempotency-Key header is required.");
    }
    const name = serverName(input.name);
    if (!isOneOf(BILLING_PLAN_IDS, input.plan)) throw invalid("plan");
    if (!isOneOf(BILLING_INTERVALS, input.interval)) throw invalid("interval");
    if (!isOneOf(BILLING_CURRENCIES, input.currency)) throw invalid("currency");
    const previous = await this.#database
      .prepare(`SELECT ${ROW_COLUMNS} FROM hosted_servers WHERE owner_user_id = ? AND idempotency_key = ?`)
      .bind(user.id, idempotencyKey)
      .first<HostedServerRow>();
    if (previous) return this.#checkout(previous, user, billing, returnTo);
    const count = await this.#database
      .prepare("SELECT COUNT(*) AS count FROM hosted_servers WHERE owner_user_id = ? AND desired_state != 'deleted'")
      .bind(user.id)
      .first<{ count: number }>();
    if ((count?.count ?? 0) >= MAX_SERVERS_PER_ACCOUNT) {
      throw new HostedServerServiceError(409, "hosted_server_limit", "This account has the maximum number of servers.");
    }
    const serverId = crypto.randomUUID();
    const now = this.#now();
    const inserted = await this.#database
      .prepare(
        `INSERT INTO hosted_servers(
           server_id, owner_user_id, name, size, plan, billing_interval, currency, desired_state, observed_state,
           idempotency_key, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 'running', 'awaiting_payment', ?, ?, ?)
         ON CONFLICT(owner_user_id, idempotency_key) DO NOTHING`,
      )
      .bind(
        serverId,
        user.id,
        name,
        HOSTED_PLAN_SIZE[input.plan],
        input.plan,
        input.interval,
        input.currency,
        idempotencyKey,
        now,
        now,
      )
      .run();
    if (inserted.meta.changes !== 1) {
      const concurrent = await this.#database
        .prepare(`SELECT ${ROW_COLUMNS} FROM hosted_servers WHERE owner_user_id = ? AND idempotency_key = ?`)
        .bind(user.id, idempotencyKey)
        .first<HostedServerRow>();
      if (!concurrent) throw new HostedServerServiceError(409, "hosted_server_conflict", "Try the request again.");
      return this.#checkout(concurrent, user, billing, returnTo);
    }
    return this.#checkout(await this.#requireRow(serverId), user, billing, returnTo);
  }

  /** A new Checkout page for a server of the owner that still waits for its first payment. */
  async checkout(user: AuthUser, serverId: string, returnTo: CheckoutReturn): Promise<HostedServerCheckout> {
    const { billing } = this.#requireAvailable(user.id);
    const row = await this.#database
      .prepare(
        `SELECT ${ROW_COLUMNS} FROM hosted_servers WHERE server_id = ? AND owner_user_id = ? AND desired_state != 'deleted'`,
      )
      .bind(serverId, user.id)
      .first<HostedServerRow>();
    if (!row) throw notFound();
    return this.#checkout(row, user, billing, returnTo);
  }

  /**
   * Stripe runs this after it stores a subscription that names a server. The plan decides: a paid
   * server is made or started again, and a server whose plan ended stops.
   */
  async onSubscriptionSynced(sync: SubscriptionSync): Promise<void> {
    const row = await this.#database
      .prepare(`SELECT ${ROW_COLUMNS} FROM hosted_servers WHERE server_id = ? AND owner_user_id = ?`)
      .bind(sync.serverId, sync.userId)
      .first<HostedServerRow>();
    if (!row) return;
    if (row.desired_state === "deleted") {
      // A Checkout that finished after the owner deleted the server: no server takes this payment.
      if (isOpenBillingStatus(sync.status)) await this.#billing?.cancelSubscription(sync.subscriptionId);
      return;
    }
    if (isOpenBillingStatus(sync.status)) await this.#followPlan(row, sync);
    await this.#applyPlan(await this.#requireRow(row.server_id));
    await this.#resize(await this.#requireRow(row.server_id));
  }

  async delete(user: AuthUser, serverId: string, confirmName: unknown): Promise<void> {
    const row = await this.#database
      .prepare(`SELECT ${ROW_COLUMNS} FROM hosted_servers WHERE server_id = ? AND owner_user_id = ?`)
      .bind(serverId, user.id)
      .first<HostedServerRow>();
    if (!row || row.observed_state === "deleted") throw notFound();
    if (confirmName !== row.name) {
      throw new HostedServerServiceError(400, "hosted_server_confirm_mismatch", "Type the server name to delete it.");
    }
    await this.#cancelPlans(row);
    // From here the webhook and the wake paths ignore the row, and the cron finishes a failed deletion.
    await this.#database
      .prepare("UPDATE hosted_servers SET desired_state = 'deleted', updated_at = ? WHERE server_id = ?")
      .bind(this.#now(), serverId)
      .run();
    this.#track(row, { name: "hosted_server_action", action: "deleted", plan: row.plan, size: row.size });
    // A payment that the webhook stored after the first cancel. A later one sees the deleted row.
    await this.#billing?.cancelServerPlans(row.owner_user_id, row.server_id).catch((error: unknown) => {
      console.warn("Hosted server plan cancel failed.", { serverId: row.server_id, error: safeErrorCode(error) });
    });
    // Read again: a setup that ran at the same time can have stored its sandbox.
    await this.#finishDelete(await this.#requireRow(serverId));
  }

  async wake(user: AuthUser, serverId: string): Promise<HostedServerSummary> {
    const row = await this.#database
      .prepare(
        `SELECT ${ROW_COLUMNS} FROM hosted_servers h
         WHERE h.server_id = ? AND h.desired_state != 'deleted' AND (h.owner_user_id = ? OR EXISTS(
           SELECT 1 FROM remote_memberships m WHERE m.host_id = h.server_id AND m.user_id = ? AND m.status = 'active'
         ))`,
      )
      .bind(serverId, user.id, user.id)
      .first<HostedServerRow>();
    if (!row) throw notFound();
    if (row.desired_state === "stopped") {
      throw new HostedServerServiceError(
        402,
        "plan_required",
        "The plan of this server ended. Renew it to start the server.",
      );
    }
    if (row.desired_state === "idle") {
      const now = this.#now();
      // The start counts as use, so the server does not stop again before its first client connects.
      await this.#database
        .prepare(
          `UPDATE hosted_servers SET desired_state = 'running', last_active_at = ?, updated_at = ?
           WHERE server_id = ? AND desired_state = 'idle'`,
        )
        .bind(now, now, row.server_id)
        .run();
      // A server that still stops starts again when the provider reports that it stopped.
      await this.#wakeForClient(await this.#requireRow(serverId));
    } else if (!(await this.#retrySetup(row))) {
      await this.#wakeForClient(row);
    }
    const current = await this.#requireRow(serverId);
    // A client asks for a start because it cannot reach the server. When the row says it runs, a lost
    // provider event can hide a stop, so the provider is asked.
    if (current.observed_state === "running" && current.provider_sandbox_id) await this.#refresh(current);
    return summary(await this.#requireRow(serverId));
  }

  /**
   * The server reports that it is in use: a client is connected or an agent works. Only the session
   * that the server got from its claim can report for it.
   */
  async reportActivity(sessionToken: string, serverId: string): Promise<void> {
    const now = this.#now();
    const row = await this.#database
      .prepare(
        `SELECT ${ROW_COLUMNS} FROM hosted_servers
         WHERE server_id = ? AND desired_state != 'deleted' AND auth_session_id = (
           SELECT id FROM auth_sessions WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?
         )`,
      )
      .bind(serverId, await sha256(sessionToken), now)
      .first<HostedServerRow>();
    if (!row) throw notFound();
    // An idle server already stops. Its next start comes from a client.
    if (row.desired_state !== "running") return;
    await this.#database
      .prepare("UPDATE hosted_servers SET last_active_at = ? WHERE server_id = ? AND desired_state = 'running'")
      .bind(now, row.server_id)
      .run();
    await this.#extendLease(row, now);
  }

  async redeemClaim(claim: unknown): Promise<HostedServerClaim> {
    if (!isString(claim) || claim.length < 16 || claim.length > 128) throw invalidClaim();
    const claimHash = await sha256(claim);
    const now = this.#now();
    const row = await this.#database
      .prepare(
        `SELECT server_id, name, owner_user_id, auth_session_id FROM hosted_servers
         WHERE claim_token_hash = ? AND claim_expires_at > ? AND desired_state != 'deleted'`,
      )
      .bind(claimHash, now)
      .first<{ server_id: string; name: string; owner_user_id: string; auth_session_id: string | null }>();
    if (!row) throw invalidClaim();
    const sessionId = crypto.randomUUID();
    const sessionToken = randomToken();
    const [redeemed] = await this.#database.batch([
      // The first redeem shortens the claim lifetime to the retry window. A later one does not extend it.
      this.#database
        .prepare(
          `UPDATE hosted_servers SET claim_redeemed_at = COALESCE(claim_redeemed_at, ?),
             claim_expires_at = MIN(claim_expires_at, ?), auth_session_id = ?, updated_at = ?
           WHERE server_id = ? AND claim_token_hash = ? AND claim_expires_at > ? AND auth_session_id IS ?`,
        )
        .bind(now, now + CLAIM_REDEEM_RETRY_MS, sessionId, now, row.server_id, claimHash, now, row.auth_session_id),
      this.#database
        .prepare(
          `INSERT INTO auth_sessions(id, user_id, token_hash, expires_at, created_at, last_used_at)
           SELECT ?, owner_user_id, ?, ?, ?, ? FROM hosted_servers
           WHERE server_id = ? AND auth_session_id = ?`,
        )
        .bind(sessionId, await sha256(sessionToken), PERSISTENT_SESSION_EXPIRES_AT, now, now, row.server_id, sessionId),
      // The session of an earlier redeem, or of an earlier VM of this server.
      this.#database
        .prepare(
          `UPDATE auth_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL
             AND EXISTS(SELECT 1 FROM hosted_servers WHERE server_id = ? AND auth_session_id = ?)`,
        )
        .bind(now, row.auth_session_id, row.server_id, sessionId),
    ]);
    if (redeemed?.meta.changes !== 1) throw invalidClaim();
    const user = await this.#database
      .prepare("SELECT id, email, name, avatar_url FROM users WHERE id = ?")
      .bind(row.owner_user_id)
      .first<{ id: string; email: string; name: string | null; avatar_url: string | null }>();
    if (!user) throw invalidClaim();
    return {
      hostId: row.server_id,
      name: row.name,
      sessionToken,
      user: { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatar_url },
    };
  }

  async handleWebhook(input: { deliveryId: string; timestamp: string; signature: string; body: string }) {
    if (!this.#webhookSecret) {
      throw new HostedServerServiceError(503, "hosting_not_configured", "Hosted servers are not configured.");
    }
    const now = this.#now();
    const valid =
      /^[A-Za-z0-9_-]{1,128}$/u.test(input.deliveryId) &&
      (await verifyBoatWebhookSignature({ ...input, secret: this.#webhookSecret, now }));
    if (!valid) throw new HostedServerServiceError(401, "webhook_signature_invalid", "The signature is invalid.");
    const seen = await this.#database
      .prepare("SELECT 1 AS seen FROM hosting_webhook_deliveries WHERE delivery_id = ?")
      .bind(input.deliveryId)
      .first<{ seen: number }>();
    if (seen) return;
    const event = parseWebhookEvent(input.body, now);
    if (event) {
      const row = await this.#database
        .prepare(`SELECT ${ROW_COLUMNS} FROM hosted_servers WHERE provider_sandbox_id = ?`)
        .bind(event.sandboxId)
        .first<HostedServerRow>();
      if (row) await this.#observe(row, event.state, event.createdAt);
    }
    // Recorded after the change, so a delivery that failed half way is applied again on retry.
    await this.#database
      .prepare("INSERT INTO hosting_webhook_deliveries(delivery_id, received_at) VALUES (?, ?) ON CONFLICT DO NOTHING")
      .bind(input.deliveryId, now)
      .run();
  }

  async tick(now = this.#now()): Promise<HostedServerTickResult> {
    const result: HostedServerTickResult = {
      restarted: 0,
      reconciled: 0,
      deleted: 0,
      provisioned: 0,
      stopped: 0,
      abandoned: 0,
      resized: 0,
      idle: 0,
      failed: 0,
    };
    await this.#database
      .prepare(
        `UPDATE hosted_servers SET claim_token_hash = NULL
         WHERE claim_token_hash IS NOT NULL AND claim_expires_at <= ?`,
      )
      .bind(now)
      .run();
    await this.#database
      .prepare("DELETE FROM hosting_webhook_deliveries WHERE received_at < ?")
      .bind(now - DELIVERY_RETENTION_MS)
      .run();
    const boat = this.#boat;
    if (!boat) return result;
    const run = async (rows: HostedServerRow[], action: (row: HostedServerRow) => Promise<unknown>) => {
      let done = 0;
      for (const row of rows) {
        try {
          await action(row);
          done += 1;
        } catch (error) {
          result.failed += 1;
          console.warn("Hosted server task failed.", { serverId: row.server_id, error: safeErrorCode(error) });
        }
      }
      return done;
    };
    if (this.#billing) {
      await this.#billing.refreshLapsedPlans(now);
      // The Stripe webhook applies a plan at once. This catches a webhook that failed. Without billing,
      // no plan is checked, so a deployment that loses its Stripe key does not stop each server.
      const planChanged = await this.#database
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
        .all<HostedServerRow>();
      await run(planChanged.results, async (row) => {
        const change = await this.#applyPlan(row);
        if (change === "provisioned") result.provisioned += 1;
        if (change === "stopped") result.stopped += 1;
      });
      const abandoned = await this.#database
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
        .all<HostedServerRow>();
      await run(abandoned.results, async (row) => {
        if (await this.#removeUnpaid(row, now)) result.abandoned += 1;
      });
      const failedSetups = await this.#database
        .prepare(
          `SELECT ${ROW_COLUMNS} FROM hosted_servers
           WHERE desired_state = 'running' AND observed_state = 'error' AND provider_sandbox_id IS NULL
             AND updated_at <= ? LIMIT ?`,
        )
        .bind(now - SETUP_RETRY_AFTER_MS, TICK_BATCH_SIZE)
        .all<HostedServerRow>();
      await run(failedSetups.results, async (row) => {
        if (await this.#retrySetup(row)) result.provisioned += 1;
      });
    }
    await this.#database
      .prepare(
        `UPDATE hosted_servers SET observed_state = 'error', observed_error = 'provider_error', claim_token_hash = NULL,
           updated_at = ?
         WHERE observed_state = 'creating' AND provider_sandbox_id IS NULL AND updated_at <= ?`,
      )
      .bind(now, now - CREATE_LOST_AFTER_MS)
      .run();
    // A running server with no use for 15 minutes stops. A state change also counts as use, so a new or
    // resized server has time for its first client.
    const unused = await this.#database
      .prepare(
        `SELECT ${ROW_COLUMNS} FROM hosted_servers
         WHERE desired_state = 'running' AND observed_state = 'running' AND provider_sandbox_id IS NOT NULL
           AND COALESCE(last_active_at, 0) <= ? AND updated_at <= ? LIMIT ?`,
      )
      .bind(now - IDLE_STOP_AFTER_MS, now - IDLE_STOP_AFTER_MS, TICK_BATCH_SIZE)
      .all<HostedServerRow>();
    result.idle = await run(unused.results, (row) => this.#stopIdle(row, now));
    // A server that must stop and still runs: the first stop did not happen.
    const unstopped = await this.#database
      .prepare(
        `SELECT ${ROW_COLUMNS} FROM hosted_servers
         WHERE desired_state IN ('idle', 'stopped') AND provider_sandbox_id IS NOT NULL
           AND observed_state IN ('starting', 'running', 'waking') AND updated_at <= ? LIMIT ?`,
      )
      .bind(now - STUCK_AFTER_MS, TICK_BATCH_SIZE)
      .all<HostedServerRow>();
    result.stopped += await run(unstopped.results, (row) => this.#stop(row));
    // The webhook starts a stopped server at once. This catches a start that did not happen.
    const stopped = await this.#database
      .prepare(
        `SELECT ${ROW_COLUMNS} FROM hosted_servers
         WHERE desired_state = 'running' AND observed_state = 'stopped' AND updated_at <= ? LIMIT ?`,
      )
      .bind(now - STUCK_AFTER_MS, TICK_BATCH_SIZE)
      .all<HostedServerRow>();
    result.restarted = await run(stopped.results, (row) => this.#wake(row, "restart"));
    const stuck = await this.#database
      .prepare(
        `SELECT ${ROW_COLUMNS} FROM hosted_servers
         WHERE desired_state != 'deleted' AND provider_sandbox_id IS NOT NULL
           AND observed_state IN ('starting', 'stopping', 'waking') AND updated_at <= ? LIMIT ?`,
      )
      .bind(now - STUCK_AFTER_MS, TICK_BATCH_SIZE)
      .all<HostedServerRow>();
    result.reconciled = await run(stuck.results, (row) => this.#refresh(row));
    // The Stripe webhook starts a resize at once. This catches a server that was busy then, or a failed stop.
    const resizing = await this.#database
      .prepare(
        `SELECT ${ROW_COLUMNS} FROM hosted_servers
         WHERE desired_state = 'running' AND observed_state = 'running' AND pending_size IS NOT NULL
           AND provider_sandbox_id IS NOT NULL AND updated_at <= ? LIMIT ?`,
      )
      .bind(now - STUCK_AFTER_MS, TICK_BATCH_SIZE)
      .all<HostedServerRow>();
    result.resized = await run(resizing.results, (row) => this.#resize(row));
    const deleting = await this.#database
      .prepare(
        `SELECT ${ROW_COLUMNS} FROM hosted_servers
         WHERE desired_state = 'deleted' AND observed_state != 'deleted' LIMIT ?`,
      )
      .bind(TICK_BATCH_SIZE)
      .all<HostedServerRow>();
    result.deleted = await run(deleting.results, (row) => this.#finishDelete(row));
    return result;
  }

  /** A Checkout page for a server that waits for payment, or none when the server needs no page. */
  async #checkout(
    row: HostedServerRow,
    user: AuthUser,
    billing: HostedServerBilling,
    returnTo: CheckoutReturn,
  ): Promise<HostedServerCheckout> {
    // A new server waits for its first payment. A server whose plan was cancelled gets a new plan.
    const awaiting = row.observed_state === "awaiting_payment" && row.desired_state === "running";
    // Only the end of a plan sets `stopped`. A provider error on the way can replace the reason.
    const ended = row.desired_state === "stopped";
    if (!awaiting && !ended) return { server: summary(row), checkoutUrl: null };
    // A plan that is open but not paid gets its payment in the Customer Portal, not a second plan.
    if (ended && (await this.#openPlanExists(row))) {
      throw new HostedServerServiceError(409, "hosted_server_payment_due", "Update the payment method in Billing.");
    }
    const previous = row.checkout_session_id;
    // Only one page can be open, so a user cannot pay twice for one server.
    if (previous && (await billing.closeCheckout(previous)) === "paid") {
      return { server: summary(await this.#requireRow(row.server_id)), checkoutUrl: null };
    }
    const session = await billing.createCheckout({
      user: { id: user.id, email: user.email },
      serverId: row.server_id,
      plan: row.plan,
      interval: row.billing_interval,
      currency: row.currency,
      target: returnTo.target,
      origin: returnTo.origin,
    });
    const stored = await this.#database
      .prepare(
        `UPDATE hosted_servers SET checkout_session_id = ?, updated_at = ?
         WHERE server_id = ? AND checkout_session_id IS ?
           AND ((observed_state = 'awaiting_payment' AND desired_state = 'running') OR desired_state = 'stopped')`,
      )
      .bind(session.sessionId, this.#now(), row.server_id, previous)
      .run();
    if (stored.meta.changes !== 1) {
      // A second request stored its page first. This page closes, so only that one can take a payment.
      await this.#closeCheckout(session.sessionId);
      throw new HostedServerServiceError(409, "hosted_server_conflict", "Try the request again.");
    }
    return { server: summary(await this.#requireRow(row.server_id)), checkoutUrl: session.url };
  }

  /**
   * Stores a plan change from the Customer Portal, so the list and a renewal use the plan that the
   * owner pays for. A server with a sandbox gets the new machine at its next resume (`pending_size`).
   */
  async #followPlan(row: HostedServerRow, sync: SubscriptionSync): Promise<void> {
    if (row.plan === sync.plan && row.billing_interval === sync.interval && row.currency === sync.currency) return;
    const size = HOSTED_PLAN_SIZE[sync.plan];
    await this.#database
      .prepare(
        `UPDATE hosted_servers SET plan = ?, billing_interval = ?, currency = ?,
           size = CASE WHEN provider_template IS NULL THEN ? ELSE size END,
           pending_size = CASE WHEN provider_template IS NULL OR size = ? THEN NULL ELSE ? END, updated_at = ?
         WHERE server_id = ? AND desired_state != 'deleted'`,
      )
      .bind(sync.plan, sync.interval, sync.currency, size, size, size, this.#now(), row.server_id)
      .run();
    if (row.provider_sandbox_id) await this.#rename({ ...row, plan: sync.plan }, row.provider_sandbox_id);
  }

  /**
   * Moves a running server to the machine of its new plan. boat changes the size only on a resume, so
   * the server stops first: boat saves the disk, and the restart after the stop (`#observe`) resumes
   * the sandbox on the new machine. The server is offline for this time.
   */
  async #resize(row: HostedServerRow): Promise<void> {
    const boat = this.#boat;
    if (!boat || !row.provider_sandbox_id || !row.pending_size) return;
    if (row.desired_state !== "running" || row.observed_state !== "running") return;
    try {
      await boat.stopSandbox(row.provider_sandbox_id);
    } catch (error) {
      // 409: the sandbox cannot stop in its current state. The cron tries again.
      if (error instanceof BoatApiError && error.status === 409) return;
      throw error;
    }
    await this.#database
      .prepare(
        `UPDATE hosted_servers SET observed_state = 'stopping', updated_at = ?
         WHERE server_id = ? AND desired_state = 'running' AND observed_state = 'running'`,
      )
      .bind(this.#now(), row.server_id)
      .run();
  }

  /** Makes the server match its plan. `getServerEntitlement` is the only place that decides the plan. */
  async #applyPlan(row: HostedServerRow): Promise<"provisioned" | "renewed" | "stopped" | null> {
    if (row.desired_state === "deleted") return null;
    const entitlement = await getServerEntitlement(this.#database, row.server_id, this.#now());
    if (entitlement) {
      if (row.observed_state === "awaiting_payment") {
        await this.#provision(row);
        return "provisioned";
      }
      if (row.desired_state === "stopped") {
        await this.#renew(row);
        return "renewed";
      }
      return null;
    }
    if (
      (row.desired_state === "running" || row.desired_state === "idle") &&
      row.observed_state !== "awaiting_payment"
    ) {
      await this.#endPlan(row);
      return "stopped";
    }
    return null;
  }

  /** Makes the sandbox of a paid server. Only one caller wins the change from `awaiting_payment`. */
  async #provision(row: HostedServerRow): Promise<void> {
    const boat = this.#boat;
    const template = this.#template;
    const secret = await this.#claimKey();
    // Thrown before the row changes, so the webhook retry or the cron provisions it later.
    if (!boat || !template || !secret) {
      throw new HostedServerServiceError(503, "hosting_not_configured", "Hosted servers are not configured.");
    }
    // The claim works from now, so its lifetime counts from the start of the sandbox, not from the payment page.
    // A VM that signed in during a lost attempt keeps its session, and the claim stays spent.
    const claim = await hostedClaim(secret, row.server_id);
    // A retry sends the request of the first attempt, also after a deploy that changed the template.
    const from = row.provider_template ?? template;
    const now = this.#now();
    const claimed = await this.#database
      .prepare(
        `UPDATE hosted_servers SET observed_state = 'creating', last_wake_reason = 'create',
           claim_token_hash = CASE WHEN ${CLAIM_OPEN_SQL} THEN ? ELSE claim_token_hash END,
           claim_expires_at = CASE WHEN ${CLAIM_OPEN_SQL} THEN ? ELSE claim_expires_at END,
           claim_redeemed_at = CASE WHEN ${CLAIM_OPEN_SQL} THEN NULL ELSE claim_redeemed_at END,
           provider_template = COALESCE(provider_template, ?), checkout_session_id = NULL, provider_event_at = ?,
           last_active_at = ?, lease_until = ?, updated_at = ?
         WHERE server_id = ? AND observed_state = 'awaiting_payment' AND desired_state = 'running'`,
      )
      .bind(await sha256(claim), now + CLAIM_TTL_MS, from, now, now, now + LEASE_TTL_SECONDS * 1000, now, row.server_id)
      .run();
    if (claimed.meta.changes !== 1) return;
    const request = createRequest(row, from, claim);
    try {
      // The same idempotency key and request body make a retry safe: boat returns the sandbox that it made.
      const sandbox = await boat.createSandbox(request).catch((error: unknown) => {
        if (error instanceof BoatApiError && error.code === "network_error") return boat.createSandbox(request);
        throw error;
      });
      const stored = await this.#database
        .prepare(
          `UPDATE hosted_servers SET provider_sandbox_id = ?, observed_state = ?, updated_at = ?
           WHERE server_id = ? AND observed_state = 'creating'`,
        )
        .bind(sandbox.id, isUsable(sandbox.state) ? "running" : "starting", this.#now(), row.server_id)
        .run();
      if (stored.meta.changes !== 1 && !(await this.#adopt(row, sandbox, claim))) {
        // The server was deleted after the cron gave up on this create. The sandbox costs money until it is deleted.
        console.warn("Hosted server sandbox has no row.", { serverId: row.server_id });
        await boat.deleteSandbox(sandbox.id).catch((error: unknown) => {
          console.warn("Hosted server sandbox delete failed.", {
            serverId: row.server_id,
            error: safeErrorCode(error),
          });
        });
        return;
      }
      this.#track(row, { name: "hosted_server_action", action: "provisioned", plan: row.plan, size: row.size });
      await this.#rename(row, sandbox.id);
    } catch (error) {
      console.warn("Hosted server provisioning failed.", { serverId: row.server_id, error: safeErrorCode(error) });
      const failed = providerError(error);
      // Only the setup that is still running: a delete or the end of the plan keeps its own state.
      await this.#database
        .prepare(
          `UPDATE hosted_servers SET observed_state = 'error', observed_error = ?, claim_token_hash = NULL, updated_at = ?
           WHERE server_id = ? AND observed_state = 'creating' AND provider_sandbox_id IS NULL`,
        )
        .bind(failed, this.#now(), row.server_id)
        .run();
      this.#track(row, { name: "hosted_server_action", action: "setup_failed", plan: row.plan, error: failed });
    }
  }

  /**
   * Stores a sandbox whose create the cron gave up on. Only a Worker that stops during the call leaves a
   * create for the cron, so this is a guard for that case. A server deleted since then does not keep it.
   * The claim works again, so the VM can sign in, and the VM restarts until it does.
   */
  async #adopt(row: HostedServerRow, sandbox: { id: string; state: BoatSandboxState }, claim: string) {
    const now = this.#now();
    const adopted = await this.#database
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
        await sha256(claim),
        now + CLAIM_TTL_MS,
        now,
        row.server_id,
      )
      .run();
    return adopted.meta.changes === 1;
  }

  /**
   * Gives the sandbox a name that an operator can find in the boat dashboard: the plan, the owner's
   * email and the start of the server ID. The name is not an address. A failure keeps the old name.
   */
  async #rename(row: HostedServerRow, sandboxId: string): Promise<void> {
    const boat = this.#boat;
    if (!boat) return;
    try {
      const owner = await this.#database
        .prepare("SELECT email FROM users WHERE id = ?")
        .bind(row.owner_user_id)
        .first<{ email: string }>();
      if (!owner) return;
      await boat.renameSandbox(sandboxId, sandboxName(row.plan, owner.email, row.server_id));
    } catch (error) {
      console.warn("Hosted server rename failed.", { serverId: row.server_id, error: safeErrorCode(error) });
    }
  }

  /** Removes a server whose first payment never came. A Checkout paid at the last minute keeps it. */
  async #removeUnpaid(row: HostedServerRow, now: number): Promise<boolean> {
    if (row.checkout_session_id && (await this.#billing?.closeCheckout(row.checkout_session_id)) === "paid") {
      return false;
    }
    const removed = await this.#database
      .prepare(
        `UPDATE hosted_servers SET desired_state = 'deleted', observed_state = 'deleted', checkout_session_id = NULL,
           deleted_at = ?, updated_at = ?
         WHERE server_id = ? AND observed_state = 'awaiting_payment' AND desired_state = 'running'
           AND checkout_session_id IS ?`,
      )
      .bind(now, now, row.server_id, row.checkout_session_id)
      .run();
    return removed.meta.changes === 1;
  }

  /** Reads the real state of the sandbox from the provider. A sandbox that boat does not have is gone. */
  async #refresh(row: HostedServerRow): Promise<void> {
    const boat = this.#boat;
    const sandboxId = row.provider_sandbox_id;
    if (!boat || !sandboxId) return;
    const state = await boat.getSandbox(sandboxId).then(
      (sandbox) => sandbox.state,
      (error: unknown) => {
        if (error instanceof BoatApiError && error.status === 404) return "cancelled" as const;
        throw error;
      },
    );
    await this.#observe(row, state, this.#now());
  }

  /**
   * Sets up a paid server again after its setup failed. It has no sandbox, so it has no data. The retry
   * sends the same idempotency key and request body. When the failed call made a sandbox, boat returns
   * that sandbox, and the row stores it.
   */
  async #retrySetup(row: HostedServerRow): Promise<boolean> {
    if (row.desired_state !== "running" || row.observed_state !== "error" || row.provider_sandbox_id) return false;
    if (!(await getServerEntitlement(this.#database, row.server_id, this.#now()))) return false;
    const reset = await this.#database
      .prepare(
        `UPDATE hosted_servers SET observed_state = 'awaiting_payment', observed_error = NULL, updated_at = ?
         WHERE server_id = ? AND desired_state = 'running' AND observed_state = 'error' AND provider_sandbox_id IS NULL`,
      )
      .bind(this.#now(), row.server_id)
      .run();
    if (reset.meta.changes !== 1) return false;
    await this.#provision(await this.#requireRow(row.server_id));
    return true;
  }

  /**
   * The plan of a stopped server is open again, so the server starts with its data. A server whose first
   * setup failed has no sandbox and no data, so it is set up again.
   */
  async #renew(row: HostedServerRow): Promise<void> {
    if (!row.provider_sandbox_id) {
      const reset = await this.#database
        .prepare(
          `UPDATE hosted_servers SET desired_state = 'running', observed_state = 'awaiting_payment',
             observed_error = NULL, updated_at = ?
           WHERE server_id = ? AND desired_state = 'stopped' AND provider_sandbox_id IS NULL`,
        )
        .bind(this.#now(), row.server_id)
        .run();
      if (reset.meta.changes !== 1) return;
      this.#track(row, { name: "hosted_server_action", action: "renewed", plan: row.plan, size: row.size });
      await this.#provision(await this.#requireRow(row.server_id));
      return;
    }
    const renewed = await this.#database
      .prepare(
        `UPDATE hosted_servers SET desired_state = 'running', checkout_session_id = NULL,
           observed_error = CASE WHEN observed_error = 'plan_ended' THEN NULL ELSE observed_error END, updated_at = ?
         WHERE server_id = ? AND desired_state = 'stopped'`,
      )
      .bind(this.#now(), row.server_id)
      .run();
    if (renewed.meta.changes !== 1) return;
    this.#track(row, { name: "hosted_server_action", action: "renewed", plan: row.plan, size: row.size });
    // A server that still stops starts again when the provider reports that it stopped.
    await this.#wake(await this.#requireRow(row.server_id), "restart");
  }

  /** The plan ended: the server stops and keeps its data. It is never deleted for this. */
  async #endPlan(row: HostedServerRow): Promise<void> {
    const ended = await this.#database
      .prepare(
        `UPDATE hosted_servers SET desired_state = 'stopped', observed_error = 'plan_ended', claim_token_hash = NULL,
           updated_at = ?
         WHERE server_id = ? AND desired_state IN ('running', 'idle')`,
      )
      .bind(this.#now(), row.server_id)
      .run();
    if (ended.meta.changes !== 1) return;
    this.#track(row, { name: "hosted_server_action", action: "plan_stopped", plan: row.plan, size: row.size });
    try {
      await this.#stop(await this.#requireRow(row.server_id));
    } catch (error) {
      // The row records the stop, and the cron sends it again.
      console.warn("Hosted server stop failed.", { serverId: row.server_id, error: safeErrorCode(error) });
    }
  }

  /** boat saves the disk before it stops the sandbox, and refuses the stop when the save fails. */
  async #stop(row: HostedServerRow): Promise<void> {
    const boat = this.#boat;
    if (!boat || !row.provider_sandbox_id || row.observed_state === "stopping" || row.observed_state === "stopped") {
      return;
    }
    try {
      await boat.stopSandbox(row.provider_sandbox_id);
    } catch (error) {
      // 409: the sandbox cannot stop in its current state. A lost event can hide that it is stopped
      // already, so the provider is asked. Else the cron tries again.
      if (error instanceof BoatApiError && error.status === 409) return this.#refresh(row);
      throw error;
    }
    await this.#database
      .prepare(
        `UPDATE hosted_servers SET observed_state = 'stopping', updated_at = ?
         WHERE server_id = ? AND desired_state IN ('idle', 'stopped') AND observed_state = ?`,
      )
      .bind(this.#now(), row.server_id, row.observed_state)
      .run();
  }

  /** Stops a server with no use. Activity that comes in first keeps it running. */
  async #stopIdle(row: HostedServerRow, now: number): Promise<void> {
    const idle = await this.#database
      .prepare(
        `UPDATE hosted_servers SET desired_state = 'idle', updated_at = ?
         WHERE server_id = ? AND desired_state = 'running' AND observed_state = 'running'
           AND COALESCE(last_active_at, 0) <= ?`,
      )
      .bind(this.#now(), row.server_id, now - IDLE_STOP_AFTER_MS)
      .run();
    if (idle.meta.changes !== 1) return;
    this.#track(row, { name: "hosted_server_action", action: "idle_stopped", plan: row.plan, size: row.size });
    await this.#stop({ ...row, desired_state: "idle" });
  }

  /** Moves the boat stop time of a server in use, so boat does not stop it. */
  async #extendLease(row: HostedServerRow, now: number): Promise<void> {
    const boat = this.#boat;
    if (!boat || !row.provider_sandbox_id || row.observed_state !== "running") return;
    if (row.lease_until !== null && row.lease_until - now > LEASE_EXTEND_BEFORE_MS) return;
    await boat.extendSandbox(row.provider_sandbox_id, LEASE_TTL_SECONDS);
    await this.#database
      .prepare("UPDATE hosted_servers SET lease_until = ? WHERE server_id = ?")
      .bind(now + LEASE_TTL_SECONDS * 1000, row.server_id)
      .run();
  }

  /**
   * Cancels the plan of a server that its owner deletes: now, with no refund. A failure keeps the
   * server, so the owner never pays for a server that is gone.
   */
  async #cancelPlans(row: HostedServerRow): Promise<void> {
    const billing = this.#billing;
    if (!billing) {
      if (await this.#openPlanExists(row)) throw billingFailed();
      return;
    }
    // A payment that finished just now keeps the server, so the owner does not lose it with no refund
    // before they see it. A payment on this page after the close is cancelled by `onSubscriptionSynced`.
    if (row.checkout_session_id && (await this.#closeCheckout(row.checkout_session_id)) === "paid") {
      throw new HostedServerServiceError(
        409,
        "hosted_server_paid",
        "The payment for this server finished. Delete it again to cancel the plan with no refund.",
      );
    }
    try {
      await billing.cancelServerPlans(row.owner_user_id, row.server_id);
    } catch (error) {
      console.warn("Hosted server plan cancel failed.", { serverId: row.server_id, error: safeErrorCode(error) });
      throw billingFailed();
    }
  }

  async #openPlanExists(row: HostedServerRow): Promise<boolean> {
    const open = await this.#database
      .prepare(
        `SELECT 1 AS open FROM billing_subscriptions
         WHERE server_id = ? AND user_id = ? AND status IN ${OPEN_STATUSES_SQL} LIMIT 1`,
      )
      .bind(row.server_id, row.owner_user_id)
      .first<{ open: number }>();
    return open !== null;
  }

  async #closeCheckout(sessionId: string): Promise<"closed" | "paid" | null> {
    try {
      return (await this.#billing?.closeCheckout(sessionId)) ?? null;
    } catch (error) {
      // The page closes by itself after 35 minutes.
      console.warn("Checkout close failed.", { error: safeErrorCode(error) });
      return null;
    }
  }

  /** The row keeps the reason of a failed resume, so the client gets it in the summary, not as a 500. */
  async #wakeForClient(row: HostedServerRow): Promise<void> {
    try {
      await this.#wake(row, "message");
    } catch (error) {
      console.warn("Hosted server wake failed.", { serverId: row.server_id, error: safeErrorCode(error) });
    }
  }

  async #wake(row: HostedServerRow, reason: WakeReason): Promise<void> {
    const now = this.#now();
    // A stopping server starts again when the provider reports that it stopped.
    if (row.observed_state !== "stopped" && !(row.observed_state === "error" && row.provider_sandbox_id)) return;
    // A VM that never signed in, or whose session the owner revoked, has its claim in its env file. The
    // claim works again for this start.
    const secret = await this.#claimKey();
    const claimHash = secret ? await sha256(await hostedClaim(secret, row.server_id)) : null;
    const waking = await this.#database
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
      .run();
    if (waking.meta.changes !== 1) return;
    if (reason !== "create") {
      this.#track(row, { name: "hosted_server_action", action: "woken", plan: row.plan, size: row.size, reason });
    }
    await this.#resume(row);
  }

  async #resume(row: HostedServerRow): Promise<void> {
    const boat = this.#boat;
    if (!boat || !row.provider_sandbox_id) return;
    const size = row.pending_size;
    try {
      await boat.resumeSandbox(row.provider_sandbox_id, LEASE_TTL_SECONDS, size ?? undefined);
    } catch (error) {
      if (size && error instanceof BoatApiError && error.code === "type_too_small") {
        // The data does not fit the smaller machine of the new plan. The server keeps its machine, and
        // the Worker does not try again until the next plan change.
        console.warn("Hosted server resize refused.", { serverId: row.server_id, error: safeErrorCode(error) });
        await this.#database
          .prepare(
            "UPDATE hosted_servers SET pending_size = NULL, updated_at = ? WHERE server_id = ? AND pending_size = ?",
          )
          .bind(this.#now(), row.server_id, size)
          .run();
        return this.#resume({ ...row, pending_size: null });
      }
      // 409: the provider already resumes or runs it; the webhook or the cron reports the result. boat
      // kept its old stop time, so the next activity sets a new one.
      if (error instanceof BoatApiError && error.status === 409) {
        await this.#database
          .prepare("UPDATE hosted_servers SET lease_until = NULL WHERE server_id = ?")
          .bind(row.server_id)
          .run();
        return;
      }
      await this.#database
        .prepare(
          `UPDATE hosted_servers SET observed_state = 'error', observed_error = ?, updated_at = ?
           WHERE server_id = ? AND observed_state = 'waking'`,
        )
        .bind(providerError(error), this.#now(), row.server_id)
        .run();
      throw error;
    }
    if (size) {
      await this.#database
        .prepare(
          "UPDATE hosted_servers SET size = ?, pending_size = NULL, updated_at = ? WHERE server_id = ? AND pending_size = ?",
        )
        .bind(size, this.#now(), row.server_id, size)
        .run();
      this.#track(row, { name: "hosted_server_action", action: "resized", plan: row.plan, size });
    }
  }

  async #observe(row: HostedServerRow, state: BoatSandboxState, eventAt: number): Promise<void> {
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
    const updated = await this.#database
      .prepare(
        `UPDATE hosted_servers SET observed_state = ?, observed_error = ?, provider_event_at = ?, updated_at = ?
         WHERE server_id = ? AND desired_state != 'deleted' AND (provider_event_at IS NULL OR provider_event_at <= ?)`,
      )
      .bind(observed, error, eventAt, this.#now(), row.server_id, eventAt)
      .run();
    if (updated.meta.changes !== 1 || observed !== "stopped") return;
    // The provider stops a server, for example for maintenance or at the end of its lease, and a resize
    // stops it. A server in use must run, so it starts again. An idle server stays stopped (`#wake`).
    await this.#wake(await this.#requireRow(row.server_id), "restart");
  }

  async #finishDelete(row: HostedServerRow): Promise<void> {
    // A create call runs and can still return a sandbox. The cron deletes it after the call ends.
    if (row.observed_state === "creating" && !row.provider_sandbox_id) return;
    const sandboxId = row.provider_sandbox_id ?? (await this.#findLostSandbox(row));
    if (sandboxId) {
      if (!this.#boat) throw new HostedServerServiceError(503, "hosting_not_configured", "Hosting is not configured.");
      try {
        await this.#boat.deleteSandbox(sandboxId);
      } catch (error) {
        throw new HostedServerServiceError(
          502,
          "hosted_server_provider_failed",
          `Deletion failed: ${safeErrorCode(error)}`,
        );
      }
    }
    // Before the row is final, so the cron removes the host again when this fails.
    await this.#removeHost?.(row.owner_user_id, row.server_id);
    const now = this.#now();
    await this.#database.batch([
      this.#database
        .prepare(
          `UPDATE hosted_servers SET observed_state = 'deleted', claim_token_hash = NULL,
             deleted_at = ?, updated_at = ?
           WHERE server_id = ?`,
        )
        .bind(now, now, row.server_id),
      this.#database
        .prepare("UPDATE auth_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL")
        .bind(now, row.auth_session_id),
    ]);
  }

  /**
   * A create whose answer was lost can have made a sandbox that the row does not name. The same request
   * returns that sandbox, so the delete removes it too. The deleted row refuses the claim of the VM.
   */
  async #findLostSandbox(row: HostedServerRow): Promise<string | null> {
    const boat = this.#boat;
    const secret = await this.#claimKey();
    if (!boat || !secret || !row.provider_template) return null;
    try {
      const request = createRequest(row, row.provider_template, await hostedClaim(secret, row.server_id));
      return (await boat.createSandbox(request)).id;
    } catch (error) {
      console.warn("Hosted server lost sandbox lookup failed.", {
        serverId: row.server_id,
        error: safeErrorCode(error),
      });
      return null;
    }
  }

  /**
   * The key of the claims. It comes from the Remote ticket key, which only the Worker has, so hosting
   * needs no secret of its own. It uses only the private value `d`: the same key in other JSON gives the
   * same claims. A new ticket key changes each claim (see docs/hosted-servers.md).
   */
  async #claimKey(): Promise<string | null> {
    const ticketKey = this.#ticketKey;
    if (!ticketKey) return null;
    this.#claimSecret ??= deriveSecret(ticketPrivateValue(ticketKey), "openbot-hosted-claim-key:v1");
    return this.#claimSecret;
  }

  #track(row: HostedServerRow, event: AccountAnalyticsEvent): void {
    this.#analytics.track(row.owner_user_id, event);
  }

  #requireAvailable(userId: string): { billing: HostedServerBilling } {
    if (!this.isAvailableFor(userId) || !this.#billing) {
      throw new HostedServerServiceError(
        403,
        "hosting_unavailable",
        "Hosted servers are not available for this account.",
      );
    }
    return { billing: this.#billing };
  }

  async #requireRow(serverId: string): Promise<HostedServerRow> {
    const row = await this.#database
      .prepare(`SELECT ${ROW_COLUMNS} FROM hosted_servers WHERE server_id = ?`)
      .bind(serverId)
      .first<HostedServerRow>();
    if (!row) throw notFound();
    return row;
  }
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

async function hostedClaim(secret: string, serverId: string): Promise<string> {
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
