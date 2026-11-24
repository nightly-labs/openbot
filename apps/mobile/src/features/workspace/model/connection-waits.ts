interface ConnectionWait {
  resolve: () => void;
  reject: (error: Error) => void;
}

export class ConnectionUnavailableError extends Error {}

export class ConnectionWaits {
  readonly #resuming = new Set<string>();
  readonly #waits = new Map<string, Set<ConnectionWait>>();

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

  settle = (serverId: string, error: Error | null): void => {
    const waits = this.#waits.get(serverId);
    if (!waits) return;
    this.#waits.delete(serverId);
    for (const wait of waits) {
      if (error) wait.reject(error);
      else wait.resolve();
    }
  };

  drop(serverId: string, error: Error): void {
    this.#resuming.delete(serverId);
    this.settle(serverId, error);
  }

  dropAll(error: Error): void {
    for (const serverId of [...this.#waits.keys()]) this.settle(serverId, error);
    this.#resuming.clear();
  }
}
