import type {
  AccountSession,
  AgentProviderId,
  AgentStatus,
  AppInfo,
  AvatarImageInput,
  CentralAuthUser,
  CustomProviderRestart,
  CustomProviderSummary,
  HostedSitesDesktopApi,
  MobileConnectedDevice,
  MobileConnectTicket,
  ProviderRuntimeStatus,
  SaveCustomProviderInput,
  UpdateStatus,
} from "@openbot/contracts/ipc";
import { createMemo, createSignal, For, Show } from "solid-js";
import {
  Button,
  CircleArrowDown,
  Globe2,
  MousePointer2,
  Settings,
  Smartphone,
  Tabs,
  Text,
  UserRound,
} from "../../components/ui";
import { ComputerUseMacSetup } from "../computer-use/ComputerUseMacSetup";
import { useI18n } from "../i18n/i18n-context";
import type { GeneralSettingsValue } from "./app-settings";
import { OpenCodeKeyDialog, type ProviderKeyApi } from "./OpenCodeKeyDialog";
import { SettingsDialogShell } from "./SettingsDialogShell";
import { SettingsGeneralTab } from "./SettingsGeneralTab";
import { SettingsHostedSitesTab } from "./SettingsHostedSitesTab";
import { SettingsMobileConnectTab } from "./SettingsMobileConnectTab";
import { SettingsProfileTab } from "./SettingsProfileTab";
import { SettingsUpdatesTab } from "./SettingsUpdatesTab";
import { createSettingsGeneralStore } from "./stores/general-store";
import { createSettingsHostedSitesStore } from "./stores/hosted-sites-store";
import { createSettingsMobileConnectStore } from "./stores/mobile-connect-store";
import { createSettingsProfileStore } from "./stores/profile-store";
import { createSettingsUpdatesStore } from "./stores/updates-store";

export interface SettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: GeneralSettingsValue;
  onValueChange: (value: GeneralSettingsValue) => void;
  appInfo: AppInfo | null;
  updateStatus: UpdateStatus;
  onUpdateAction: () => Promise<void>;
  account: CentralAuthUser;
  onUpdateAccountName: (name: string) => Promise<void>;
  onUpdateAccountAvatar: (image: AvatarImageInput | null) => Promise<void>;
  onCreateMobileConnect?: () => Promise<MobileConnectTicket>;
  onListMobileConnectedDevices?: () => Promise<MobileConnectedDevice[]>;
  onRevokeMobileConnectedDevice?: (sessionId: string) => Promise<void>;
  onListAccountSessions?: () => Promise<AccountSession[]>;
  onRevokeAccountSession?: (sessionId: string) => Promise<void>;
  processAvatarFile?: (file: File) => Promise<AvatarImageInput>;
  agentStatus?: AgentStatus;
  providerRuntimeStatuses?: Partial<Record<AgentProviderId, ProviderRuntimeStatus>>;
  providerAvailableVersions?: Partial<Record<AgentProviderId, string | null>>;
  onDownloadProvider?: (provider: AgentProviderId) => void | Promise<void>;
  onCancelProviderDownload?: (provider: AgentProviderId) => void | Promise<void>;
  onUpdateProvider?: (provider: AgentProviderId) => void | Promise<void>;
  onInstallProvider?: (provider: AgentProviderId) => void | Promise<void>;
  onConnectProvider?: (provider: AgentProviderId) => void | Promise<void>;
  /** Accepts a described endpoint from the General tab. Omitted on a remote server, which hides it. */
  onAddCustomProvider?: (value: SaveCustomProviderInput) => Promise<CustomProviderRestart>;
  customProviders?: readonly CustomProviderSummary[];
  onDeleteCustomProvider?: (id: string) => Promise<CustomProviderRestart>;
  /**
   * Reads and writes the optional provider keys. Absent while the active server is not this
   * computer, which is also what takes the row's sign-in button away.
   */
  providerKeys?: ProviderKeyApi;
  hostedSitesApi?: HostedSitesDesktopApi;
  restoreFocusTarget?: HTMLElement | null;
}

type SettingsTab = "general" | "computer-use" | "profile" | "mobile-connect" | "updates" | "hosted-sites";

type SettingsNavItem = { value: SettingsTab; label: string; icon: typeof Settings };

/**
 * The dialog shell: the tab list, the header, the footer save bar, and one delegation per panel.
 *
 * Every panel's state is a store created here rather than inside its tab, because Kobalte unmounts
 * an unselected `Tabs.Content` when the dialog closes. A list owned by the tab would lose the rows
 * it is showing while it refetches on reopen, and the footer below could not read the profile
 * draft while another tab is selected.
 */
export function SettingsModal(props: SettingsModalProps) {
  const i18n = useI18n();

  const navItems = createMemo<ReadonlyArray<SettingsNavItem>>(() => [
    { value: "general", label: i18n.t("settings.tabs.general"), icon: Settings },
    { value: "computer-use", label: i18n.t("settings.tabs.computerUse"), icon: MousePointer2 },
    { value: "profile", label: i18n.t("settings.tabs.profile"), icon: UserRound },
    { value: "mobile-connect", label: i18n.t("settings.tabs.mobileConnect"), icon: Smartphone },
    { value: "updates", label: i18n.t("settings.tabs.updates"), icon: CircleArrowDown },
    { value: "hosted-sites", label: i18n.t("settings.tabs.hostedSites"), icon: Globe2 },
  ]);

  const [activeTab, setActiveTab] = createSignal<SettingsTab>("general");
  const [openCodeKeyOpen, setOpenCodeKeyOpen] = createSignal(false);
  let modalElement: HTMLElement | undefined;

  const general = createSettingsGeneralStore(props);
  const profile = createSettingsProfileStore(props, () => activeTab() === "profile");
  const mobileConnect = createSettingsMobileConnectStore(props, () => activeTab() === "mobile-connect");
  const updates = createSettingsUpdatesStore(props);
  const hostedSites = createSettingsHostedSitesStore(props, () => activeTab() === "hosted-sites");

  const title = () => {
    switch (activeTab()) {
      case "general":
        return i18n.t("settings.tabs.general");
      case "computer-use":
        return i18n.t("settings.tabs.computerUse");
      case "profile":
        return i18n.t("settings.tabs.profile");
      case "mobile-connect":
        return i18n.t("settings.tabs.mobileConnect");
      case "updates":
        return i18n.t("settings.tabs.updates");
      case "hosted-sites":
        return i18n.t("settings.tabs.hostedSites");
    }
  };

  const description = () => {
    switch (activeTab()) {
      case "general":
        return i18n.t("settings.tabs.generalDescription");
      case "computer-use":
        return i18n.t("settings.tabs.computerUseDescription");
      case "profile":
        return i18n.t("settings.tabs.profileDescription");
      case "mobile-connect":
        return i18n.t("settings.tabs.mobileConnectDescription");
      case "updates":
        return i18n.t("settings.tabs.updatesDescription");
      case "hosted-sites":
        return i18n.t("settings.tabs.hostedSitesDescription");
    }
  };

  const tabsProps = {
    get value() {
      return activeTab();
    },
    onChange(value: string) {
      if (
        value === "general" ||
        value === "computer-use" ||
        value === "profile" ||
        value === "mobile-connect" ||
        value === "updates" ||
        value === "hosted-sites"
      ) {
        setActiveTab(value);
      }
    },
    orientation: "vertical" as const,
    activationMode: "automatic" as const,
  };

  /** OpenCode is the only provider whose sign-in is a pasted key, so it is the only row served. */
  function openProviderKeyDialog(provider: AgentProviderId): void {
    if (provider === "opencode") setOpenCodeKeyOpen(true);
  }

  function updateSetting<Key extends keyof GeneralSettingsValue>(key: Key, value: GeneralSettingsValue[Key]): void {
    props.onValueChange({ ...props.value, [key]: value });
  }

  // Filtrowanie nawigacji dla macOS
  const filteredNavItems = createMemo(() =>
    navItems().filter((item) => item.value !== "computer-use" || props.appInfo?.platform === "darwin"),
  );

  return (
    <Tabs.Root {...tabsProps} class="settings-modal-tabs-root">
      <SettingsDialogShell
        class="app-settings-modal-shell"
        open={props.open}
        onOpenChange={props.onOpenChange}
        title={title()}
        description={description()}
        contentKey={activeTab()}
        restoreFocusTarget={props.restoreFocusTarget}
        onContentElement={(element) => (modalElement = element)}
        floatingContent={
          <Show when={openCodeKeyOpen() && props.providerKeys}>
            {(api) => <OpenCodeKeyDialog api={api()} onClose={() => setOpenCodeKeyOpen(false)} />}
          </Show>
        }
        footer={
          <Show when={profile.nameDirty()}>
            <section class="settings-modal-save-bar" aria-label="Unsaved changes">
              <Text variant="caption" tone="muted">
                {i18n.t("settings.unsavedChanges")}
              </Text>
              <div class="settings-modal-save-actions">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={profile.state.profile.busy}
                  onClick={profile.resetName}
                >
                  {i18n.t("settings.reset")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="default"
                  loading={profile.state.profile.busy}
                  loadingLabel={i18n.t("settings.saving")}
                  disabled={profile.state.profile.busy}
                  onClick={() => void profile.saveName()}
                >
                  {i18n.t("settings.save")}
                </Button>
              </div>
            </section>
          </Show>
        }
        sidebar={
          <Tabs.List class="settings-modal-nav" aria-label={i18n.t("settings.sectionsLabel")}>
            <For each={filteredNavItems()}>
              {(item) => {
                const NavIcon = item.icon;
                return (
                  <Tabs.Trigger
                    class="settings-modal-nav-item"
                    value={item.value}
                    aria-current={activeTab() === item.value ? "page" : undefined}
                  >
                    <NavIcon aria-hidden="true" />
                    <span>{item.label}</span>
                  </Tabs.Trigger>
                );
              }}
            </For>
          </Tabs.List>
        }
      >
        <Tabs.Content value="general" class="settings-modal-tab-panel" data-tab="general">
          <SettingsGeneralTab
            store={general}
            value={props.value}
            onUpdateSetting={updateSetting}
            platform={props.appInfo?.platform}
            selectMount={modalElement}
            onDownloadProvider={props.onDownloadProvider}
            onCancelProviderDownload={props.onCancelProviderDownload}
            onUpdateProvider={props.onUpdateProvider}
            onConnectProvider={props.onConnectProvider}
            onInstallProvider={props.onInstallProvider}
            onAddCustomProvider={props.onAddCustomProvider}
            customProviders={props.customProviders}
            onDeleteCustomProvider={props.onDeleteCustomProvider}
            onSignInProvider={props.providerKeys ? openProviderKeyDialog : undefined}
          />
        </Tabs.Content>

        <Tabs.Content value="computer-use" class="settings-modal-tab-panel" data-tab="computer-use">
          <ComputerUseMacSetup platform={props.appInfo?.platform ?? "darwin"} variant="settings" />
        </Tabs.Content>

        <Tabs.Content value="profile" class="settings-modal-tab-panel" data-tab="profile">
          <SettingsProfileTab
            store={profile}
            account={props.account}
            canListSessions={Boolean(props.onListAccountSessions)}
            canRevokeSession={Boolean(props.onRevokeAccountSession)}
          />
        </Tabs.Content>

        <Tabs.Content value="mobile-connect" class="settings-modal-tab-panel" data-tab="mobile-connect">
          <SettingsMobileConnectTab
            store={mobileConnect}
            canCreateTicket={Boolean(props.onCreateMobileConnect)}
            canRevokeDevice={Boolean(props.onRevokeMobileConnectedDevice)}
          />
        </Tabs.Content>

        <Tabs.Content value="updates" class="settings-modal-tab-panel" data-tab="updates">
          <SettingsUpdatesTab
            store={updates}
            value={props.value}
            onUpdateSetting={updateSetting}
            selectMount={modalElement}
          />
        </Tabs.Content>
        <Tabs.Content value="hosted-sites" class="settings-modal-tab-panel" data-tab="hosted-sites">
          <SettingsHostedSitesTab store={hostedSites} available={Boolean(props.hostedSitesApi)} />
        </Tabs.Content>
      </SettingsDialogShell>
    </Tabs.Root>
  );
}
