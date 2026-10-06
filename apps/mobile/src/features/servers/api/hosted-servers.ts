import {
  type CreateHostedServerInput,
  type HostedServerCatalog,
  type HostedServerCheckout,
  type HostedServerList,
  type HostedServerSummary,
  parseHostedServerCatalog,
  parseHostedServerCheckout,
  parseHostedServerList,
  parseHostedServerSummary,
} from "@openbot/contracts/hosted-servers";
import { type MobileSession, requestMobileAccount } from "@/features/auth/api/mobile-auth";
import { currentText } from "@/shared/lib/text";

/** A create or a new payment page can wait for Stripe, as on desktop. */
const CHECKOUT_TIMEOUT_MS = 30_000;

export interface HostedServerCalls {
  list(): Promise<HostedServerList>;
  plans(): Promise<HostedServerCatalog>;
  /** The same `requestId` returns the same server, with a new payment page when it still waits for payment. */
  create(input: CreateHostedServerInput): Promise<HostedServerCheckout>;
  /** A new payment page for a server that waits for its first payment. */
  checkout(serverId: string): Promise<HostedServerCheckout>;
  wake(serverId: string): Promise<HostedServerSummary>;
}

/**
 * The account server's hosted servers, with the phone's session. The contract parser accepts only an
 * https Stripe Checkout page as the payment URL, so the app opens no other page.
 */
export function hostedServerCalls(session: MobileSession): HostedServerCalls {
  const { t } = currentText();
  const serverPath = (serverId: string, action: string) =>
    `/v2/hosting/servers/${encodeURIComponent(serverId)}/${action}`;
  return {
    list: () =>
      requestMobileAccount(
        session,
        "/v2/hosting/servers/",
        {},
        parseHostedServerList,
        t("mobile.server.hosted.loadFailed"),
      ),
    plans: () =>
      requestMobileAccount(
        session,
        "/v2/hosting/plans",
        {},
        parseHostedServerCatalog,
        t("mobile.server.hosted.loadFailed"),
      ),
    create: ({ requestId, ...input }) =>
      requestMobileAccount(
        session,
        "/v2/hosting/servers/",
        { method: "POST", body: JSON.stringify(input), headers: { "Idempotency-Key": requestId } },
        parseHostedServerCheckout,
        t("mobile.server.hosted.createFailed"),
        CHECKOUT_TIMEOUT_MS,
      ),
    checkout: (serverId) =>
      requestMobileAccount(
        session,
        serverPath(serverId, "checkout"),
        { method: "POST" },
        parseHostedServerCheckout,
        t("mobile.server.hosted.paymentFailed"),
        CHECKOUT_TIMEOUT_MS,
      ),
    wake: (serverId) =>
      requestMobileAccount(
        session,
        serverPath(serverId, "wake"),
        { method: "POST" },
        parseHostedServerSummary,
        t("mobile.server.hosted.wakeFailed"),
      ),
  };
}
