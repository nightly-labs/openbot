import type { AppLanguage } from "@openbot/contracts/app-language";
import type { CentralAuthUser } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import {
  Globe2,
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
import { SettingsHostedSitesTab } from "@openbot/ui/features/settings/SettingsHostedSitesTab";
import { SettingsProfileTab } from "@openbot/ui/features/settings/SettingsProfileTab";
import { createSettingsHostedSitesStore } from "@openbot/ui/features/settings/stores/hosted-sites-store";
import { createSettingsProfileStore } from "@openbot/ui/features/settings/stores/profile-store";
import { useText } from "@openbot/ui/text";
import { createSignal } from "solid-js";
import { isCompletionSoundEnabled, setCompletionSoundEnabled } from "../../completion-sound";
import type { WebAccountCalls } from "./web-account";
import { openWebLink } from "./web-attachments";

const TABS = ["profile", "preferences", "hosted-sites"] as const;
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
  "hosted-sites": {
    titleKey: "settings.tab.hostedSites.title",
    descriptionKey: "settings.tab.hostedSites.description",
    icon: Globe2,
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
 * and Hosted sites are the desktop tabs and stores; Preferences holds what this browser keeps.
 */
export default function WebAccountSettings(props: WebAccountSettingsProps) {
  const { t } = useText();
  const [activeTab, setActiveTab] = createSignal<WebAccountSettingsTab>("profile");
  const [completionSound, setCompletionSound] = createSignal(isCompletionSoundEnabled());
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
  const hostedSites = createSettingsHostedSitesStore(
    {
      get open() {
        return props.open;
      },
      hostedSitesApi: props.calls.hostedSites,
    },
    () => activeTab() === "hosted-sites",
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
                  <LanguageSelect value={props.language} onChange={props.onChangeLanguage} mount={modalElement} />
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
            </ItemGroup>
          </SettingsSection>
        </Tabs.Content>

        <Tabs.Content value="hosted-sites" class="settings-modal-tab-panel" data-tab="hosted-sites">
          <SettingsHostedSitesTab store={hostedSites} available onOpenSite={(url) => void openWebLink(url)} />
        </Tabs.Content>
      </SettingsDialogShell>
    </Tabs.Root>
  );
}
