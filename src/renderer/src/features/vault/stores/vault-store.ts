import type { VaultSaveInput, VaultSecretRequest, VaultState } from "@openbot/contracts/ipc";
import { createStore } from "solid-js";
import type { VaultCalls } from "../vault-port";

/**
 * The Vault of one server, for the server settings. Each change answers with the new list, and the
 * list comes again when an agent or another window changes it.
 */
export function createVaultStore(calls: VaultCalls) {
  /** `vault` is undefined until the first list arrives. */
  const [state, setState] = createStore<{ vault: VaultState | undefined }>({ vault: undefined });
  let request = 0;

  const show = (vault: VaultState) => {
    // A list that a change or an event brings is newer than one that is still loading.
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
    /** Shows each list that main sends. Returns the function that stops it. */
    subscribe: () => calls.onChanged(show),
    save: async (input: VaultSaveInput) => show(await calls.save(input)),
    remove: async (id: string) => show(await calls.remove(id)),
    reveal: (request: VaultSecretRequest) => calls.reveal(request),
    copy: (request: VaultSecretRequest) => calls.copy(request),
    /** Absent for a joined server. */
    importCsv: calls.importCsv
      ? async () => {
          const result = await calls.importCsv?.();
          if (result) show(result.state);
          return result ?? null;
        }
      : undefined,
    reset: async () => show(await calls.reset()),
  };
}

export type VaultStore = ReturnType<typeof createVaultStore>;
