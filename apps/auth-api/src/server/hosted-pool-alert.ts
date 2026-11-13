import { Effect } from "effect";
import type { BoatFetch } from "./boat-client";

const SEND_TIMEOUT_MS = 10_000;

/** Sends one operator message about the server pool. The caller keeps it free of accounts and emails. */
export type HostedPoolAlert = (text: string) => Effect.Effect<void>;

/**
 * A Discord webhook (`HOSTED_POOL_ALERT_WEBHOOK_URL`) that tells the operator when a purchase starts on
 * boat or a pool group is almost empty (docs/hosted-servers.md#pool-alerts). Without the URL, or with a
 * URL that is not HTTPS, there is no alert. A failed send logs one line with no URL and is not sent again.
 */
export function createHostedPoolAlert(webhookUrl: string | undefined, fetch: BoatFetch): HostedPoolAlert | null {
  const value = webhookUrl?.trim();
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    console.warn("HOSTED_POOL_ALERT_WEBHOOK_URL is not a URL. Pool alerts are off.");
    return null;
  }
  if (url.protocol !== "https:") {
    console.warn("HOSTED_POOL_ALERT_WEBHOOK_URL must use HTTPS. Pool alerts are off.");
    return null;
  }
  const target = url.href;
  return (text) =>
    Effect.tryPromise({
      try: (signal) =>
        fetch(target, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: text, allowed_mentions: { parse: [] } }),
          signal: AbortSignal.any([signal, AbortSignal.timeout(SEND_TIMEOUT_MS)]),
        }),
      catch: () => "network",
    }).pipe(
      Effect.flatMap((response) => (response.ok ? Effect.void : Effect.fail(`http_${response.status}`))),
      Effect.catch((error) => Effect.sync(() => console.warn("Hosted pool alert failed.", { error }))),
    );
}
