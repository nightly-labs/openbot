import type { ServerSummary } from "@openbot/contracts/ipc";
import { onSettled, untrack } from "solid-js";

const NEW_SERVER_RETRY_MS = 5_000;

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
