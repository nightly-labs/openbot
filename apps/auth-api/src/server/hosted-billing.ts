import { Effect } from "effect";
import { createAccountAnalytics } from "./account-analytics";
import { BillingOss } from "./billing-oss";
import { purchaseAlertText } from "./billing-purchase";
import { BillingSales } from "./billing-sales";
import { BillingService } from "./billing-service";
import { vatAlertText } from "./billing-tax";
import {
  createLicenseEmailDelivery,
  createWelcomeEmailDelivery,
  type EmailDeliveryBindings,
  type EmailDeliveryError,
} from "./email-delivery";
import type { LicenseEmailInput } from "./email-templates";
import { createHostedPoolAlert } from "./hosted-pool-alert";
import {
  type HostedServerBindings,
  HostedServerService,
  type HostedServerServiceOptions,
} from "./hosted-server-service";
import { parseLicenseTrialEnd } from "./license-service";
import type { RemoteFailure } from "./remote-control-plane";
import type { SmtpFailure } from "./smtp-email-delivery";
import type { WorkerBindings } from "./types";
import { ViesClient } from "./vies-client";

export type HostedBillingBindings = HostedServerBindings &
  EmailDeliveryBindings &
  Partial<
    Pick<
      WorkerBindings,
      | "STRIPE_SECRET_KEY"
      | "STRIPE_WEBHOOK_SECRET"
      | "VIES_REQUESTER_VAT_ID"
      | "LICENSE_TRIAL_END"
      | "BILLING_COUNTRY_REQUIRED"
      | "OPENPANEL_CLIENT_ID"
      | "OPENPANEL_CLIENT_SECRET"
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
    /** Tells the members of an account's servers that its license, and so their member limit, can be different. */
    licenseChanged: (userId: string) => Effect.Effect<void, RemoteFailure>;
    /** Keeps the Worker alive until an analytics send or a server start command ends (`waitUntil`). */
    schedule: (work: Effect.Effect<void>) => void;
    /** The network of Stripe, boat, OpenPanel and the operator webhook. A test gives its own. */
    fetch?: (input: string, init: RequestInit) => Promise<Response>;
  },
): { billing: BillingService | null; hosting: HostedServerService } {
  const send = options.fetch ?? ((input, init) => fetch(input, init));
  // The operator webhook of the pool alerts also gets each new subscription (docs/hosted-servers.md#pool-alerts).
  const operatorAlert = createHostedPoolAlert(bindings.HOSTED_POOL_ALERT_WEBHOOK_URL, send);
  const analytics = createAccountAnalytics({
    clientId: bindings.OPENPANEL_CLIENT_ID,
    clientSecret: bindings.OPENPANEL_CLIENT_SECRET,
    fetch: send,
    schedule: options.schedule,
    database: bindings.DB,
  });
  const secretKey = bindings.STRIPE_SECRET_KEY?.trim();
  const sales =
    bindings.OPENPANEL_CLIENT_ID?.trim() && bindings.OPENPANEL_CLIENT_SECRET?.trim()
      ? new BillingSales({
          database: bindings.DB,
          clientId: bindings.OPENPANEL_CLIENT_ID,
          clientSecret: bindings.OPENPANEL_CLIENT_SECRET,
          fetch: send,
        })
      : undefined;
  const billing = secretKey
    ? new BillingService({
        database: bindings.DB,
        secretKey,
        webhookSecret: bindings.STRIPE_WEBHOOK_SECRET?.trim() || null,
        licenseTrialEnd: parseLicenseTrialEnd(bindings.LICENSE_TRIAL_END),
        countryRequired: bindings.BILLING_COUNTRY_REQUIRED?.trim() === "true",
        fetch: send,
        analytics,
        ...(sales ? { sales } : {}),
        onFirstPlanStarted: (start) =>
          options.schedule(
            sendBillingEmail("welcome email", () => createWelcomeEmailDelivery(bindings, analytics), start),
          ),
        onLicenseEmail: (message) =>
          options.schedule(
            sendBillingEmail(
              `license email ${message.kind}`,
              () => createLicenseEmailDelivery(bindings, analytics),
              message,
            ),
          ),
        vies: new ViesClient(send, bindings.VIES_REQUESTER_VAT_ID?.trim() || null),
        oss: new BillingOss({
          database: bindings.DB,
          fetch: send,
          alert: (text) => {
            if (operatorAlert) options.schedule(operatorAlert(vatAlertText(text)));
          },
        }),
        ...(operatorAlert
          ? {
              onPurchase: (purchase) => options.schedule(operatorAlert(purchaseAlertText(purchase))),
              onVatMismatch: (text) => options.schedule(operatorAlert(vatAlertText(text))),
            }
          : {}),
        onSubscriptionSynced: (sync) =>
          hosting.onSubscriptionSynced(sync).pipe(Effect.andThen(() => options.planChanged(sync.serverId))),
        onLicenseChanged: options.licenseChanged,
      })
    : null;
  const hosting = new HostedServerService(bindings, {
    removeHost: options.removeHost,
    developerKey: options.developerKey ?? null,
    billing,
    analytics,
    schedule: options.schedule,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  return { billing, hosting };
}

/**
 * A deployment without SMTP sends no billing email. A failed send is not sent again. Each result logs
 * one line with no address.
 */
function sendBillingEmail<Message>(
  name: "welcome email" | `license email ${LicenseEmailInput["kind"]}`,
  createDelivery: () => { send(message: Message): Effect.Effect<void, EmailDeliveryError | SmtpFailure> } | null,
  message: Message,
): Effect.Effect<void> {
  return Effect.try({
    try: createDelivery,
    catch: () => ({ message: "smtp_config_incomplete" }),
  }).pipe(
    Effect.flatMap((delivery) =>
      delivery
        ? delivery.send(message).pipe(Effect.andThen(Effect.sync(() => console.log(`billing: ${name} sent`))))
        : Effect.sync(() => console.log(`billing: ${name} not sent: SMTP is not set`)),
    ),
    Effect.catch((error) => Effect.sync(() => console.warn(`billing: ${name} failed`, error.message))),
  );
}
