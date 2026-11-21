import type {
  AccountSession,
  AppInfo,
  AvatarColor,
  AvatarImageInput,
  BillingDesktopApi,
  CentralAuthUser,
  DynamicIslandGeometry,
  HostedServersDesktopApi,
  LicenseDesktopApi,
  MobileConnectedDevice,
  MobileConnectLink,
  MobileConnectTicket,
  ReferralDesktopApi,
  RemoteNetworkRoute,
  RemoteNetworkRouteState,
  ServerNotificationLevel,
  ServerSummary,
  UpdateStatus,
} from "@openbot/contracts/ipc";
import {
  Alert,
  AlertActions,
  AlertContent,
  AlertDescription,
  AlertIcon,
  Button,
  Tabs,
  TriangleAlert,
} from "@openbot/ui";
import { BillingPanel } from "@openbot/ui/features/billing/BillingPanel";
import { createBillingStore } from "@openbot/ui/features/billing/billing-store";
import { LicenseSection } from "@openbot/ui/features/billing/LicenseSection";
import { createLicenseStore } from "@openbot/ui/features/billing/license-store";
import { ReferralPanel } from "@openbot/ui/features/referral/ReferralPanel";
import { createReferralStore } from "@openbot/ui/features/referral/referral-store";
import type { GeneralSettingsValue } from "@openbot/ui/features/settings/app-settings";
import {
  SettingsDialogShell,
  SettingsNavGroupLabel,
  type SettingsPagePlacement,
} from "@openbot/ui/features/settings/SettingsDialogShell";
import type { MobileInstallRequest } from "@openbot/ui/features/settings/SettingsMobileConnectTab";
import { SettingsMobileConnectTab } from "@openbot/ui/features/settings/SettingsMobileConnectTab";
import { SettingsProfileTab } from "@openbot/ui/features/settings/SettingsProfileTab";
import { SettingsUpdatesTab } from "@openbot/ui/features/settings/SettingsUpdatesTab";
import { createSettingsHostedServersStore } from "@openbot/ui/features/settings/stores/hosted-servers-store";
import { createSettingsMobileConnectStore } from "@openbot/ui/features/settings/stores/mobile-connect-store";
import { createSettingsProfileStore } from "@openbot/ui/features/settings/stores/profile-store";
import { createSettingsUpdatesStore } from "@openbot/ui/features/settings/stores/updates-store";
import { createEffect, createSignal, Show, untrack } from "solid-js";
import { useI18n } from "../../i18n-context";
import { ComputerUseSetup } from "../computer-use/ComputerUseSetup";
import type { CodexLiveAccess } from "../speech/codex-live-access";
import type { LiveVoiceAccountChoice } from "./LiveVoiceAccountRow";
import { licenseContactUs, trackLicenseEvent } from "./license-analytics";
import { createNotificationLevelsStore } from "./notification-levels-store";
import { createProfileActivityStore } from "./profile-activity-store";
import { renderProfileShareImage } from "./profile-share-image";
import { type AgentDockSettingsModel, SettingsAgentDockTab } from "./SettingsAgentDockTab";
import { SettingsDynamicIslandTab } from "./SettingsDynamicIslandTab";
import { SettingsGeneralTab } from "./SettingsGeneralTab";
import { SettingsNotificationsTab } from "./SettingsNotificationsTab";
import { SettingsVoiceTab } from "./SettingsVoiceTab";
import { dynamicIslandSettingsShown, navItem, navItems, type SettingsTab, settingsTabShown } from "./settings-tabs";
import { createSettingsVoiceStore } from "./settings-voice-store";

export interface SettingsModalProps {
  open: boolean;
  value: GeneralSettingsValue;
  onValueChange: (value: GeneralSettingsValue) => void;
  preferencesLoadFailed?: boolean;
  onRetryPreferencesLoad?: () => void;
  appInfo: AppInfo | null;
  chatWindow?: boolean;
  builtInDisplayGeometry?: DynamicIslandGeometry | undefined;
  agentDock?: AgentDockSettingsModel | undefined;
  servers?: readonly ServerSummary[];
  onSetServerNotificationLevel?: ((serverId: string, level: ServerNotificationLevel) => Promise<void>) | undefined;
  onSetServerMuted?: ((serverId: string, muted: boolean, durationMs?: number) => Promise<void>) | undefined;
  notificationFocusRequest?: { serverId: string; nonce: number } | null | undefined;
  updateStatus: UpdateStatus;
  onUpdateAction: () => Promise<void>;
  onOpenWhatsNew?: (() => void) | undefined;
  onCancelScheduledRestart?: () => Promise<void>;
  onRestartWhenIdle?: () => Promise<void>;
  onCancelIdleRestart?: () => Promise<void>;
  onRestartNow?: () => Promise<void>;
  account: CentralAuthUser;
  onUpdateAccountName: (name: string) => Promise<void>;
  onUpdateAccountAvatar: (image: AvatarImageInput | null) => Promise<void>;
  onSetChatColor: (color: AvatarColor | null) => Promise<void>;
  onCreateMobileConnect?: () => Promise<MobileConnectTicket>;
  onCancelMobileConnect?: () => Promise<void>;
  onGetMobileConnectLink?: () => Promise<MobileConnectLink | null>;
  onCreateMobileConnectLink?: () => Promise<MobileConnectLink>;
  onRevokeMobileConnectLink?: () => Promise<void>;
  onListMobileConnectedDevices?: () => Promise<MobileConnectedDevice[]>;
  onRevokeMobileConnectedDevice?: (sessionId: string) => Promise<void>;
  onGetRemoteNetworkRoute?: () => Promise<RemoteNetworkRouteState>;
  onSetRemoteNetworkRoute?: (route: RemoteNetworkRoute) => Promise<RemoteNetworkRouteState>;
  onListAccountSessions?: () => Promise<AccountSession[]>;
  onRevokeAccountSession?: (sessionId: string) => Promise<void>;
  onSignOut?: (() => Promise<void>) | undefined;
  processAvatarFile?: (file: File) => Promise<AvatarImageInput>;
  billingApi?: BillingDesktopApi;
  referralApi?: ReferralDesktopApi | undefined;
  licenseApi?: LicenseDesktopApi | undefined;
  onContactUs?: (() => void) | undefined;
  hostedServersApi?: HostedServersDesktopApi | undefined;
  onAddHostedServer?: (() => void) | undefined;
  codexLiveAccess?: CodexLiveAccess | undefined;
  liveVoiceAccount?: LiveVoiceAccountChoice | undefined;
  onConnectCodex?: (() => void) | undefined;
  hostedServerDeleteRequest?: { serverId: string; nonce: number } | null;
  mobileInstallRequest?: MobileInstallRequest | null;
  onTestNotification?: () => void | Promise<void>;
  onOpenNotificationSettings?: () => void | Promise<void>;
  restoreFocusTarget?: HTMLElement | null;
  initialTab?: SettingsTab | undefined;
  openTab?: SettingsTab | undefined;
  page: SettingsPagePlacement | undefined;
}

export function SettingsModal(props: SettingsModalProps) {
  const i18n = useI18n();
  const [activeTab, setActiveTab] = createSignal<SettingsTab>(
    untrack(() => (props.initialTab === "hosted-servers" ? "billing" : props.initialTab)) ?? "general",
  );
  let modalElement: HTMLElement | undefined;
  const profile = createSettingsProfileStore(props, () => activeTab() === "profile");
  const profileActivity = createProfileActivityStore(
    () => props.open && activeTab() === "profile",
    (stats) => renderProfileShareImage(props.account, stats),
  );
  const mobileConnect = createSettingsMobileConnectStore(props, () => activeTab() === "mobile-connect");
  const updates = createSettingsUpdatesStore(props);
  const billing = createBillingStore(
    () => props.billingApi,
    () => props.open && activeTab() === "billing",
  );
  const referral = createReferralStore(
    () => props.referralApi,
    () => props.open && activeTab() === "referral",
  );
  const license = createLicenseStore(
    () => props.licenseApi,
    () => props.open && activeTab() === "billing",
    trackLicenseEvent,
  );
  const hostedServers = createSettingsHostedServersStore(props, () => activeTab() === "billing");
  const voice = createSettingsVoiceStore(() => props.open && activeTab() === "voice");
  const notificationLevels = createNotificationLevelsStore({
    visible: () => props.open && activeTab() === "notifications",
    servers: () => props.servers ?? [],
  });
  let handledHostedServerDeleteNonce = 0;
  createEffect(
    () => (props.open ? props.hostedServerDeleteRequest : null),
    (request) => {
      if (!request || request.nonce === handledHostedServerDeleteNonce) return;
      handledHostedServerDeleteNonce = request.nonce;
      hostedServers.requestDeleteById(request.serverId);
    },
  );

  const dynamicIslandShown = () => dynamicIslandSettingsShown(props.appInfo?.platform, props.chatWindow === true);
  createEffect(
    () => {
      const tab = props.open ? props.openTab : undefined;
      return tab === "hosted-servers" ? "billing" : tab;
    },
    (tab) => {
      if (!tab) return;
      setActiveTab(tab);
    },
  );
  const agentDockShown = () =>
    settingsTabShown("agent-dock", { platform: props.appInfo?.platform, chatWindow: props.chatWindow === true }) &&
    props.agentDock !== undefined;
  const visibleNavItems = () =>
    navItems.filter(
      (item) =>
        settingsTabShown(item.value, { platform: props.appInfo?.platform, chatWindow: props.chatWindow === true }) &&
        (item.value !== "agent-dock" || props.agentDock !== undefined),
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
        value === "appearance" ||
        value === "app-behavior" ||
        value === "notifications" ||
        value === "voice" ||
        (value === "dynamic-island" && dynamicIslandShown()) ||
        (value === "agent-dock" && agentDockShown()) ||
        value === "computer-use" ||
        value === "profile" ||
        value === "billing" ||
        value === "referral" ||
        value === "mobile-connect" ||
        value === "updates"
      ) {
        setActiveTab(value);
      }
    },
    orientation: "vertical" as const,
    activationMode: "automatic" as const,
  };

  const preferencesLoadError = () => (
    <Show when={props.preferencesLoadFailed}>
      <Alert tone="danger" role="alert" report={{ operation: "settings", source: "system", cause_code: "unknown" }}>
        <AlertIcon>
          <TriangleAlert aria-hidden="true" />
        </AlertIcon>
        <AlertContent>
          <AlertDescription>{i18n.t("settings.preferences.loadFailed")}</AlertDescription>
        </AlertContent>
        <Show when={props.onRetryPreferencesLoad}>
          {(retry) => (
            <AlertActions>
              <Button type="button" variant="outline" size="sm" onClick={() => retry()()}>
                {i18n.t("common.retry")}
              </Button>
            </AlertActions>
          )}
        </Show>
      </Alert>
    </Show>
  );

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
        page={props.page}
        open={props.open}
        title={title()}
        description={description()}
        contentKey={activeTab()}
        restoreFocusTarget={props.restoreFocusTarget}
        onContentElement={(element) => (modalElement = element)}
        sidebar={
          <Tabs.List class="settings-modal-nav" aria-label={i18n.t("settings.sections.label")}>
            {visibleNavItems().map((item, index, items) => {
              const NavIcon = item.icon;
              const group = item.group !== items[index - 1]?.group ? item.group : undefined;
              return (
                <>
                  {group ? <SettingsNavGroupLabel label={i18n.t(group)} /> : null}
                  <Tabs.Trigger
                    class="settings-modal-nav-item"
                    value={item.value}
                    aria-current={activeTab() === item.value ? "page" : undefined}
                  >
                    <NavIcon aria-hidden="true" />
                    <span>{i18n.t(item.titleKey)}</span>
                  </Tabs.Trigger>
                </>
              );
            })}
          </Tabs.List>
        }
      >
        <Tabs.Content value="general" class="settings-modal-tab-panel" data-tab="general">
          {preferencesLoadError()}
          <SettingsGeneralTab
            part="general"
            value={props.value}
            variant={props.appInfo?.variant ?? "production"}
            platform={props.appInfo?.platform}
            onUpdateSetting={updateSetting}
            onUpdateSettings={updateSettings}
            selectMount={modalElement}
            chatColor={props.account.chatColor ?? null}
            onSetChatColor={props.onSetChatColor}
          />
        </Tabs.Content>

        <Tabs.Content value="appearance" class="settings-modal-tab-panel" data-tab="appearance">
          {preferencesLoadError()}
          <SettingsGeneralTab
            part="appearance"
            value={props.value}
            variant={props.appInfo?.variant ?? "production"}
            platform={props.appInfo?.platform}
            onUpdateSetting={updateSetting}
            onUpdateSettings={updateSettings}
            selectMount={modalElement}
            chatColor={props.account.chatColor ?? null}
            onSetChatColor={props.onSetChatColor}
          />
        </Tabs.Content>

        <Tabs.Content value="app-behavior" class="settings-modal-tab-panel" data-tab="app-behavior">
          {preferencesLoadError()}
          <SettingsGeneralTab
            part="app-behavior"
            value={props.value}
            variant={props.appInfo?.variant ?? "production"}
            platform={props.appInfo?.platform}
            onUpdateSetting={updateSetting}
            onUpdateSettings={updateSettings}
            selectMount={modalElement}
            chatColor={props.account.chatColor ?? null}
            onSetChatColor={props.onSetChatColor}
          />
        </Tabs.Content>

        <Tabs.Content value="notifications" class="settings-modal-tab-panel" data-tab="notifications">
          {preferencesLoadError()}
          <SettingsNotificationsTab
            value={props.value}
            onUpdateSetting={updateSetting}
            onUpdateSettings={updateSettings}
            onTestNotification={props.onTestNotification}
            onOpenNotificationSettings={
              props.appInfo?.platform === "darwin" || props.appInfo?.platform === "win32"
                ? props.onOpenNotificationSettings
                : undefined
            }
            levels={notificationLevels}
            onSetServerLevel={(serverId, level) =>
              props.onSetServerNotificationLevel?.(serverId, level) ?? Promise.resolve()
            }
            onSetServerMuted={(serverId, muted, durationMs) =>
              props.onSetServerMuted?.(serverId, muted, durationMs) ?? Promise.resolve()
            }
            focusRequest={props.notificationFocusRequest}
            menuMount={modalElement}
          />
        </Tabs.Content>

        <Tabs.Content value="voice" class="settings-modal-tab-panel" data-tab="voice">
          <SettingsVoiceTab
            store={voice}
            selectMount={modalElement}
            codexLiveAccess={props.codexLiveAccess}
            onConnectCodex={props.onConnectCodex}
            liveVoiceAccount={props.liveVoiceAccount}
            platform={props.appInfo?.platform}
          />
        </Tabs.Content>

        <Show when={dynamicIslandShown()}>
          <Tabs.Content value="dynamic-island" class="settings-modal-tab-panel" data-tab="dynamic-island">
            {preferencesLoadError()}
            <SettingsDynamicIslandTab
              value={props.value}
              variant={props.appInfo?.variant ?? "production"}
              platform={props.appInfo?.platform}
              builtInDisplayGeometry={props.builtInDisplayGeometry}
              servers={props.servers ?? []}
              onUpdateSetting={updateSetting}
              onUpdateSettings={updateSettings}
            />
          </Tabs.Content>
        </Show>

        <Show when={agentDockShown() && props.agentDock}>
          {(model) => (
            <Tabs.Content value="agent-dock" class="settings-modal-tab-panel" data-tab="agent-dock">
              <SettingsAgentDockTab model={model()} selectMount={modalElement} />
            </Tabs.Content>
          )}
        </Show>

        <Tabs.Content value="computer-use" class="settings-modal-tab-panel" data-tab="computer-use">
          <ComputerUseSetup variant="settings" />
        </Tabs.Content>

        <Tabs.Content value="profile" class="settings-modal-tab-panel profile-panel" data-tab="profile">
          <SettingsProfileTab
            store={profile}
            account={props.account}
            activity={profileActivity}
            canListSessions={Boolean(props.onListAccountSessions)}
            canRevokeSession={Boolean(props.onRevokeAccountSession)}
            onSignOut={props.onSignOut}
          />
        </Tabs.Content>

        <Tabs.Content value="billing" class="settings-modal-tab-panel" data-tab="billing">
          <BillingPanel
            store={billing}
            available={Boolean(props.billingApi)}
            hostedServers={hostedServers}
            onAddServer={hostedServers.state.available ? props.onAddHostedServer : undefined}
            license={
              <LicenseSection
                store={license}
                onManagePayment={() => void billing.openPortal({ flow: "manage" })}
                onContactUs={licenseContactUs(props.onContactUs)}
                billingDetails={props.billingApi}
              />
            }
          />
        </Tabs.Content>

        <Tabs.Content value="referral" class="settings-modal-tab-panel" data-tab="referral">
          <ReferralPanel store={referral} available={props.referralApi !== undefined} />
        </Tabs.Content>

        <Tabs.Content value="mobile-connect" class="settings-modal-tab-panel" data-tab="mobile-connect">
          <SettingsMobileConnectTab
            store={mobileConnect}
            canCreateTicket={Boolean(props.onCreateMobileConnect)}
            canCancelTicket={Boolean(props.onCancelMobileConnect)}
            canManageLink={Boolean(props.onCreateMobileConnectLink && props.onRevokeMobileConnectLink)}
            canRevokeDevice={Boolean(props.onRevokeMobileConnectedDevice)}
            canSetRoute={Boolean(props.onSetRemoteNetworkRoute)}
            installRequest={props.open ? props.mobileInstallRequest : null}
          />
        </Tabs.Content>

        <Tabs.Content value="updates" class="settings-modal-tab-panel" data-tab="updates">
          {preferencesLoadError()}
          <SettingsUpdatesTab
            store={updates}
            onOpenWhatsNew={props.onOpenWhatsNew}
            value={props.value}
            onUpdateSetting={updateSetting}
            selectMount={modalElement}
          />
        </Tabs.Content>
      </SettingsDialogShell>
    </Tabs.Root>
  );
}
