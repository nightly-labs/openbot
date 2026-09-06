import type {
  AccountSession,
  AgentProviderId,
  AgentStatus,
  AppInfo,
  AvatarImageInput,
  CentralAuthUser,
  HostedSitesDesktopApi,
  MobileConnectedDevice,
  MobileConnectTicket,
  ProviderRuntimeStatus,
  UpdateStatus,
} from "@openbot/contracts/ipc";
import { createSignal, Show } from "solid-js";
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
import type { GeneralSettingsValue } from "./app-settings";
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
  onDownloadProvider?: (provider: AgentProviderId) => void | Promise<void>;
  onCancelProviderDownload?: (provider: AgentProviderId) => void | Promise<void>;
  onConnectProvider?: (provider: AgentProviderId) => void | Promise<void>;
  hostedSitesApi?: HostedSitesDesktopApi;
  restoreFocusTarget?: HTMLElement | null;
}

type SettingsTab = "general" | "computer-use" | "profile" | "mobile-connect" | "updates" | "hosted-sites";

type SettingsNavItem = { value: SettingsTab; label: string; icon: typeof Settings };

const navItems: ReadonlyArray<SettingsNavItem> = [
  { value: "general", label: "General", icon: Settings },
  { value: "computer-use", label: "Computer Use", icon: MousePointer2 },
  { value: "profile", label: "Profile", icon: UserRound },
  { value: "mobile-connect", label: "Mobile Connect", icon: Smartphone },
  { value: "updates", label: "Updates", icon: CircleArrowDown },
  { value: "hosted-sites", label: "Hosted sites", icon: Globe2 },
];

const tabDetails: Record<SettingsTab, { title: string; description: string }> = {
  general: { title: "General", description: "Control how OpenBot behaves on this computer." },
  "computer-use": {
    title: "Computer Use",
    description: "Allow OpenBot to see and interact with apps on this Mac.",
  },
  profile: { title: "Profile", description: "Manage how you appear in OpenBot." },
  "mobile-connect": { title: "Mobile Connect", description: "Sign in securely on your phone." },
  updates: { title: "Updates", description: "Keep OpenBot current on this computer." },
  "hosted-sites": { title: "Hosted sites", description: "View and manage static sites published by your agents." },
};

/**
 * The dialog shell: the tab list, the header, the footer save bar, and one delegation per panel.
 *
 * Every panel's state is a store created here rather than inside its tab, because Kobalte unmounts
 * an unselected `Tabs.Content` when the dialog closes. A list owned by the tab would lose the rows
 * it is showing while it refetches on reopen, and the footer below could not read the profile
 * draft while another tab is selected.
 */
export function SettingsModal(props: SettingsModalProps) {
  const [activeTab, setActiveTab] = createSignal<SettingsTab>("general");
  let modalElement: HTMLElement | undefined;

  const general = createSettingsGeneralStore(props);
  const profile = createSettingsProfileStore(props, () => activeTab() === "profile");
  const mobileConnect = createSettingsMobileConnectStore(props, () => activeTab() === "mobile-connect");
  const updates = createSettingsUpdatesStore(props);
  const hostedSites = createSettingsHostedSitesStore(props, () => activeTab() === "hosted-sites");

  const title = () => tabDetails[activeTab()].title;
  const description = () => tabDetails[activeTab()].description;

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

  function updateSetting<Key extends keyof GeneralSettingsValue>(key: Key, value: GeneralSettingsValue[Key]): void {
    props.onValueChange({ ...props.value, [key]: value });
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
        footer={
          <Show when={profile.nameDirty()}>
            <section class="settings-modal-save-bar" aria-label="Unsaved changes">
              <Text variant="caption" tone="muted">
                Changes not saved
              </Text>
              <div class="settings-modal-save-actions">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={profile.state.profile.busy}
                  onClick={profile.resetName}
                >
                  Reset
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="default"
                  loading={profile.state.profile.busy}
                  loadingLabel="Saving…"
                  disabled={profile.state.profile.busy}
                  onClick={() => void profile.saveName()}
                >
                  Save
                </Button>
              </div>
            </section>
          </Show>
        }
        sidebar={
          <Tabs.List class="settings-modal-nav" aria-label="Settings sections">
            {navItems
              .filter((item) => item.value !== "computer-use" || props.appInfo?.platform === "darwin")
              .map((item) => {
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
              })}
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
            onConnectProvider={props.onConnectProvider}
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
