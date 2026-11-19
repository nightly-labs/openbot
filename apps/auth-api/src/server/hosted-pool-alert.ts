import { Effect } from "effect";
import type { BoatFetch } from "./boat-client";

const SEND_TIMEOUT_MS = 10_000;
let warnedBadUrl = false;

export type HostedPoolAlert = (text: string) => Effect.Effect<void>;

export function createHostedPoolAlert(webhookUrl: string | undefined, fetch: BoatFetch): HostedPoolAlert | null {
  const value = webhookUrl?.trim();
  if (!value) return null;
  const url = URL.parse(value);
  if (url?.protocol !== "https:") {
    if (!warnedBadUrl) console.warn("HOSTED_POOL_ALERT_WEBHOOK_URL is not an HTTPS URL. Pool alerts are off.");
    warnedBadUrl = true;
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
