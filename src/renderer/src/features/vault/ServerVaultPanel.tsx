import type { SettingsCrumb } from "@openbot/ui/features/settings/SettingsDialogShell";
import type { NearWalletAgent } from "@openbot/ui/features/vault/VaultNearWallet";
import { type VaultAgentChoice, VaultPanel } from "@openbot/ui/features/vault/VaultPanel";
import { useText } from "@openbot/ui/text";
import { createEffect, createSignal, onSettled, Show } from "solid-js";
import { actionToast } from "../../action-toast";
import type { LinkAccountStore } from "./stores/link-account-store";
import type { NearWalletStore } from "./stores/near-wallet-store";
import type { VaultStore } from "./stores/vault-store";

type VaultAgent = VaultAgentChoice & NearWalletAgent;

export interface ServerVaultOptions {
  store: VaultStore;
  apiKeys: boolean;
  twoStep: boolean;
  link?: LinkAccountStore | undefined;
  near?: NearWalletStore | undefined;
  nearAgents?: (() => readonly NearWalletAgent[] | undefined) | undefined;
  listAgents?: (() => Promise<readonly VaultAgent[]>) | undefined;
}

export function ServerVaultPanel(
  props: ServerVaultOptions & {
    menuMount: HTMLElement | undefined;
    onDetailChange?: ((detail: SettingsCrumb | null) => void) | undefined;
  },
) {
  const { t, errorMessage } = useText();
  const [agents, setAgents] = createSignal<readonly VaultAgent[]>([]);
  let request = 0;
  createEffect(
    () => props.listAgents,
    (listAgents) => {
      const current = ++request;
      setAgents([]);
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
    const near = props.near;
    const stopNear = near?.subscribe();
    near?.refresh().catch((error: unknown) => actionToast.error(errorMessage(error, t("vault.near.failed"))));
    return () => {
      unsubscribe();
      stopLink?.();
      stopNear?.();
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
  const nearWallet = () => {
    const near = props.near;
    if (!near) return undefined;
    return { status: near.state.status, agents: props.nearAgents?.() ?? agents(), actions: near.actions };
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
          near={nearWallet()}
          onDetailChange={props.onDetailChange}
        />
      )}
    </Show>
  );
}
