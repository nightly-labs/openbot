import { VaultPanel } from "@openbot/ui/features/vault/VaultPanel";
import { useText } from "@openbot/ui/text";
import { onSettled, Show } from "solid-js";
import { actionToast } from "../../action-toast";
import type { VaultStore } from "./stores/vault-store";

export interface ServerVaultOptions {
  /** The Vault of this computer, or of a joined server for its owner or admin. */
  store: VaultStore;
  /** False for a joined server without `vault-v2`: it cannot keep API keys. */
  apiKeys: boolean;
}

/**
 * The Vault section of the server settings. It lists the items each time it opens, and shows each
 * list that main sends while it is open.
 */
export function ServerVaultPanel(props: ServerVaultOptions & { menuMount: HTMLElement | undefined }) {
  const { t, errorMessage } = useText();
  onSettled(() => {
    const store = props.store;
    const unsubscribe = store.subscribe();
    store.refresh().catch((error: unknown) => actionToast.error(errorMessage(error, t("vault.loadFailed"))));
    return unsubscribe;
  });
  return (
    <Show when={props.store.state.vault}>
      {(vault) => (
        <VaultPanel
          state={vault()}
          apiKeys={props.apiKeys}
          onSave={props.store.save}
          onDelete={props.store.remove}
          onReveal={props.store.reveal}
          onCopy={async (request) => {
            await props.store.copy(request);
            actionToast.success(t("vault.copied"));
          }}
          onCopyText={async (value) => {
            await navigator.clipboard.writeText(value);
            actionToast.success(t("vault.copied"));
          }}
          onImportCsv={props.store.importCsv}
          onReset={props.store.reset}
          menuMount={props.menuMount}
        />
      )}
    </Show>
  );
}
