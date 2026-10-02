import type { AppLanguage } from "@openbot/contracts/app-language";
import type { CentralAuthUser } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import {
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
import { LanguageSelect } from "@openbot/ui/features/settings/LanguageSelect";
import { ProfileNameSaveBar } from "@openbot/ui/features/settings/ProfileNameSaveBar";
import { SettingsDialogShell } from "@openbot/ui/features/settings/SettingsDialogShell";
import { SettingsProfileTab } from "@openbot/ui/features/settings/SettingsProfileTab";
import { SoundThemePicker } from "@openbot/ui/features/settings/SoundThemePicker";
import { createSettingsProfileStore } from "@openbot/ui/features/settings/stores/profile-store";
import { useText } from "@openbot/ui/text";
import { createSignal, onCleanup } from "solid-js";
import { readActionSoundChoice, replayActionSoundChoice, setActionSoundChoice } from "../../action-sounds";
import { isCompletionSoundEnabled, setCompletionSoundEnabled } from "../../completion-sound";
import type { WebAccountCalls } from "./web-account";

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
  account: CentralAuthUser;
  calls: WebAccountCalls;
  language: AppLanguage;
  onChangeLanguage: (language: AppLanguage) => void;
}

/**
 * The account's own settings in the web client, where Settings opens the settings of a host. Profile
 * is the desktop tab and store; Preferences holds what this browser keeps. Sites are in the settings
 * of their server.
 */
export default function WebAccountSettings(props: WebAccountSettingsProps) {
  const { t } = useText();
  const [activeTab, setActiveTab] = createSignal<WebAccountSettingsTab>("profile");
  const [completionSound, setCompletionSound] = createSignal(isCompletionSoundEnabled());
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
        onOpenChange={props.onOpenChange}
        title={t(navItem().titleKey)}
        description={t(navItem().descriptionKey)}
        contentKey={activeTab()}
        onContentElement={(element) => (modalElement = element)}
        footer={<ProfileNameSaveBar store={profile} />}
        sidebar={
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
        }
      >
        <Tabs.Content value="profile" class="settings-modal-tab-panel" data-tab="profile">
          <SettingsProfileTab store={profile} account={props.account} canListSessions canRevokeSession />
        </Tabs.Content>

        <Tabs.Content value="preferences" class="settings-modal-tab-panel" data-tab="preferences">
          <SettingsSection title={t("settings.appBehavior.title")}>
            <ItemGroup class="settings-modal-card">
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
            </ItemGroup>
          </SettingsSection>
          <SettingsSection title={t("settings.notifications.title")}>
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
