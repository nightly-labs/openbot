import { sourceText } from "@openbot/i18n/source";

/** The errors of a request that a lost connection stopped, such as when the user left the app. */
const CONNECTION_STOPS = new Set([
  sourceText("error.remote.appInBackground"),
  sourceText("error.remote.serverDisconnected"),
  sourceText("error.remote.selectedServerOffline"),
  sourceText("error.remote.connectionDropped"),
  sourceText("error.remote.attachmentConnectionChanged"),
]);

/** Whether a lost connection stopped the request, so that it can go again when the server is online. */
export function isConnectionStop(error: Error | null): boolean {
  return error !== null && CONNECTION_STOPS.has(error.message);
}

interface ConnectionWait {
  resolve: () => void;
  reject: (error: Error) => void;
}

/** The servers in the quiet time of a return to the app, and the requests that wait for each one. */
export class ConnectionWaits {
  readonly #resuming = new Set<string>();
  readonly #waits = new Map<string, Set<ConnectionWait>>();

  /** A request to a server in its quiet return waits for the connection, instead of failing at once. */
  whenConnected = (serverId: string): Promise<void> =>
    this.#resuming.has(serverId)
      ? new Promise<void>((resolve, reject) => {
          const waits = this.#waits.get(serverId) ?? new Set();
          waits.add({ resolve, reject });
          this.#waits.set(serverId, waits);
        })
      : Promise.resolve();

  setResuming(serverId: string, resuming: boolean): void {
    if (resuming) this.#resuming.add(serverId);
    else this.#resuming.delete(serverId);
  }

  /** Sends the waiting requests of a server, or fails them with `error`. */
  settle = (serverId: string, error: Error | null): void => {
    const waits = this.#waits.get(serverId);
    if (!waits) return;
    this.#waits.delete(serverId);
    for (const wait of waits) {
      if (error) wait.reject(error);
      else wait.resolve();
    }
  };

  /** Fails the waiting requests of a server that the list no longer has. */
  drop(serverId: string, error: Error): void {
    this.#resuming.delete(serverId);
    this.settle(serverId, error);
  }

  /** Fails every waiting request. The next return to the app starts a new quiet time. */
  dropAll(error: Error): void {
    for (const serverId of [...this.#waits.keys()]) this.settle(serverId, error);
    this.#resuming.clear();
  }
}
