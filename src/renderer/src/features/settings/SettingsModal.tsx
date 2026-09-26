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
import type { AppTextKey } from "@openbot/i18n";
import {
  Button,
  CircleArrowDown,
  Globe2,
  MousePointer2,
  PanelTop,
  Settings,
  Smartphone,
  Tabs,
  Text,
  UserRound,
} from "@openbot/ui";
import type { GeneralSettingsValue } from "@openbot/ui/features/settings/app-settings";
import type { ProviderKeyApi } from "@openbot/ui/features/settings/OpenCodeKeyDialog";
import { SaveBarDock, SettingsDialogShell } from "@openbot/ui/features/settings/SettingsDialogShell";
import { SettingsMobileConnectTab } from "@openbot/ui/features/settings/SettingsMobileConnectTab";
import { SettingsProfileTab } from "@openbot/ui/features/settings/SettingsProfileTab";
import { SettingsUpdatesTab } from "@openbot/ui/features/settings/SettingsUpdatesTab";
import { createSettingsMobileConnectStore } from "@openbot/ui/features/settings/stores/mobile-connect-store";
import { createSettingsProfileStore } from "@openbot/ui/features/settings/stores/profile-store";
import { createSettingsUpdatesStore } from "@openbot/ui/features/settings/stores/updates-store";
import { createSignal, Show } from "solid-js";
import type { ProviderCodeLoginApi } from "../../components/provider-code-login-api";
import { useI18n } from "../../i18n-context";
import { ComputerUseSetup } from "../computer-use/ComputerUseSetup";
import { createProviderKeyState, ProviderSettingsDialogs } from "./ProviderSettingsSection";
import { SettingsDynamicIslandTab } from "./SettingsDynamicIslandTab";
import { SettingsGeneralTab } from "./SettingsGeneralTab";
import { SettingsHostedSitesTab } from "./SettingsHostedSitesTab";
import { createSettingsGeneralStore } from "./stores/general-store";
import { createSettingsHostedSitesStore } from "./stores/hosted-sites-store";

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
   * Reads and writes the optional provider keys of the computer the providers run on. Absent when
   * this window cannot manage them, which is also what takes the row's sign-in button away.
   */
  providerKeys?: ProviderKeyApi;
  /** The joined server whose host runs the listed providers. Absent when this computer runs them. */
  providerHostName?: string | undefined;
  /**
   * The code sign-in, for the providers that offer one. Absent for the same reason as
   * `providerKeys`.
   */
  codeLogin?: ProviderCodeLoginApi;
  hostedSitesApi?: HostedSitesDesktopApi;
  /** The agents granted a standing approval, so the user can see and undo each one. */
  turboModePending?: boolean;
  onTestNotification?: () => void | Promise<void>;
  /** Opens the operating system notification settings. Shown only on macOS and Windows. */
  onOpenNotificationSettings?: () => void | Promise<void>;
  restoreFocusTarget?: HTMLElement | null;
}

type SettingsTab =
  | "general"
  | "dynamic-island"
  | "computer-use"
  | "profile"
  | "mobile-connect"
  | "updates"
  | "hosted-sites";

/**
 * A tab holds the keys of its label and its header text, not the text itself. The list is read at
 * module level, before any component exists to translate it, and a label captured there would keep
 * the language the app started in.
 */
type SettingsNavItem = {
  value: SettingsTab;
  titleKey: AppTextKey;
  descriptionKey: AppTextKey;
  icon: typeof Settings;
};

const navItems: ReadonlyArray<SettingsNavItem> = [
  {
    value: "general",
    titleKey: "settings.tab.general.title",
    descriptionKey: "settings.tab.general.description",
    icon: Settings,
  },
  {
    value: "dynamic-island",
    titleKey: "settings.tab.dynamicIsland.title",
    descriptionKey: "settings.tab.dynamicIsland.description",
    icon: PanelTop,
  },
  {
    value: "computer-use",
    titleKey: "settings.tab.computerUse.title",
    descriptionKey: "settings.tab.computerUse.description",
    icon: MousePointer2,
  },
  {
    value: "profile",
    titleKey: "settings.tab.profile.title",
    descriptionKey: "settings.tab.profile.description",
    icon: UserRound,
  },
  {
    value: "mobile-connect",
    titleKey: "settings.tab.mobileConnect.title",
    descriptionKey: "settings.tab.mobileConnect.description",
    icon: Smartphone,
  },
  {
    value: "updates",
    titleKey: "settings.tab.updates.title",
    descriptionKey: "settings.tab.updates.description",
    icon: CircleArrowDown,
  },
  {
    value: "hosted-sites",
    titleKey: "settings.tab.hostedSites.title",
    descriptionKey: "settings.tab.hostedSites.description",
    icon: Globe2,
  },
];

function navItem(tab: SettingsTab): SettingsNavItem {
  const found = navItems.find((item) => item.value === tab);
  if (!found) throw new Error(`Unknown settings tab: ${tab}`);
  return found;
}

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
  const [activeTab, setActiveTab] = createSignal<SettingsTab>("general");
  let modalElement: HTMLElement | undefined;
  const providerKeyState = createProviderKeyState(props);

  const general = createSettingsGeneralStore({
    get agentStatus() {
      return props.agentStatus;
    },
    get providerRuntimeStatuses() {
      return props.providerRuntimeStatuses;
    },
    get providerAvailableVersions() {
      return props.providerAvailableVersions;
    },
    openCodeKeyStatus: providerKeyState.openCodeKeyStatus,
    get providerHostName() {
      return props.providerHostName;
    },
  });
  const profile = createSettingsProfileStore(props, () => activeTab() === "profile");
  const mobileConnect = createSettingsMobileConnectStore(props, () => activeTab() === "mobile-connect");
  const updates = createSettingsUpdatesStore(props);
  const hostedSites = createSettingsHostedSitesStore(props, () => activeTab() === "hosted-sites");

  // The Dynamic Island exists only on macOS, so other platforms get no tab for it.
  const isMac = () => props.appInfo?.platform === "darwin";
  const visibleNavItems = () => navItems.filter((item) => item.value !== "dynamic-island" || isMac());

  const title = () => i18n.t(navItem(activeTab()).titleKey);
  const description = () => i18n.t(navItem(activeTab()).descriptionKey);

  const tabsProps = {
    get value() {
      return activeTab();
    },
    onChange(value: string) {
      if (
        value === "general" ||
        (value === "dynamic-island" && isMac()) ||
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

  function updateSetting<Key extends keyof GeneralSettingsValue>(key: Key, value: GeneralSettingsValue[Key]): void {
    props.onValueChange({ ...props.value, [key]: value });
  }

  function updateSettings(patch: Partial<GeneralSettingsValue>): void {
    props.onValueChange({ ...props.value, ...patch });
  }

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
          <ProviderSettingsDialogs
            keys={providerKeyState}
            providerKeys={props.providerKeys}
            codeLogin={props.codeLogin}
            onConnectProvider={props.onConnectProvider}
          />
        }
        footer={
          <SaveBarDock value={profile.nameDirty() ? true : null}>
            {() => (
              <section class="settings-modal-save-bar" aria-label={i18n.t("settings.save.region")}>
                <Text variant="caption" tone="muted">
                  {i18n.t("settings.save.notSaved")}
                </Text>
                <div class="settings-modal-save-actions">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={profile.state.profile.busy}
                    onClick={profile.resetName}
                  >
                    {i18n.t("settings.save.reset")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="default"
                    loading={profile.state.profile.busy}
                    loadingLabel={i18n.t("settings.save.saving")}
                    disabled={profile.state.profile.busy}
                    onClick={() => void profile.saveName()}
                  >
                    {i18n.t("settings.save.save")}
                  </Button>
                </div>
              </section>
            )}
          </SaveBarDock>
        }
        sidebar={
          <Tabs.List class="settings-modal-nav" aria-label={i18n.t("settings.sections.label")}>
            {visibleNavItems().map((item) => {
              const NavIcon = item.icon;
              return (
                <Tabs.Trigger
                  class="settings-modal-nav-item"
                  value={item.value}
                  aria-current={activeTab() === item.value ? "page" : undefined}
                >
                  <NavIcon aria-hidden="true" />
                  <span>{i18n.t(item.titleKey)}</span>
                </Tabs.Trigger>
              );
            })}
          </Tabs.List>
        }
      >
        <Tabs.Content value="general" class="settings-modal-tab-panel" data-tab="general">
          <SettingsGeneralTab
            store={general}
            value={props.value}
            onUpdateSetting={updateSetting}
            selectMount={modalElement}
            onDownloadProvider={props.onDownloadProvider}
            onCancelProviderDownload={props.onCancelProviderDownload}
            onUpdateProvider={props.onUpdateProvider}
            onConnectProvider={props.onConnectProvider}
            onInstallProvider={props.onInstallProvider}
            onAddCustomProvider={props.onAddCustomProvider}
            customProviders={props.customProviders}
            onDeleteCustomProvider={props.onDeleteCustomProvider}
            onSignInProvider={props.providerKeys ? providerKeyState.openKeyDialog : undefined}
            onSignInWithCodeProvider={props.codeLogin?.start}
            turboModePending={props.turboModePending}
            onTestNotification={props.onTestNotification}
            onOpenNotificationSettings={
              props.appInfo?.platform === "darwin" || props.appInfo?.platform === "win32"
                ? props.onOpenNotificationSettings
                : undefined
            }
          />
        </Tabs.Content>

        <Show when={isMac()}>
          <Tabs.Content value="dynamic-island" class="settings-modal-tab-panel" data-tab="dynamic-island">
            <SettingsDynamicIslandTab
              value={props.value}
              onUpdateSetting={updateSetting}
              onUpdateSettings={updateSettings}
            />
          </Tabs.Content>
        </Show>

        <Tabs.Content value="computer-use" class="settings-modal-tab-panel" data-tab="computer-use">
          <ComputerUseSetup variant="settings" />
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
