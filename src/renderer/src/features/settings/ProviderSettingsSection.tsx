import type {
  AgentProviderId,
  AgentStatus,
  CustomProviderRestart,
  CustomProviderSummary,
  ProviderApiKeyStatus,
  ProviderRuntimeStatus,
  SaveCustomProviderInput,
} from "@openbot/contracts/ipc";
import { agentProviderDescriptor } from "@openbot/contracts/ipc";
import { SettingsSection, Text } from "@openbot/ui";
import { ProviderCodeLoginDialog } from "@openbot/ui/components/ProviderCodeLoginDialog";
import { CustomProviderDialog } from "@openbot/ui/features/custom-providers/CustomProviderDialog";
import { CustomProviderListDialog } from "@openbot/ui/features/custom-providers/CustomProviderListDialog";
import { OpenCodeKeyDialog, type ProviderKeyApi } from "@openbot/ui/features/settings/OpenCodeKeyDialog";
import { createEffect, createSignal, Show } from "solid-js";
import { ProviderPicker } from "../../components/ProviderPicker";
import type { ProviderCodeLoginApi } from "../../components/provider-code-login-api";
import { useI18n } from "../../i18n-context";
import { createCustomProviderHostState } from "../custom-providers/custom-provider-host-state";
import { createSettingsGeneralStore, type SettingsGeneralStore } from "./stores/general-store";

export interface ProviderSettingsSectionProps {
  store: SettingsGeneralStore;
  /** The dialog element the Select popovers portal into, captured when the section was created. */
  selectMount: HTMLElement | undefined;
  onDownloadProvider?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  onCancelProviderDownload?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  onUpdateProvider?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  onInstallProvider?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  onConnectProvider?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  /**
   * Accepts a described endpoint. Without it the section offers no custom provider at all, which is
   * how a remote server hides the whole feature: these endpoints merge into the OpenCode process on
   * this computer.
   */
  onAddCustomProvider?: ((value: SaveCustomProviderInput) => Promise<CustomProviderRestart>) | undefined;
  /** The endpoints already saved, without their keys. Empty until the first list arrives. */
  customProviders?: readonly CustomProviderSummary[] | undefined;
  /** Without it the rows are listed but not removable, which is what a story without the callback shows. */
  onDeleteCustomProvider?: ((id: string) => Promise<CustomProviderRestart>) | undefined;
  onSignInProvider?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  /** Opens the code sign-in. Absent in the stories, where there is no provider to answer it. */
  onSignInWithCodeProvider?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
}

/** The provider list of the computer the agents run on, with its custom endpoint dialogs. */
export function ProviderSettingsSection(props: ProviderSettingsSectionProps) {
  const i18n = useI18n();
  const customProviders = () => props.customProviders ?? [];
  /**
   * Which row holds the check here. Nothing stores it: the whole Settings picker is local state
   * today, so this row matches its neighbours and no more. Do not wire it to a saved default without
   * first deciding what a saved default means for the four rows beside it.
   */
  const [customSelected, setCustomSelected] = createSignal(false);
  const host = createCustomProviderHostState({
    onAdd: (value) => props.onAddCustomProvider?.(value),
    onDelete: (id) => props.onDeleteCustomProvider?.(id),
    onRemoved: () => {
      if (customProviders().length === 0) {
        setCustomSelected(false);
      }
    },
  });

  return (
    <SettingsSection title={i18n.t("settings.providers.title")}>
      <ProviderPicker
        value={props.store.selectedProvider()}
        options={props.store.providerOptions()}
        ariaLabel={i18n.t("settings.providers.title")}
        embedded
        allowUnavailableSelection
        customProviders={customProviders()}
        customSelected={customSelected()}
        onChange={(provider) => {
          setCustomSelected(false);
          props.store.setSelectedProvider(provider);
        }}
        onDownloadProvider={props.onDownloadProvider}
        onCancelProviderDownload={props.onCancelProviderDownload}
        onUpdateProvider={props.onUpdateProvider}
        onConnectProvider={props.onConnectProvider}
        onInstallProvider={props.onInstallProvider}
        onAddCustomProvider={props.onAddCustomProvider ? host.openForm : undefined}
        onSelectCustomProvider={props.onAddCustomProvider ? () => setCustomSelected(true) : undefined}
        onManageCustomProviders={props.onAddCustomProvider ? host.openList : undefined}
        onSignInProvider={props.onSignInProvider}
        onSignInWithCodeProvider={props.onSignInWithCodeProvider}
        menuMount={props.selectMount}
      />
      {/* The outcome is shown where the user is looking. While the list is open the section behind
          it is hidden from assistive technology, so a status left here could not be read. */}
      <Show when={host.state.manageOpen ? null : host.state.note}>
        {(message) => (
          <Text tone="muted" variant="caption" role="status">
            {message()}
          </Text>
        )}
      </Show>
      <Show when={props.onAddCustomProvider}>
        <CustomProviderDialog
          open={host.state.open}
          busy={host.state.saving}
          submitError={host.state.submitError}
          takenProviderIds={customProviders().map((provider) => provider.id)}
          onSubmit={(value) => void host.submit(value)}
          onCancel={host.closeForm}
        />
        <CustomProviderListDialog
          open={host.state.manageOpen}
          providers={customProviders()}
          removing={host.state.removing}
          note={host.state.note}
          onDelete={props.onDeleteCustomProvider ? (provider) => void host.remove(provider) : undefined}
          onClose={host.closeList}
        />
      </Show>
    </SettingsSection>
  );
}

/**
 * Whether the OpenCode key dialog is open, and whether the key is saved, for the row's badge.
 *
 * The badge is read through the key API like the dialog does, on open and after the dialog closes
 * with a save or a removal. Absent until the first read, and on a read failure, so the row shows no
 * key badge rather than a wrong one.
 */
export function createProviderKeyState(props: {
  readonly open: boolean;
  readonly providerKeys?: ProviderKeyApi | undefined;
}) {
  const [keyDialogOpen, setKeyDialogOpen] = createSignal(false);
  const [openCodeKeyStatus, setOpenCodeKeyStatus] = createSignal<ProviderApiKeyStatus | undefined>(undefined);
  async function refreshOpenCodeKeyStatus(): Promise<void> {
    const keys = props.providerKeys;
    if (!keys) return;
    let status: ProviderApiKeyStatus | undefined;
    try {
      status = (await keys.getProviderApiKeyState("opencode")).status;
    } catch {
      status = undefined;
    }
    // An answer from a source the modal has since left belongs to the other computer.
    if (keys === props.providerKeys) setOpenCodeKeyStatus(status);
  }
  // The badge has to answer on first paint: the key state arrives after the rows, so an open
  // without a read would show no badge until something else re-renders the list. The keys can move
  // to a joined server's host while the modal is open, when that host's admin role arrives, so a
  // new source is read again rather than keeping the other computer's answer.
  createEffect(
    () => (props.open ? props.providerKeys : undefined),
    (keys) => {
      setOpenCodeKeyStatus(undefined);
      if (keys) void refreshOpenCodeKeyStatus();
    },
  );
  return {
    keyDialogOpen,
    openCodeKeyStatus,
    /** OpenCode is the only provider whose sign-in is a pasted key, so it is the only row served. */
    openKeyDialog(provider: AgentProviderId): void {
      if (provider === "opencode") setKeyDialogOpen(true);
    },
    closeKeyDialog(): void {
      setKeyDialogOpen(false);
      void refreshOpenCodeKeyStatus();
    },
  };
}

export type ProviderKeyState = ReturnType<typeof createProviderKeyState>;

/** The key and code sign-in dialogs the section opens. Both portal over the dialog they open from. */
export function ProviderSettingsDialogs(props: {
  keys: ProviderKeyState;
  providerKeys?: ProviderKeyApi | undefined;
  codeLogin?: ProviderCodeLoginApi | undefined;
  onConnectProvider?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
}) {
  return (
    <>
      <Show when={props.keys.keyDialogOpen() && props.providerKeys}>
        {(api) => (
          <OpenCodeKeyDialog
            api={api()}
            onClose={props.keys.closeKeyDialog}
            onReconnect={props.onConnectProvider ? () => props.onConnectProvider?.("opencode") : undefined}
          />
        )}
      </Show>
      <Show when={props.codeLogin?.provider() ? props.codeLogin : undefined}>
        {(api) => (
          <ProviderCodeLoginDialog
            open={true}
            providerName={agentProviderDescriptor(api().provider() ?? "codex").displayName}
            state={api().state()}
            onOpenVerificationUrl={api().openVerificationUrl}
            onCancel={api().cancel}
          />
        )}
      </Show>
    </>
  );
}

/** The providers of a joined server's host, as a server settings section takes them. */
export interface HostProviderSettings {
  agentStatus: AgentStatus;
  providerRuntimeStatuses?: Partial<Record<AgentProviderId, ProviderRuntimeStatus>> | undefined;
  providerAvailableVersions?: Partial<Record<AgentProviderId, string | null>> | undefined;
  onDownloadProvider?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  onCancelProviderDownload?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  onUpdateProvider?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  customProviders?: readonly CustomProviderSummary[] | undefined;
  onAddCustomProvider?: ((value: SaveCustomProviderInput) => Promise<CustomProviderRestart>) | undefined;
  onDeleteCustomProvider?: ((id: string) => Promise<CustomProviderRestart>) | undefined;
  providerKeys?: ProviderKeyApi | undefined;
  codeLogin?: ProviderCodeLoginApi | undefined;
}

/** The whole Providers section for a host: its list, and the dialogs it opens. */
export function HostProviderSettingsPanel(
  props: HostProviderSettings & { hostName: string; selectMount: HTMLElement | undefined },
) {
  const keys = createProviderKeyState({
    open: true,
    get providerKeys() {
      return props.providerKeys;
    },
  });
  const store = createSettingsGeneralStore({
    get agentStatus() {
      return props.agentStatus;
    },
    get providerRuntimeStatuses() {
      return props.providerRuntimeStatuses;
    },
    get providerAvailableVersions() {
      return props.providerAvailableVersions;
    },
    openCodeKeyStatus: keys.openCodeKeyStatus,
    get providerHostName() {
      return props.hostName;
    },
  });
  return (
    <>
      <ProviderSettingsSection
        store={store}
        selectMount={props.selectMount}
        onDownloadProvider={props.onDownloadProvider}
        onCancelProviderDownload={props.onCancelProviderDownload}
        onUpdateProvider={props.onUpdateProvider}
        onAddCustomProvider={props.onAddCustomProvider}
        customProviders={props.customProviders}
        onDeleteCustomProvider={props.onDeleteCustomProvider}
        onSignInProvider={props.providerKeys ? keys.openKeyDialog : undefined}
        onSignInWithCodeProvider={props.codeLogin?.start}
      />
      <ProviderSettingsDialogs keys={keys} providerKeys={props.providerKeys} codeLogin={props.codeLogin} />
    </>
  );
}
