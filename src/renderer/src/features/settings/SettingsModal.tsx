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
import { useI18n } from "../../i18n-context";
import { ComputerUseMacSetup } from "../computer-use/ComputerUseMacSetup";
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
  const [openCodeKeyOpen, setOpenCodeKeyOpen] = createSignal(false);
  let modalElement: HTMLElement | undefined;

  const general = createSettingsGeneralStore(props);
  const profile = createSettingsProfileStore(props, () => activeTab() === "profile");
  const mobileConnect = createSettingsMobileConnectStore(props, () => activeTab() === "mobile-connect");
  const updates = createSettingsUpdatesStore(props);
  const hostedSites = createSettingsHostedSitesStore(props, () => activeTab() === "hosted-sites");

  const title = () => i18n.t(navItem(activeTab()).titleKey);
  const description = () => i18n.t(navItem(activeTab()).descriptionKey);

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
          </Show>
        }
        sidebar={
          <Tabs.List class="settings-modal-nav" aria-label={i18n.t("settings.sections.label")}>
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
