import type {
  AccountSession,
  AgentProviderId,
  AgentStatus,
  AppInfo,
  AvatarImageInput,
  BillingDesktopApi,
  CentralAuthUser,
  CustomProviderRestart,
  CustomProviderSummary,
  HostedServersDesktopApi,
  HostedSitesDesktopApi,
  MobileConnectedDevice,
  MobileConnectTicket,
  ProviderRuntimeStatus,
  SaveCustomProviderInput,
  UpdateStatus,
} from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import {
  CircleArrowDown,
  CreditCard,
  Globe2,
  MousePointer2,
  PanelTop,
  Server,
  Settings,
  Smartphone,
  Sparkles,
  Tabs,
  UserRound,
} from "@openbot/ui";
import { BillingPanel } from "@openbot/ui/features/billing/BillingPanel";
import { createBillingStore } from "@openbot/ui/features/billing/billing-store";
import type { CustomAgentSettingsApi } from "@openbot/ui/features/custom-providers/CustomAgentSettings";
import type { DetectedProviderApi, ProviderDetection } from "@openbot/ui/features/custom-providers/detected-providers";
import {
  ProviderDetectionSettings,
  type ProviderDetectionSettingsValue,
} from "@openbot/ui/features/custom-providers/ProviderDetectionSettings";
import type { GeneralSettingsValue } from "@openbot/ui/features/settings/app-settings";
import type { ProviderKeyApi } from "@openbot/ui/features/settings/OpenCodeKeyDialog";
import { ProfileNameSaveBar } from "@openbot/ui/features/settings/ProfileNameSaveBar";
import { SettingsDialogShell } from "@openbot/ui/features/settings/SettingsDialogShell";
import { SettingsHostedServersTab } from "@openbot/ui/features/settings/SettingsHostedServersTab";
import { SettingsHostedSitesTab } from "@openbot/ui/features/settings/SettingsHostedSitesTab";
import { SettingsMobileConnectTab } from "@openbot/ui/features/settings/SettingsMobileConnectTab";
import { SettingsProfileTab } from "@openbot/ui/features/settings/SettingsProfileTab";
import { SettingsUpdatesTab } from "@openbot/ui/features/settings/SettingsUpdatesTab";
import { createSettingsHostedServersStore } from "@openbot/ui/features/settings/stores/hosted-servers-store";
import {
  createSettingsHostedSitesStore,
  type HostedSiteDeleteResult,
} from "@openbot/ui/features/settings/stores/hosted-sites-store";
import { createSettingsMobileConnectStore } from "@openbot/ui/features/settings/stores/mobile-connect-store";
import { createSettingsProfileStore } from "@openbot/ui/features/settings/stores/profile-store";
import { createSettingsUpdatesStore } from "@openbot/ui/features/settings/stores/updates-store";
import { createEffect, createSignal, Show, untrack } from "solid-js";
import { desktopAnalytics } from "../../analytics";
import { appPort } from "../../app-port";
import type { ProviderCodeLoginApi } from "../../components/provider-code-login-api";
import { useI18n } from "../../i18n-context";
import { ComputerUseSetup } from "../computer-use/ComputerUseSetup";
import { createProviderKeyState, ProviderSettingsDialogs, ProviderSettingsSection } from "./ProviderSettingsSection";
import { SettingsDynamicIslandTab } from "./SettingsDynamicIslandTab";
import { SettingsGeneralTab } from "./SettingsGeneralTab";
import { createSettingsGeneralStore } from "./stores/general-store";

export interface SettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: GeneralSettingsValue;
  onValueChange: (value: GeneralSettingsValue) => void;
  appInfo: AppInfo | null;
  updateStatus: UpdateStatus;
  onUpdateAction: () => Promise<void>;
  onCancelScheduledRestart?: () => Promise<void>;
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
  /** Accepts a described endpoint from the AI providers tab. Omitted on a remote server, which hides it. */
  onAddCustomProvider?: (value: SaveCustomProviderInput) => Promise<CustomProviderRestart>;
  customProviders?: readonly CustomProviderSummary[];
  onDeleteCustomProvider?: (id: string) => Promise<CustomProviderRestart>;
  /** Local model servers and ACP agents found on this computer. Omitted on a remote server. */
  providerDetection?: ProviderDetection;
  detectedProviderApi?: DetectedProviderApi;
  /** Saved custom agent IDs, so a found agent's ID is checked before the round trip. */
  takenAgentIds?: readonly string[];
  /** The user's own ACP agents. Only the local host passes it. */
  customAgents?: CustomAgentSettingsApi;
  /** Where the scan looks. Without it the tab has no detection settings. */
  detectionSettings?: ProviderDetectionSettingsValue;
  onDetectionSettingsChange?: (value: ProviderDetectionSettingsValue) => void;
  /** The last detection settings save failed. The section keeps the rows the user typed. */
  detectionSettingsError?: string | null;
  /** Runs each time the AI providers tab is shown, so the found list is current. */
  onProvidersShown?: () => void;
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
  billingApi?: BillingDesktopApi;
  /** The account's hosted servers. The tab is shown only when the account server offers them. */
  hostedServersApi?: HostedServersDesktopApi;
  /** Opens the add server dialog from the Hosted servers tab. */
  onAddHostedServer?: () => void;
  /** The agents granted a standing approval, so the user can see and undo each one. */
  turboModePending?: boolean;
  onTestNotification?: () => void | Promise<void>;
  /** Opens the operating system notification settings. Shown only on macOS and Windows. */
  onOpenNotificationSettings?: () => void | Promise<void>;
  restoreFocusTarget?: HTMLElement | null;
  /** The tab shown when the modal is created. Read once; the user moves between tabs after that. */
  initialTab?: SettingsTab;
  /** The tab shown each time the modal opens. Without it, the modal shows the tab that was open last. */
  openTab?: SettingsTab | undefined;
}

export type SettingsTab =
  | "general"
  | "providers"
  | "dynamic-island"
  | "computer-use"
  | "profile"
  | "billing"
  | "mobile-connect"
  | "updates"
  | "hosted-sites"
  | "hosted-servers";

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
    value: "providers",
    titleKey: "settings.tab.providers.title",
    descriptionKey: "settings.tab.providers.description",
    icon: Sparkles,
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
    value: "billing",
    titleKey: "settings.tab.billing.title",
    descriptionKey: "settings.tab.billing.description",
    icon: CreditCard,
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
  {
    value: "hosted-servers",
    titleKey: "settings.tab.hostedServers.title",
    descriptionKey: "settings.tab.hostedServers.description",
    icon: Server,
  },
];

function navItem(tab: SettingsTab): SettingsNavItem {
  const found = navItems.find((item) => item.value === tab);
  if (!found) throw new Error(`Unknown settings tab: ${tab}`);
  return found;
}

/** The account that starts a deletion gets its result event, as the scope is taken at the start. */
function trackHostedSiteDelete(): (result: HostedSiteDeleteResult) => void {
  const analytics = desktopAnalytics.scope();
  return (result) =>
    analytics.track("hosted_site_action", {
      action: "delete",
      entry_point: "settings",
      result,
      ...(result === "failed" ? { failure_code: "delete_failed" } : {}),
    });
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
  const [activeTab, setActiveTab] = createSignal<SettingsTab>(untrack(() => props.initialTab) ?? "general");
  createEffect(
    () => (props.open ? props.openTab : undefined),
    (tab) => {
      if (tab) setActiveTab(tab);
    },
  );
  let modalElement: HTMLElement | undefined;
  const providerKeyState = createProviderKeyState(props);

  const providers = createSettingsGeneralStore({
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
  const hostedSites = createSettingsHostedSitesStore(
    {
      get open() {
        return props.open;
      },
      get hostedSitesApi() {
        return props.hostedSitesApi;
      },
      trackDelete: trackHostedSiteDelete,
    },
    () => activeTab() === "hosted-sites",
  );
  const billing = createBillingStore(
    () => props.billingApi,
    () => props.open && activeTab() === "billing",
  );
  const hostedServers = createSettingsHostedServersStore(props, () => activeTab() === "hosted-servers");
  createEffect(
    () => props.open && activeTab() === "providers",
    (shown) => {
      if (shown) untrack(() => props.onProvidersShown?.());
    },
  );

  // The Dynamic Island exists only on macOS, so other platforms get no tab for it.
  const isMac = () => props.appInfo?.platform === "darwin";
  // An account that lost access to hosting still sees its servers, so it can delete or start them.
  const hostedServersShown = () => hostedServers.state.available || hostedServers.state.servers.length > 0;
  // A deep link, or the last server's delete, can leave the Hosted servers tab open without its panel.
  createEffect(
    () =>
      activeTab() === "hosted-servers" &&
      !hostedServersShown() &&
      (hostedServers.state.loaded || hostedServers.state.error !== null || !props.hostedServersApi),
    (hidden) => {
      if (hidden) setActiveTab("general");
    },
  );
  const visibleNavItems = () =>
    navItems.filter(
      (item) =>
        (item.value !== "dynamic-island" || isMac()) && (item.value !== "hosted-servers" || hostedServersShown()),
    );

  const title = () => i18n.t(navItem(activeTab()).titleKey);
  const description = () => i18n.t(navItem(activeTab()).descriptionKey);

  const tabsProps = {
    get value() {
      return activeTab();
    },
    onChange(value: string) {
      if (
        value === "general" ||
        value === "providers" ||
        (value === "dynamic-island" && isMac()) ||
        value === "computer-use" ||
        value === "profile" ||
        value === "billing" ||
        value === "mobile-connect" ||
        value === "updates" ||
        value === "hosted-sites" ||
        (value === "hosted-servers" && hostedServersShown())
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
        footer={<ProfileNameSaveBar store={profile} />}
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
            value={props.value}
            onUpdateSetting={updateSetting}
            selectMount={modalElement}
            turboModePending={props.turboModePending}
            onTestNotification={props.onTestNotification}
            onOpenNotificationSettings={
              props.appInfo?.platform === "darwin" || props.appInfo?.platform === "win32"
                ? props.onOpenNotificationSettings
                : undefined
            }
          />
        </Tabs.Content>

        <Tabs.Content value="providers" class="settings-modal-tab-panel" data-tab="providers">
          <ProviderSettingsSection
            store={providers}
            selectMount={modalElement}
            onDownloadProvider={props.onDownloadProvider}
            onCancelProviderDownload={props.onCancelProviderDownload}
            onUpdateProvider={props.onUpdateProvider}
            onConnectProvider={props.onConnectProvider}
            onInstallProvider={props.onInstallProvider}
            onAddCustomProvider={props.onAddCustomProvider}
            customProviders={props.customProviders}
            onDeleteCustomProvider={props.onDeleteCustomProvider}
            // With detection off there is no list, not an empty one.
            providerDetection={props.detectionSettings?.enabled === false ? undefined : props.providerDetection}
            detectedProviderApi={props.detectedProviderApi}
            takenAgentIds={props.takenAgentIds}
            customAgents={props.customAgents}
            onSignInProvider={props.providerKeys ? providerKeyState.openKeyDialog : undefined}
            onSignInWithCodeProvider={props.codeLogin?.start}
            codeSignInProviders={props.codeLogin?.providers()}
          />
          <Show when={props.detectionSettings}>
            {(value) => (
              <ProviderDetectionSettings
                value={value()}
                error={props.detectionSettingsError}
                onChange={(next) => props.onDetectionSettingsChange?.(next)}
              />
            )}
          </Show>
        </Tabs.Content>

        <Show when={isMac()}>
          <Tabs.Content value="dynamic-island" class="settings-modal-tab-panel" data-tab="dynamic-island">
            <SettingsDynamicIslandTab
              value={props.value}
              variant={props.appInfo?.variant ?? "production"}
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

        <Tabs.Content value="billing" class="settings-modal-tab-panel" data-tab="billing">
          <BillingPanel store={billing} available={Boolean(props.billingApi)} />
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
          <SettingsHostedSitesTab
            store={hostedSites}
            available={Boolean(props.hostedSitesApi)}
            onOpenSite={(url) => void appPort().openUrl(url)}
          />
        </Tabs.Content>
        <Show when={hostedServersShown()}>
          <Tabs.Content value="hosted-servers" class="settings-modal-tab-panel" data-tab="hosted-servers">
            <SettingsHostedServersTab
              store={hostedServers}
              onAddServer={hostedServers.state.available ? props.onAddHostedServer : undefined}
            />
          </Tabs.Content>
        </Show>
      </SettingsDialogShell>
    </Tabs.Root>
  );
}
