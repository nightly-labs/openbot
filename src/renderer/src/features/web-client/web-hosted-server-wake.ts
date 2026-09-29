import { createHostedServerWake } from "@openbot/team-client/hosted-server-wake";

/** Starts a stopped hosted server of this browser's account when a connection to it fails. */
export function createWebHostedServerWake(accountFetch: typeof fetch, now: () => number = Date.now) {
  return createHostedServerWake(
    (hostId) =>
      accountFetch(
        new URL(`/api/browser/v2/hosting/servers/${encodeURIComponent(hostId)}/wake`, window.location.origin),
        {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          headers: { "Content-Type": "application/json", "X-OpenBot-Browser": "1" },
          body: "{}",
        },
      ),
    now,
  );
}
