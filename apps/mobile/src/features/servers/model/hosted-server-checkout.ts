import type { HostedServerSummary } from "@openbot/contracts/hosted-servers";
import * as Crypto from "expo-crypto";
import * as WebBrowser from "expo-web-browser";
import { create } from "zustand";
import type { HostedServerCalls } from "@/features/servers/api/hosted-servers";
import { isIOS } from "@/shared/lib/platform";
import { HostedRequestKeys } from "./hosted-server-plans";

/** The drawer reads the answer again at most this often. */
const AVAILABILITY_TTL_MS = 60_000;

/**
 * Whether the signed-in account can create hosted servers. The plus button in the drawer then
 * opens the plans, as on desktop; otherwise it opens Join. A failed read keeps the last answer.
 */
export const useHostedServerAvailability = create<{ userId: string | null; available: boolean; checkedAt: number }>(
  () => ({ userId: null, available: false, checkedAt: 0 }),
);

export async function refreshHostedServerAvailability(userId: string, calls: HostedServerCalls): Promise<void> {
  const current = useHostedServerAvailability.getState();
  if (current.userId === userId && Date.now() - current.checkedAt < AVAILABILITY_TTL_MS) return;
  // Another account starts with no plans, and a failed read does not show the last account's answer.
  if (current.userId !== userId) useHostedServerAvailability.setState({ userId, available: false, checkedAt: 0 });
  try {
    const list = await calls.list();
    if (useHostedServerAvailability.getState().userId !== userId) return;
    useHostedServerAvailability.setState({ available: list.available, checkedAt: Date.now() });
  } catch {
    // The next opening of the drawer tries again.
  }
}

/** The keys live as long as the app, so a choice made again after the sheet closed opens the same server. */
export const hostedRequestKeys = new HostedRequestKeys(() => Crypto.randomUUID());

/** The last summary of each new server, so the setup screen shows its name before the first poll. */
const knownServers = new Map<string, HostedServerSummary>();

export function rememberHostedServer(server: HostedServerSummary): void {
  knownServers.set(server.serverId, server);
}

export function knownHostedServer(serverId: string): HostedServerSummary | null {
  return knownServers.get(serverId) ?? null;
}

let checkoutOpen = false;

/**
 * Opens the Stripe Checkout page in the in-app browser. The page stays in the app, so the user
 * comes back to the setup when they close it. Resolves when the browser closes.
 */
export async function openHostedCheckout(url: string, controlsColor: string): Promise<void> {
  checkoutOpen = true;
  try {
    await WebBrowser.openBrowserAsync(url, {
      controlsColor,
      dismissButtonStyle: "close",
      // Android: the page is a part of this task, so Back returns to the setup.
      createTask: false,
    });
  } finally {
    checkoutOpen = false;
  }
}

/**
 * Closes the payment page when Stripe confirmed the payment, so the user does not have to. Only iOS
 * can close it; on Android the user goes back.
 */
export function closeHostedCheckout(): void {
  if (!checkoutOpen || !isIOS) return;
  void WebBrowser.dismissBrowser().catch(() => undefined);
}
