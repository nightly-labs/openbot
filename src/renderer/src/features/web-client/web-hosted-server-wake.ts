import { createHostedServerStatusCheck, createHostedServerWake } from "@openbot/team-client/hosted-server-wake";
import { Effect } from "effect";

/**
 * The hosted servers of this browser's account. When a connection fails, `unavailable` asks whether the
 * server sleeps, and starts it when it does not. A sleeping server starts with `wakeForInput`.
 */
export function createWebHostedServerWake(accountFetch: typeof fetch, now: () => number = Date.now) {
  const accountRequest = (hostId: string, action: "status" | "wake") =>
    Effect.tryPromise((signal) =>
      accountFetch(
        new URL(`/api/browser/v2/hosting/servers/${encodeURIComponent(hostId)}/${action}`, window.location.origin),
        action === "wake"
          ? {
              signal,
              method: "POST",
              credentials: "same-origin",
              cache: "no-store",
              headers: { "Content-Type": "application/json", "X-OpenBot-Browser": "1" },
              body: "{}",
            }
          : {
              signal,
              method: "GET",
              credentials: "same-origin",
              cache: "no-store",
              headers: { "X-OpenBot-Browser": "1" },
            },
      ),
    );
  const wake = createHostedServerWake((hostId) => accountRequest(hostId, "wake"), now);
  return { wake, ...createHostedServerStatusCheck((hostId) => accountRequest(hostId, "status"), wake, now) };
}
