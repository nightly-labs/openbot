import { Effect, Result } from "effect";
import { routeRequest as routeHostedSiteRequest } from "../../../site-router/src/index";
import { passkeyWalletHostResponse } from "../lib/near-sign-csp";
import { OPENBOT_SITE_URL } from "../lib/site-metadata";
import { sendAccountActivitySnapshots } from "./account-activity";
import { createAccountAnalytics, createAccountEventDelivery } from "./account-analytics";
import { type AuthRetentionResult, pruneExpiredAuthData } from "./auth-data-retention";
import { BillingSales } from "./billing-sales";
import { BillingService } from "./billing-service";
import { captureBillingSnapshot } from "./billing-snapshots";
import { canonicalHostRedirect, permanentTrailingSlashRedirect } from "./canonical-redirect";
import { CreditAudit } from "./credit-audit";
import { CreditGrants } from "./credit-grants";
import { CreditMediaService } from "./credit-media-service";
import { runApiEffect } from "./effect-runtime";
import { createHostedBilling } from "./hosted-billing";
import { createHostedPoolAlert } from "./hosted-pool-alert";
import { readHostedPool } from "./hosted-pool-snapshot";
import type { HostedServerBindings } from "./hosted-server-service";
import { HostedSiteService } from "./hosted-site-service";
import { enforceMarketplaceIngress, MarketplaceRateLimitError } from "./marketplace-request-policy";
import { mediaGatewayFromBinding } from "./media-gateway";
import { d1OverloadedRecently, observedD1 } from "./observed-d1";
import { pageMarkdownResponse } from "./page-markdown";
import {
  deliverPendingRemoteAuthEvents,
  type RemoteAuthEventBindings,
  RemoteControlPlane,
  type RemoteFailure,
} from "./remote-control-plane";
import { SalesAnalyticsDelivery } from "./sales-analytics-delivery";
import { checkSignalEntry, SIGNAL_ENTRY_CRON, type SignalEntryBindings } from "./signal-entry-failover";
import type { WorkerBindings } from "./types";

type WorkerFetch = (request: Request) => Response | Promise<Response>;
type AuthDataPruner = typeof pruneExpiredAuthData;
type RetentionLogger = (result: AuthRetentionResult) => void;
type WorkerExecutionContext = Pick<ExecutionContext, "waitUntil">;
type RemoteAuthEventDelivery = typeof deliverPendingRemoteAuthEvents;

const OVERLOAD_RETRY_AFTER_MIN_SECONDS = 10;
const OVERLOAD_RETRY_AFTER_SPREAD_SECONDS = 20;

function withOverloadRetryAfter(response: Response): Response {
  if (response.status !== 500 || response.headers.has("Retry-After") || !d1OverloadedRecently(Date.now())) {
    return response;
  }
  const delayed = new Response(response.body, response);
  delayed.headers.set(
    "Retry-After",
    String(OVERLOAD_RETRY_AFTER_MIN_SECONDS + Math.floor(Math.random() * (OVERLOAD_RETRY_AFTER_SPREAD_SECONDS + 1))),
  );
  return delayed;
}

export function createWorkerHandler(
  fetchHandler: WorkerFetch,
  prune: AuthDataPruner = pruneExpiredAuthData,
  log: RetentionLogger = logRetentionResult,
  deliverRemoteAuthEvents: RemoteAuthEventDelivery = deliverPendingRemoteAuthEvents,
) {
  return {
    async fetch(
      request: Request,
      workerBindings: Pick<WorkerBindings, "MARKETPLACE_INGRESS_RATE_LIMITER"> &
        Partial<
          Pick<WorkerBindings, "SITES" | "SITE_LOCAL_ORIGIN" | "DB" | "OPENPANEL_CLIENT_ID" | "OPENPANEL_CLIENT_SECRET">
        >,
      context?: WorkerExecutionContext,
    ) {
      const bindings = workerBindings.DB ? { ...workerBindings, DB: observedD1(workerBindings.DB) } : workerBindings;
      const hostRedirect = canonicalHostRedirect(request) ?? passkeyWalletHostResponse(request, OPENBOT_SITE_URL);
      if (hostRedirect) return hostRedirect;
      if (request.method === "GET" && new URL(request.url).pathname === "/billing/checkout-return") {
        return runApiEffect(checkoutReturnResponse(request, bindings));
      }
      const earlyResponse = await runApiEffect(
        Effect.gen(function* () {
          const localSiteResponse = yield* serveLocalHostedSite(request, bindings);
          if (localSiteResponse) return localSiteResponse;
          yield* enforceMarketplaceIngress(request, bindings);
          return null;
        }).pipe(
          Effect.catchIf(
            (error) => error instanceof MarketplaceRateLimitError,
            (error) =>
              Effect.succeed(
                Response.json(
                  { error: { code: error.code, message: error.message } },
                  {
                    status: error.status,
                    headers: {
                      "Cache-Control": "no-store",
                      "Retry-After": String(error.retryAfterSeconds),
                      "X-Content-Type-Options": "nosniff",
                    },
                  },
                ),
              ),
          ),
        ),
      );
      if (earlyResponse) return earlyResponse;
      const markdown = await pageMarkdownResponse(request, fetchHandler);
      if (markdown) return markdown;
      const response = Promise.resolve(fetchHandler(request)).then((result) =>
        withOverloadRetryAfter(permanentTrailingSlashRedirect(request, result)),
      );
      if (context && isEmailSignInStart(request)) {
        context.waitUntil(
          response.then(
            () => undefined,
            () => undefined,
          ),
        );
      }
      return response;
    },
    async scheduled(
      controller: Pick<ScheduledController, "scheduledTime"> & Partial<Pick<ScheduledController, "cron">>,
      workerBindings: RemoteAuthEventBindings &
        Partial<Pick<WorkerBindings, "SITES" | HostedServerTickBindingKey> & SignalEntryBindings>,
    ) {
      const bindings = { ...workerBindings, DB: observedD1(workerBindings.DB) };
      if (controller.cron === SIGNAL_ENTRY_CRON) {
        await runSignalEntryCheck(bindings);
        return;
      }
      const now = controller.scheduledTime;
      const hostingThenRetention = Effect.gen(function* () {
        const hostingResult = bindings.BOAT_API_KEY ? yield* tickHostedServers(bindings, now) : null;
        if (hostingResult && Object.values(hostingResult).some(Boolean)) {
          console.info("Hosted server check completed.", hostingResult);
        }
        return isDailyRetentionRun(now) ? yield* prune(bindings.DB, now) : null;
      });
      const [retention, , sites] = await runApiEffect(
        Effect.all(
          [
            Effect.exit(hostingThenRetention),
            Effect.exit(deliverRemoteAuthEvents(bindings, now)),
            Effect.exit(
              bindings.SITES ? new HostedSiteService(bindings.DB, bindings.SITES).cleanup(now) : Effect.succeed(null),
            ),
            Effect.exit(tickSalesAnalytics(bindings, now)),
            Effect.exit(tickHostedPool(bindings, now)),
            Effect.exit(tickReferralCredit(bindings)),
            Effect.exit(tickCreditHolds(bindings, now)),
            Effect.exit(tickCreditGrants(bindings, now)),
            Effect.exit(tickAccountActivity(bindings, now)),
          ],
          { concurrency: "unbounded" },
        ).pipe(
          Effect.flatMap(
            ([
              retentionExit,
              deliveryExit,
              sitesExit,
              salesExit,
              poolExit,
              referralExit,
              holdsExit,
              grantsExit,
              activityExit,
            ]) =>
              Effect.all([
                retentionExit,
                deliveryExit,
                sitesExit,
                salesExit,
                poolExit,
                referralExit,
                holdsExit,
                grantsExit,
                activityExit,
              ]),
          ),
        ),
      );
      if (retention) log(retention);
      if (sites) console.info("Hosted site cleanup completed.", sites);
    },
  } satisfies ExportedHandler<WorkerBindings>;
}

async function runSignalEntryCheck(bindings: Partial<SignalEntryBindings>): Promise<void> {
  const result = await Effect.runPromise(
    Effect.result(checkSignalEntry(bindings, { fetch: (input, init) => fetch(input, init) })),
  );
  if (Result.isFailure(result)) {
    console.error("Signal entry check failed.", { operation: result.failure.operation, status: result.failure.status });
    return;
  }
  const check = result.success;
  if (check.status === "moved") console.warn("Signal entry moved.", check);
  else if (check.status === "kept" || check.status === "unknown") console.warn("Signal entry not changed.", check);
}

type SalesBindings = Pick<WorkerBindings, "DB"> &
  Partial<
    Pick<
      WorkerBindings,
      "STRIPE_SECRET_KEY" | "OPENPANEL_CLIENT_ID" | "OPENPANEL_CLIENT_SECRET" | "HOSTED_POOL_ALERT_WEBHOOK_URL"
    >
  >;

const tickSalesAnalytics = Effect.fn("SalesAnalytics.tick")(function* (bindings: SalesBindings, now: number) {
  if (!bindings.OPENPANEL_CLIENT_ID?.trim() || !bindings.OPENPANEL_CLIENT_SECRET?.trim()) return;
  const options = {
    database: bindings.DB,
    clientId: bindings.OPENPANEL_CLIENT_ID,
    clientSecret: bindings.OPENPANEL_CLIENT_SECRET,
    fetch: (input: string, init: RequestInit) => fetch(input, init),
  };
  const saleAlert = createHostedPoolAlert(bindings.HOSTED_POOL_ALERT_WEBHOOK_URL, options.fetch);
  const payments = yield* Effect.exit(new BillingSales({ ...options, saleAlert }).processPending());
  const snapshot = yield* Effect.exit(captureBillingSnapshot(bindings, now));
  const result = yield* new SalesAnalyticsDelivery(options).drain();
  console.info("Sales analytics delivery completed.", result);
  yield* payments;
  yield* snapshot;
});

const tickReferralCredit = Effect.fn("ReferralCredit.tick")(function* (bindings: SalesBindings) {
  const secretKey = bindings.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) return;
  const billing = new BillingService({
    database: bindings.DB,
    secretKey,
    webhookSecret: null,
    fetch: (input, init) => fetch(input, init),
  });
  yield* billing.releaseReferralCredit();
});

type AnalyticsBindings = Pick<WorkerBindings, "DB" | "OPENPANEL_CLIENT_ID" | "OPENPANEL_CLIENT_SECRET">;

function tickAnalytics(bindings: AnalyticsBindings) {
  const sends: Effect.Effect<void>[] = [];
  const analytics = createAccountAnalytics({
    clientId: bindings.OPENPANEL_CLIENT_ID,
    clientSecret: bindings.OPENPANEL_CLIENT_SECRET,
    fetch: (input, init) => fetch(input, init),
    schedule: (send) => sends.push(send),
    database: bindings.DB,
  });
  return { analytics, flush: Effect.suspend(() => Effect.all(sends, { concurrency: "unbounded", discard: true })) };
}

const tickCreditHolds = Effect.fn("CreditHolds.tick")(function* (
  bindings: AnalyticsBindings & { MEDIA_GATEWAY?: Fetcher | undefined },
  now: number,
) {
  const { analytics, flush } = tickAnalytics(bindings);
  const result = yield* new CreditMediaService({
    database: bindings.DB,
    gateway: mediaGatewayFromBinding(bindings.MEDIA_GATEWAY),
    now: () => now,
    analytics,
  })
    .sweep()
    .pipe(Effect.ensuring(flush));
  const auditPruned = yield* new CreditAudit(bindings.DB, () => now).prune();
  if (Object.values(result).some(Boolean) || auditPruned > 0)
    console.info("Credit hold sweep completed.", { ...result, auditPruned });
});

const tickCreditGrants = Effect.fn("CreditGrants.tick")(function* (bindings: AnalyticsBindings, now: number) {
  const { analytics, flush } = tickAnalytics(bindings);
  const result = yield* new CreditGrants({ database: bindings.DB, now: () => now, analytics })
    .sweep()
    .pipe(Effect.ensuring(flush));
  if (Object.values(result).some(Boolean)) console.info("Credit grant sweep completed.", result);
});

const tickAccountActivity = Effect.fn("AccountActivity.tick")(function* (bindings: AnalyticsBindings, now: number) {
  const deliver = createAccountEventDelivery({
    clientId: bindings.OPENPANEL_CLIENT_ID,
    clientSecret: bindings.OPENPANEL_CLIENT_SECRET,
    fetch: (input, init) => fetch(input, init),
  });
  yield* sendAccountActivitySnapshots(bindings.DB, deliver, now);
});

const tickHostedPool = Effect.fn("HostedPool.tick")(function* (bindings: SalesBindings, now: number) {
  if (!bindings.OPENPANEL_CLIENT_ID?.trim() || !bindings.OPENPANEL_CLIENT_SECRET?.trim()) return;
  const groups = yield* readHostedPool(bindings.DB, now);
  if (groups.length === 0) return;
  const { analytics, flush } = tickAnalytics(bindings);
  for (const group of groups) analytics.track(null, { name: "hosted_pool_snapshot", group });
  yield* flush;
});

const checkoutReturnResponse = Effect.fn("BillingSales.returnResponse")(function* (
  request: Request,
  bindings: Partial<SalesBindings>,
) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  let destination = "/billing/return?kind=plan";
  if (token && bindings.DB && bindings.OPENPANEL_CLIENT_ID && bindings.OPENPANEL_CLIENT_SECRET) {
    const sales = new BillingSales({
      database: bindings.DB,
      clientId: bindings.OPENPANEL_CLIENT_ID,
      clientSecret: bindings.OPENPANEL_CLIENT_SECRET,
      fetch: (input, init) => fetch(input, init),
    });
    destination =
      (yield* sales.returned(token).pipe(
        Effect.catch(() =>
          Effect.sync(() => {
            console.warn("Checkout return analytics failed.");
            return null;
          }),
        ),
      )) ?? destination;
  }
  const location = new URL(destination, url.origin);
  location.searchParams.set("cancelled", "1");
  return new Response(null, {
    status: 303,
    headers: {
      Location: location.href,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
});

type HostedServerTickBindingKey =
  | Exclude<keyof HostedServerBindings, "DB">
  | "REMOTE_TICKET_PRIVATE_JWK"
  | "REMOTE_TICKET_PUBLIC_JWKS"
  | "REMOTE_TICKET_KEY_ID"
  | "STRIPE_SECRET_KEY"
  | "STRIPE_WEBHOOK_SECRET"
  | "OPENPANEL_CLIENT_ID"
  | "OPENPANEL_CLIENT_SECRET";

function tickHostedServers(
  bindings: RemoteAuthEventBindings & Partial<Pick<WorkerBindings, HostedServerTickBindingKey>>,
  now: number,
) {
  let authEvents: Effect.Effect<void, RemoteFailure> | null = null;
  const remote = new RemoteControlPlane(bindings, {
    schedule: (delivery) => {
      authEvents = delivery;
    },
  });
  const sends: Effect.Effect<void>[] = [];
  return Effect.gen(function* () {
    const result = yield* createHostedBilling(bindings, {
      removeHost: (ownerUserId, hostId) => remote.deleteHost(ownerUserId, hostId),
      planChanged: (hostId) => remote.planChanged(hostId),
      licenseChanged: (userId) => remote.licenseChanged(userId),
      schedule: (send) => sends.push(send),
    }).hosting.tick(now);
    return result;
  }).pipe(
    Effect.ensuring(
      Effect.suspend(() =>
        Effect.all(
          [
            ...sends,
            (authEvents ?? Effect.void).pipe(
              Effect.catch(() => Effect.sync(() => console.warn("Remote auth event delivery failed."))),
            ),
          ],
          { concurrency: "unbounded", discard: true },
        ),
      ),
    ),
    Effect.catch(() =>
      Effect.sync(() => {
        console.warn("Hosted server check failed.");
        return null;
      }),
    ),
  );
}

function serveLocalHostedSite(
  request: Request,
  bindings: Partial<Pick<WorkerBindings, "SITES" | "SITE_LOCAL_ORIGIN">>,
) {
  if (!bindings.SITES || !bindings.SITE_LOCAL_ORIGIN) return Effect.succeed(null);
  const requestUrl = new URL(request.url);
  const configuredOrigin = new URL(bindings.SITE_LOCAL_ORIGIN);
  const suffix = `.${configuredOrigin.hostname}`;
  if (
    requestUrl.protocol !== configuredOrigin.protocol ||
    requestUrl.port !== configuredOrigin.port ||
    !requestUrl.hostname.endsWith(suffix)
  ) {
    return Effect.succeed(null);
  }
  const label = requestUrl.hostname.slice(0, -suffix.length);
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label)) return Effect.succeed(null);
  const hostedUrl = new URL(requestUrl);
  hostedUrl.protocol = "https:";
  hostedUrl.hostname = `${label}.openbot.site`;
  hostedUrl.port = "";
  return routeHostedSiteRequest(
    new Request(hostedUrl, request),
    { SITES: bindings.SITES, SITE_SERVE_ENABLED: "true", ACCOUNT_ORIGIN: configuredOrigin.origin },
    Date.now(),
  );
}

function isEmailSignInStart(request: Request): boolean {
  return (
    request.method === "POST" &&
    ["/v1/auth/email/start", "/api/browser/email/start"].includes(new URL(request.url).pathname)
  );
}

function isDailyRetentionRun(scheduledTime: number): boolean {
  const scheduled = new Date(scheduledTime);
  return scheduled.getUTCHours() === 0 && scheduled.getUTCMinutes() === 0;
}

function logRetentionResult(result: AuthRetentionResult): void {
  console.info("Auth data retention completed.", result);
}
