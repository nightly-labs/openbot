import type {
  AccountSession,
  AppInfo,
  AvatarImageInput,
  BillingDesktopApi,
  CentralAuthUser,
  DynamicIslandGeometry,
  HostedServersDesktopApi,
  MobileConnectedDevice,
  MobileConnectTicket,
  UpdateStatus,
} from "@openbot/contracts/ipc";
import { Tabs } from "@openbot/ui";
import { BillingPanel } from "@openbot/ui/features/billing/BillingPanel";
import { createBillingStore } from "@openbot/ui/features/billing/billing-store";
import type { GeneralSettingsValue } from "@openbot/ui/features/settings/app-settings";
import { ProfileNameSaveBar } from "@openbot/ui/features/settings/ProfileNameSaveBar";
import { SettingsDialogShell } from "@openbot/ui/features/settings/SettingsDialogShell";
import { SettingsHostedServersTab } from "@openbot/ui/features/settings/SettingsHostedServersTab";
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
import { SettingsDynamicIslandTab } from "./SettingsDynamicIslandTab";
import { SettingsGeneralTab } from "./SettingsGeneralTab";
import { navItem, navItems, type SettingsTab } from "./settings-tabs";

export interface SettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: GeneralSettingsValue;
  onValueChange: (value: GeneralSettingsValue) => void;
  appInfo: AppInfo | null;
  /** The built-in display's notch, null when it has none, or undefined before main answers. */
  builtInDisplayGeometry?: DynamicIslandGeometry | undefined;
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
  let modalElement: HTMLElement | undefined;
  const profile = createSettingsProfileStore(props, () => activeTab() === "profile");
  const mobileConnect = createSettingsMobileConnectStore(props, () => activeTab() === "mobile-connect");
  const updates = createSettingsUpdatesStore(props);
  const billing = createBillingStore(
    () => props.billingApi,
    () => props.open && activeTab() === "billing",
  );
  const hostedServers = createSettingsHostedServersStore(props, () => activeTab() === "hosted-servers");

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
  // The Hosted servers tab exists only after its list loads. A tab with no trigger falls back to General.
  createEffect(
    () => {
      const tab = props.open ? props.openTab : undefined;
      return tab === "hosted-servers" && !hostedServersShown() ? undefined : tab;
    },
    (tab) => {
      if (tab) setActiveTab(tab);
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
        (value === "dynamic-island" && isMac()) ||
        value === "computer-use" ||
        value === "profile" ||
        value === "billing" ||
        value === "mobile-connect" ||
        value === "updates" ||
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
            variant={props.appInfo?.variant ?? "production"}
            onUpdateSetting={updateSetting}
            onUpdateSettings={updateSettings}
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

        <Show when={isMac()}>
          <Tabs.Content value="dynamic-island" class="settings-modal-tab-panel" data-tab="dynamic-island">
            <SettingsDynamicIslandTab
              value={props.value}
              variant={props.appInfo?.variant ?? "production"}
              builtInDisplayGeometry={props.builtInDisplayGeometry}
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
