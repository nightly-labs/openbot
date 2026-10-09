import { Effect } from "effect";
import { createAccountAnalytics } from "./account-analytics";
import { BillingSales } from "./billing-sales";
import { BillingService } from "./billing-service";
import {
  type HostedServerBindings,
  HostedServerService,
  type HostedServerServiceOptions,
} from "./hosted-server-service";
import type { RemoteFailure } from "./remote-control-plane";
import type { WorkerBindings } from "./types";

export type HostedBillingBindings = HostedServerBindings &
  Partial<
    Pick<
      WorkerBindings,
      "STRIPE_SECRET_KEY" | "STRIPE_WEBHOOK_SECRET" | "OPENPANEL_CLIENT_ID" | "OPENPANEL_CLIENT_SECRET"
    >
  >;

/**
 * Billing and hosted servers, linked in both directions: a server starts a Checkout, and a stored
 * subscription starts or stops its server. Billing is null when the deployment has no Stripe key.
 */
export function createHostedBilling(
  bindings: HostedBillingBindings,
  options: Pick<HostedServerServiceOptions, "removeHost" | "developerKey"> & {
    /** Tells the members of a host that its plan, and so its member limit, can be different. */
    planChanged: (hostId: string) => Effect.Effect<void, RemoteFailure>;
    /** Keeps the Worker alive until an analytics send ends (`waitUntil`). */
    schedule: (work: Effect.Effect<void>) => void;
  },
): { billing: BillingService | null; hosting: HostedServerService } {
  const analytics = createAccountAnalytics({
    clientId: bindings.OPENPANEL_CLIENT_ID,
    clientSecret: bindings.OPENPANEL_CLIENT_SECRET,
    fetch: (input, init) => fetch(input, init),
    schedule: options.schedule,
  });
  const secretKey = bindings.STRIPE_SECRET_KEY?.trim();
  const sales =
    bindings.OPENPANEL_CLIENT_ID?.trim() && bindings.OPENPANEL_CLIENT_SECRET?.trim()
      ? new BillingSales({
          database: bindings.DB,
          clientId: bindings.OPENPANEL_CLIENT_ID,
          clientSecret: bindings.OPENPANEL_CLIENT_SECRET,
          fetch: (input, init) => fetch(input, init),
        })
      : undefined;
  const billing = secretKey
    ? new BillingService({
        database: bindings.DB,
        secretKey,
        webhookSecret: bindings.STRIPE_WEBHOOK_SECRET?.trim() || null,
        fetch: (input, init) => fetch(input, init),
        analytics,
        sales,
        onSubscriptionSynced: (sync) =>
          hosting.onSubscriptionSynced(sync).pipe(Effect.andThen(() => options.planChanged(sync.serverId))),
      })
    : null;
  const hosting = new HostedServerService(bindings, {
    removeHost: options.removeHost,
    developerKey: options.developerKey ?? null,
    billing,
    analytics,
  });
  return { billing, hosting };
}
