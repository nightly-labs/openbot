import { createAccountAnalytics } from "./account-analytics";
import { BillingService } from "./billing-service";
import {
  type HostedServerBindings,
  HostedServerService,
  type HostedServerServiceOptions,
} from "./hosted-server-service";
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
    planChanged: (hostId: string) => Promise<void>;
    /** Keeps the Worker alive until an analytics send ends (`waitUntil`). */
    schedule: (work: Promise<void>) => void;
  },
): { billing: BillingService | null; hosting: HostedServerService } {
  const analytics = createAccountAnalytics({
    clientId: bindings.OPENPANEL_CLIENT_ID,
    clientSecret: bindings.OPENPANEL_CLIENT_SECRET,
    fetch: (input, init) => fetch(input, init),
    schedule: options.schedule,
  });
  const secretKey = bindings.STRIPE_SECRET_KEY?.trim();
  const billing = secretKey
    ? new BillingService({
        database: bindings.DB,
        secretKey,
        webhookSecret: bindings.STRIPE_WEBHOOK_SECRET?.trim() || null,
        fetch: (input, init) => fetch(input, init),
        analytics,
        onSubscriptionSynced: async (sync) => {
          await hosting.onSubscriptionSynced(sync);
          await options.planChanged(sync.serverId);
        },
      })
    : null;
  const hosting = new HostedServerService(bindings, {
    removeHost: options.removeHost,
    developerKey: options.developerKey,
    billing,
    analytics,
  });
  return { billing, hosting };
}
