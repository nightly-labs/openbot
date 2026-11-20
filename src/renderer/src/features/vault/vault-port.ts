import type {
  VaultImportResult,
  VaultSaveInput,
  VaultSecretRequest,
  VaultState,
  VaultTwoStepCodes,
} from "@openbot/contracts/ipc";

export interface VaultCalls {
  list(): Promise<VaultState>;
  save(input: VaultSaveInput): Promise<VaultState>;
  remove(id: string): Promise<VaultState>;
  reveal(request: VaultSecretRequest): Promise<string>;
  copy(request: VaultSecretRequest): Promise<void>;
  importCsv?: (() => Promise<VaultImportResult>) | undefined;
  reset(): Promise<VaultState>;
  codes(): Promise<VaultTwoStepCodes>;
  onChanged(listener: (state: VaultState) => void): () => void;
}

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
    codes: () => vault().codes(),
    onChanged: (listener) => vault().onChanged(listener),
  };
}

export function remoteVaultCalls(
  calls: Omit<VaultCalls, "onChanged">,
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
    ...(calls.importCsv ? { importCsv: change(calls.importCsv) } : {}),
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

export function hostVaultCalls(serverId: string, importable: boolean): VaultCalls {
  const vault = () => window.openbot.vault;
  return remoteVaultCalls(
    {
      list: () => vault().hostList(serverId),
      save: (input) => vault().hostSave(input, serverId),
      remove: (id) => vault().hostDelete(id, serverId),
      reveal: (request) => vault().hostReveal(request, serverId),
      copy: (request) => vault().hostCopy(request, serverId),
      reset: () => vault().hostReset(serverId),
      codes: () => vault().hostCodes(serverId),
      ...(importable ? { importCsv: () => vault().hostImportCsv(serverId) } : {}),
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
