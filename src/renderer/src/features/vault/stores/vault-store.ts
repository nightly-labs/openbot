import type { VaultSaveInput, VaultSecretRequest, VaultState } from "@openbot/contracts/ipc";
import { createStore } from "solid-js";
import type { VaultCalls } from "../vault-port";

export function createVaultStore(calls: VaultCalls) {
  const [state, setState] = createStore<{ vault: VaultState | undefined }>({ vault: undefined });
  let request = 0;

  const show = (vault: VaultState) => {
    request++;
    setState((draft) => {
      draft.vault = vault;
    });
  };

  async function refresh(): Promise<void> {
    const current = ++request;
    const vault = await calls.list();
    if (current === request)
      setState((draft) => {
        draft.vault = vault;
      });
  }

  return {
    state,
    refresh,
    subscribe: () => calls.onChanged(show),
    save: async (input: VaultSaveInput) => show(await calls.save(input)),
    remove: async (id: string) => show(await calls.remove(id)),
    reveal: (request: VaultSecretRequest) => calls.reveal(request),
    copy: (request: VaultSecretRequest) => calls.copy(request),
    importCsv: calls.importCsv
      ? async () => {
          const result = await calls.importCsv?.();
          if (result) show(result.state);
          return result ?? null;
        }
      : undefined,
    reset: async () => show(await calls.reset()),
    codes: () => calls.codes(),
  };
}

export type VaultStore = ReturnType<typeof createVaultStore>;
