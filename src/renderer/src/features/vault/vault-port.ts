import type { VaultImportResult, VaultSaveInput, VaultSecretRequest, VaultState } from "@openbot/contracts/ipc";

/**
 * The Vault of one server. Desktop reaches this computer's Vault and a joined server's through main;
 * the web client asks the host directly (`vault-v1`). Only an owner or admin of a joined server has it.
 */
export interface VaultCalls {
  list(): Promise<VaultState>;
  save(input: VaultSaveInput): Promise<VaultState>;
  remove(id: string): Promise<VaultState>;
  reveal(request: VaultSecretRequest): Promise<string>;
  copy(request: VaultSecretRequest): Promise<void>;
  /** Absent for a joined server: the CSV file is on this computer, not on the host. */
  importCsv?: (() => Promise<VaultImportResult>) | undefined;
  reset(): Promise<VaultState>;
  /** Returns the function that stops the subscription. */
  onChanged(listener: (state: VaultState) => void): () => void;
}

/** The desktop calls. Reads `window.openbot` on each call: stories replace it per case. */
export function desktopVaultCalls(): VaultCalls {
  const vault = () => window.openbot.vault;
  return {
    list: () => vault().list(),
    save: (input) => vault().save(input),
    remove: (id) => vault().delete(id),
    reveal: (request) => vault().reveal(request),
    copy: (request) => vault().copy(request),
    importCsv: () => vault().importCsv(),
    reset: () => vault().reset(),
    onChanged: (listener) => vault().onChanged(listener),
  };
}

/**
 * The calls of a joined server's Vault. Its host sends `vault-changed` with no items, so `changes`
 * gives a signal and the list is read again. A list that a newer read or a change overtook is dropped,
 * so it cannot show an item again that the user just deleted.
 */
export function remoteVaultCalls(
  calls: Omit<VaultCalls, "onChanged" | "importCsv">,
  changes: (read: () => void) => () => void,
): VaultCalls {
  let generation = 0;
  const change =
    <A extends unknown[], R>(call: (...args: A) => Promise<R>) =>
    (...args: A) => {
      generation++;
      return call(...args);
    };
  return {
    ...calls,
    save: change(calls.save),
    remove: change(calls.remove),
    reset: change(calls.reset),
    onChanged: (listener) =>
      changes(() => {
        const current = ++generation;
        calls.list().then(
          (state) => {
            if (current === generation) listener(state);
          },
          () => {},
        );
      }),
  };
}

/**
 * The desktop calls for a joined server. Main copies a secret, so it does not pass through this
 * window. A change on the host, or a connection that comes back, reads the list again.
 */
export function hostVaultCalls(serverId: string): VaultCalls {
  const vault = () => window.openbot.vault;
  return remoteVaultCalls(
    {
      list: () => vault().hostList(serverId),
      save: (input) => vault().hostSave(input, serverId),
      remove: (id) => vault().hostDelete(id, serverId),
      reveal: (request) => vault().hostReveal(request, serverId),
      copy: (request) => vault().hostCopy(request, serverId),
      reset: () => vault().hostReset(serverId),
    },
    (read) => {
      const unsubscribe = window.openbot.agent.onScopedEvent((scoped) => {
        if (scoped.serverId === serverId && scoped.event.type === "vault-changed") read();
      });
      let online = true;
      const reconnect = window.openbot.servers.onEvent((servers) => {
        const now = servers.some((server) => server.id === serverId && server.state === "online");
        if (now && !online) read();
        online = now;
      });
      return () => {
        unsubscribe();
        reconnect();
      };
    },
  );
}
