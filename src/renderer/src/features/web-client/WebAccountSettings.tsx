import type { AppAppearance } from "@openbot/contracts/app-appearance";
import type { AppLanguage } from "@openbot/contracts/app-language";
import type { CentralAuthUser } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import {
  Button,
  CreditCard,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  SettingsSection,
  SlidersHorizontal,
  SwitchField,
  Tabs,
  UserRound,
} from "@openbot/ui";
import { AppearanceSelect } from "@openbot/ui/features/settings/AppearanceSelect";
import { LanguageSelect } from "@openbot/ui/features/settings/LanguageSelect";
import { NotificationMatrix, NotificationScopeTitle } from "@openbot/ui/features/settings/NotificationMatrix";
import { SendShortcutSelect } from "@openbot/ui/features/settings/SendShortcutSelect";
import { SettingsDialogShell, type SettingsPagePlacement } from "@openbot/ui/features/settings/SettingsDialogShell";
import { SettingsProfileTab } from "@openbot/ui/features/settings/SettingsProfileTab";
import { SoundThemePicker } from "@openbot/ui/features/settings/SoundThemePicker";
import { createSettingsProfileStore } from "@openbot/ui/features/settings/stores/profile-store";
import { useText } from "@openbot/ui/text";
import { createEffect, createSignal, onCleanup } from "solid-js";
import { readActionSoundChoice, replayActionSoundChoice, setActionSoundChoice } from "../../action-sounds";
import { setShowAgentSteps, useShowAgentSteps } from "../../agent-steps-preference";
import { isCompletionSoundEnabled, setCompletionSoundEnabled } from "../../completion-sound";
import { webReportsEnabled } from "../../error-reports";
import { currentDevicePlatform, setSendShortcutMode, useSendShortcutMode } from "../../send-shortcut-preference";
import type { WebAccountCalls } from "./web-account";
import { setWebAnalyticsEnabled } from "./web-analytics";
import type { WebNotificationSettings } from "./web-notification-settings";

const TABS = ["profile", "preferences"] as const;
type WebAccountSettingsTab = (typeof TABS)[number];

const TAB_ITEMS = {
  profile: {
    titleKey: "settings.tab.profile.title",
    descriptionKey: "settings.tab.profile.description",
    icon: UserRound,
  },
  preferences: {
    titleKey: "webClient.settings.preferences.title",
    descriptionKey: "webClient.settings.preferences.description",
    icon: SlidersHorizontal,
  },
} as const satisfies Record<
  WebAccountSettingsTab,
  { titleKey: AppTextKey; descriptionKey: AppTextKey; icon: typeof UserRound }
>;

export interface WebAccountSettingsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Where the settings page shows, or nothing while the page is not on screen. */
  page: SettingsPagePlacement | undefined;
  account: CentralAuthUser;
  calls: WebAccountCalls;
  language: AppLanguage;
  onChangeLanguage: (language: AppLanguage) => void;
  appearance: AppAppearance;
  onChangeAppearance: (appearance: AppAppearance) => void;
  /** Closes these settings and opens the plans and servers of the account. */
  onOpenBilling: () => void;
  onSignOut: () => Promise<void>;
  /** The levels of each host and its agents, which apply on all devices of the user. */
  notifications: WebNotificationSettings;
  /** Opens Preferences at the notification row of one host. Each nonce opens once. */
  notificationFocusRequest?: { serverId: string; nonce: number } | null | undefined;
}

/**
 * The account's own settings in the web client, where Settings opens the settings of a host. Profile
 * is the desktop tab and store; Preferences holds what this browser keeps. Sites are in the settings
 * of their server.
 */
export default function WebAccountSettings(props: WebAccountSettingsProps) {
  const [reportsEnabled, setReportsEnabled] = createSignal(webReportsEnabled());
  const { t } = useText();
  const [activeTab, setActiveTab] = createSignal<WebAccountSettingsTab>("profile");
  const [completionSound, setCompletionSound] = createSignal(isCompletionSoundEnabled());
  const sendShortcutMode = useSendShortcutMode();
  const showAgentSteps = useShowAgentSteps();
  // Playback reads the stored value on each event, so the switch follows a change from another tab.
  const [soundChoice, setSoundChoice] = createSignal(readActionSoundChoice());
  const readSoundSettings = () => {
    setCompletionSound(isCompletionSoundEnabled());
    setSoundChoice(readActionSoundChoice());
  };
  window.addEventListener("storage", readSoundSettings);
  onCleanup(() => window.removeEventListener("storage", readSoundSettings));
  let modalElement: HTMLElement | undefined;

  const profile = createSettingsProfileStore(
    {
      get open() {
        return props.open;
      },
      get account() {
        return props.account;
      },
      onUpdateAccountName: (name) => props.calls.updateName(name),
      onUpdateAccountAvatar: (image) => props.calls.updateAvatar(image),
      onListAccountSessions: () => props.calls.listSessions(),
      onRevokeAccountSession: (sessionId) => props.calls.revokeSession(sessionId),
    },
    () => activeTab() === "profile",
  );
  const navItem = () => TAB_ITEMS[activeTab()];
  // A server menu or a settings link opens the notification levels, which are in Preferences.
  createEffect(
    () => (props.open ? props.notificationFocusRequest : null),
    (request) => {
      if (request) setActiveTab("preferences");
    },
  );

  return (
    <Tabs.Root
      value={activeTab()}
      onChange={(value: string) => {
        const tab = TABS.find((candidate) => candidate === value);
        if (tab) setActiveTab(tab);
      }}
      orientation="vertical"
      activationMode="automatic"
      class="settings-modal-tabs-root"
    >
      <SettingsDialogShell
        class="app-settings-modal-shell"
        open={props.open}
        page={props.page}
        title={t(navItem().titleKey)}
        description={t(navItem().descriptionKey)}
        contentKey={activeTab()}
        onContentElement={(element) => (modalElement = element)}
        sidebar={
          <>
            <Tabs.List class="settings-modal-nav" aria-label={t("settings.sections.label")}>
              {TABS.map((tab) => {
                const item = TAB_ITEMS[tab];
                const NavIcon = item.icon;
                return (
                  <Tabs.Trigger
                    class="settings-modal-nav-item"
                    value={tab}
                    aria-current={activeTab() === tab ? "page" : undefined}
                  >
                    <NavIcon aria-hidden="true" />
                    <span>{t(item.titleKey)}</span>
                  </Tabs.Trigger>
                );
              })}
            </Tabs.List>
            <div class="settings-modal-nav">
              <Button
                variant="ghost"
                type="button"
                class="settings-modal-nav-item"
                onClick={() => {
                  props.onOpenChange(false);
                  props.onOpenBilling();
                }}
              >
                <CreditCard aria-hidden="true" />
                <span>{t("account.menu.billing")}</span>
              </Button>
            </div>
          </>
        }
      >
        <Tabs.Content value="profile" class="settings-modal-tab-panel profile-panel" data-tab="profile">
          <SettingsProfileTab
            store={profile}
            account={props.account}
            canListSessions
            canRevokeSession
            onSignOut={props.onSignOut}
          />
        </Tabs.Content>

        <Tabs.Content value="preferences" class="settings-modal-tab-panel" data-tab="preferences">
          <SettingsSection title={t("settings.appBehavior.title")}>
            <ItemGroup class="settings-modal-card">
              <Item class="settings-modal-row">
                <ItemContent>
                  <ItemTitle>{t("settings.sendShortcut.title")}</ItemTitle>
                  <ItemDescription>{t("settings.sendShortcut.description")}</ItemDescription>
                </ItemContent>
                <ItemActions>
                  <SendShortcutSelect
                    value={sendShortcutMode()}
                    onChange={(mode) => setSendShortcutMode(mode)}
                    devicePlatform={currentDevicePlatform()}
                    {...(modalElement ? { mount: modalElement } : {})}
                  />
                </ItemActions>
              </Item>
              <SwitchField
                checked={showAgentSteps()}
                onChange={(checked) => setShowAgentSteps(checked)}
                label={t("settings.showAgentSteps.title")}
                description={t("settings.showAgentSteps.description")}
              />
              <Item class="settings-modal-row">
                <ItemContent>
                  <ItemTitle>{t("settings.language.title")}</ItemTitle>
                  <ItemDescription>{t("settings.language.description")}</ItemDescription>
                </ItemContent>
                <ItemActions>
                  <LanguageSelect
                    value={props.language}
                    onChange={props.onChangeLanguage}
                    {...(modalElement ? { mount: modalElement } : {})}
                  />
                </ItemActions>
              </Item>
              <Item class="settings-modal-row">
                <ItemContent>
                  <ItemTitle>{t("settings.appearance.theme.title")}</ItemTitle>
                  <ItemDescription>{t("settings.appearance.theme.description")}</ItemDescription>
                </ItemContent>
                <ItemActions>
                  <AppearanceSelect
                    value={props.appearance}
                    onChange={props.onChangeAppearance}
                    {...(modalElement ? { mount: modalElement } : {})}
                  />
                </ItemActions>
              </Item>
            </ItemGroup>
          </SettingsSection>
          <SettingsSection title={t("settings.analytics.title")}>
            <ItemGroup class="settings-modal-card">
              <SwitchField
                checked={reportsEnabled()}
                onChange={(value) => {
                  setReportsEnabled(setWebAnalyticsEnabled(value));
                  // A failed save stays marked, and the next session check sends it again.
                  props.calls.updateAnalytics(value).catch(() => undefined);
                }}
                label={t("settings.analytics.title")}
                description={t("settings.analytics.webDescription")}
              />
            </ItemGroup>
          </SettingsSection>
          <SettingsSection
            title={
              <NotificationScopeTitle
                title={t("settings.notifications.whatYouHear")}
                scope="settings.notifications.allDevices"
              />
            }
          >
            <NotificationMatrix
              servers={props.notifications.matrixServers()}
              device="browser"
              onSetServerLevel={props.notifications.setServerLevel}
              onSetAgentLevel={props.notifications.setAgentLevel}
              onTurnOnAgent={props.notifications.turnOnAgent}
              onMute={props.notifications.mute}
              onUnmute={props.notifications.unmute}
              onRetry={props.notifications.retry}
              focusRequest={props.open ? props.notificationFocusRequest : null}
              menuMount={modalElement}
            />
          </SettingsSection>
          <SettingsSection title={t("settings.notifications.thisBrowser")}>
            <ItemGroup class="settings-modal-card">
              <SwitchField
                checked={completionSound()}
                onChange={(checked) => {
                  setCompletionSound(checked);
                  setCompletionSoundEnabled(checked);
                }}
                label={t("settings.taskSound.title")}
                description={t("settings.taskSound.description")}
              />
              <Item class="settings-modal-row settings-sound-theme-row">
                <ItemContent>
                  <ItemTitle>{t("settings.soundFeedback.title")}</ItemTitle>
                  <ItemDescription>{t("settings.soundFeedback.description")}</ItemDescription>
                </ItemContent>
                <SoundThemePicker
                  value={soundChoice()}
                  onChange={(value) => {
                    setSoundChoice(value);
                    setActionSoundChoice(value);
                  }}
                  onReplay={replayActionSoundChoice}
                />
              </Item>
            </ItemGroup>
          </SettingsSection>
        </Tabs.Content>
      </SettingsDialogShell>
    </Tabs.Root>
  );
}
