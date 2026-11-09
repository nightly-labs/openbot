import type { ServerSummary } from "@openbot/contracts/ipc";
import { onSettled, untrack } from "solid-js";

/** How often the app connects again to a new server that has a retryable issue. */
const NEW_SERVER_RETRY_MS = 5_000;

/**
 * Connects again to a new server while its issue is retryable. The first connection to a new server
 * often starts before its host reaches Signal, and the next automatic try is minutes away. It stops
 * with the component that calls it.
 */
export function retryNewServer(
  server: () => ServerSummary | undefined,
  retryConnection: (serverId: string) => Promise<unknown>,
): void {
  onSettled(() => {
    let retrying = false;
    const timer = window.setInterval(() => {
      const current = untrack(server);
      if (retrying || !current || current.state === "online" || current.issue?.retryable !== true) return;
      retrying = true;
      retryConnection(current.id)
        .catch(() => undefined)
        .finally(() => {
          retrying = false;
        });
    }, NEW_SERVER_RETRY_MS);
    return () => window.clearInterval(timer);
  });
}
