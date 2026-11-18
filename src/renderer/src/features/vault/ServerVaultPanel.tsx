import { type VaultAgentChoice, VaultPanel } from "@openbot/ui/features/vault/VaultPanel";
import { useText } from "@openbot/ui/text";
import { createEffect, createSignal, onSettled, Show } from "solid-js";
import { actionToast } from "../../action-toast";
import type { LinkAccountStore } from "./stores/link-account-store";
import type { VaultStore } from "./stores/vault-store";

export interface ServerVaultOptions {
  /** The Vault of this computer, or of a joined server for its owner or admin. */
  store: VaultStore;
  /** False for a joined server without `vault-v2`: it cannot keep API keys. */
  apiKeys: boolean;
  /** False for a joined server without `vault-v3`: it cannot keep two-step keys. */
  twoStep: boolean;
  /** The Link account of this computer. Absent for a joined server: its host has no Link. */
  link?: LinkAccountStore | undefined;
  /**
   * The agents of the same server, for the agents of each item. Absent or empty: each item shows no
   * agents choice, and keeps its saved agents.
   */
  listAgents?: (() => Promise<readonly VaultAgentChoice[]>) | undefined;
}

/**
 * The Vault section of the server settings. It lists the items each time it opens, and shows each
 * list that main sends while it is open.
 */
export function ServerVaultPanel(props: ServerVaultOptions & { menuMount: HTMLElement | undefined }) {
  const { t, errorMessage } = useText();
  const [agents, setAgents] = createSignal<readonly VaultAgentChoice[]>([]);
  let request = 0;
  createEffect(
    () => props.listAgents,
    (listAgents) => {
      const current = ++request;
      setAgents([]);
      // Without the agents, the items keep their saved agents, so a failed read only hides the choice.
      listAgents?.().then(
        (list) => {
          if (current === request) setAgents(list);
        },
        () => undefined,
      );
    },
  );
  onSettled(() => {
    const store = props.store;
    const unsubscribe = store.subscribe();
    store.refresh().catch((error: unknown) => actionToast.error(errorMessage(error, t("vault.loadFailed"))));
    const link = props.link;
    const stopLink = link?.subscribe();
    link?.refresh().catch((error: unknown) => actionToast.error(errorMessage(error, t("vault.link.failed"))));
    return () => {
      unsubscribe();
      stopLink?.();
    };
  });
  const linkAccount = () => {
    const link = props.link;
    if (!link) return undefined;
    return {
      status: link.state.status,
      onConnect: link.connect,
      onCancel: link.cancel,
      onDisconnect: link.disconnect,
    };
  };
  const onCodes = () => (props.twoStep ? props.store.codes : undefined);
  return (
    <Show when={props.store.state.vault}>
      {(vault) => (
        <VaultPanel
          state={vault()}
          apiKeys={props.apiKeys}
          agents={agents()}
          onCodes={onCodes()}
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
          link={linkAccount()}
        />
      )}
    </Show>
  );
}
