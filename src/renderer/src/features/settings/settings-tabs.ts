import type { AppInfo } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import {
  Bell,
  Bot,
  CircleArrowDown,
  CreditCard,
  Mic,
  MousePointer2,
  PanelRight,
  PanelTop,
  Server,
  Settings,
  Smartphone,
  UserRound,
} from "@openbot/ui";

export type SettingsTab =
  | "general"
  | "agents"
  | "notifications"
  | "voice"
  | "dynamic-island"
  | "agent-dock"
  | "computer-use"
  | "profile"
  | "billing"
  | "mobile-connect"
  | "updates"
  | "hosted-servers";

/**
 * A row of a tab that the settings search finds. The title key is also the anchor of the row: the
 * row markup sets `data-settings-row` to this key, so a search result can move to the row.
 */
type SettingsRow = {
  titleKey: AppTextKey;
  descriptionKey?: AppTextKey;
  /** True: the row shows only on macOS. False: never on macOS. Missing: on each platform. */
  macOS?: boolean;
};

/** False for a row that this platform does not show, so the search does not find it. */
export function settingsRowShown(row: { macOS?: boolean }, platform: AppInfo["platform"] | undefined): boolean {
  return row.macOS === undefined || row.macOS === (platform === "darwin");
}

/**
 * A tab holds the keys of its label and its header text, not the text itself. The list is read at
 * module level, before any component exists to translate it, and a label captured there would keep
 * the language the app started in. `rows` lists the rows of the tab in page order, for the search.
 */
type SettingsNavItem = {
  value: SettingsTab;
  titleKey: AppTextKey;
  descriptionKey: AppTextKey;
  icon: typeof Settings;
  rows: ReadonlyArray<SettingsRow>;
};

export const navItems: ReadonlyArray<SettingsNavItem> = [
  {
    value: "general",
    titleKey: "settings.tab.general.title",
    descriptionKey: "settings.tab.general.description",
    icon: Settings,
    rows: [
      { titleKey: "settings.language.title", descriptionKey: "settings.language.description" },
      { titleKey: "settings.interfaceSize.title", descriptionKey: "settings.interfaceSize.description" },
      { titleKey: "settings.interfaceFont.title", descriptionKey: "settings.interfaceFont.description" },
      { titleKey: "settings.codeFont.title", descriptionKey: "settings.codeFont.description" },
      { titleKey: "settings.logoColor.title", descriptionKey: "settings.logoColor.description" },
      { titleKey: "settings.chatColor.title", descriptionKey: "settings.chatColor.description" },
      { titleKey: "settings.chatBackground.title", descriptionKey: "settings.chatBackground.description" },
      { titleKey: "settings.sendShortcut.title", descriptionKey: "settings.sendShortcut.description" },
      { titleKey: "settings.showAgentSteps.title", descriptionKey: "settings.showAgentSteps.description" },
      {
        titleKey: "settings.compactMessageActions.title",
        descriptionKey: "settings.compactMessageActions.description",
      },
      { titleKey: "settings.externalLinks.title", descriptionKey: "settings.externalLinks.description" },
      { titleKey: "settings.launchAtLogin.title", descriptionKey: "settings.launchAtLogin.description" },
      { titleKey: "settings.keepRemoteSessions.title", descriptionKey: "settings.keepRemoteSessions.description" },
      { titleKey: "settings.keepRunning.title", descriptionKey: "settings.keepRunning.description", macOS: false },
      { titleKey: "settings.menuBar.title", descriptionKey: "settings.menuBar.description", macOS: true },
      { titleKey: "settings.keepAwake.title", descriptionKey: "settings.keepAwake.description" },
      { titleKey: "settings.keepAwakeOnBattery.title", descriptionKey: "settings.keepAwakeOnBattery.description" },
      { titleKey: "settings.restoreWorkspace.title", descriptionKey: "settings.restoreWorkspace.description" },
      { titleKey: "settings.quitGuard.title", descriptionKey: "settings.quitGuard.description", macOS: true },
      { titleKey: "settings.analytics.title", descriptionKey: "settings.analytics.description" },
    ],
  },
  {
    value: "agents",
    titleKey: "settings.tab.agents.title",
    descriptionKey: "settings.tab.agents.description",
    icon: Bot,
    rows: [
      { titleKey: "agentSettings.automation.title" },
      { titleKey: "agentSettings.agentNewChat.title" },
      { titleKey: "agentSettings.quickAcknowledgement.title" },
      { titleKey: "settings.busyMessage.title", descriptionKey: "settings.busyMessage.description" },
      { titleKey: "settings.backgroundProcesses.title", descriptionKey: "settings.backgroundProcesses.description" },
    ],
  },
  {
    value: "profile",
    titleKey: "settings.tab.profile.title",
    descriptionKey: "settings.tab.profile.description",
    icon: UserRound,
    rows: [
      { titleKey: "settings.profile.email.title", descriptionKey: "settings.profile.email.description" },
      { titleKey: "settings.profile.sessions.title", descriptionKey: "settings.profile.sessions.description" },
    ],
  },
  {
    value: "notifications",
    titleKey: "settings.tab.notifications.title",
    descriptionKey: "settings.tab.notifications.description",
    icon: Bell,
    rows: [
      { titleKey: "settings.notifications.whatYouHear" },
      { titleKey: "settings.desktopNotifications.title", descriptionKey: "settings.desktopNotifications.description" },
      { titleKey: "settings.notificationPreview.title", descriptionKey: "settings.notificationPreview.description" },
      { titleKey: "settings.testNotification.title", descriptionKey: "settings.testNotification.description" },
      { titleKey: "settings.taskSound.title", descriptionKey: "settings.taskSound.description" },
      { titleKey: "settings.soundFeedback.title", descriptionKey: "settings.soundFeedback.description" },
    ],
  },
  {
    value: "voice",
    titleKey: "settings.tab.voice.title",
    descriptionKey: "settings.tab.voice.description",
    icon: Mic,
    rows: [
      { titleKey: "settings.voice.dictation.section" },
      { titleKey: "settings.voice.language.section", descriptionKey: "settings.voice.language.description" },
      {
        titleKey: "settings.voice.speech.readReplies.title",
        descriptionKey: "settings.voice.speech.readReplies.description",
      },
      { titleKey: "settings.voice.speech.voice.title" },
      { titleKey: "settings.voice.speech.speed.title" },
      {
        titleKey: "settings.voice.speech.codexLive.title",
        descriptionKey: "settings.voice.speech.codexLive.description",
      },
    ],
  },
  {
    value: "dynamic-island",
    titleKey: "settings.tab.dynamicIsland.title",
    descriptionKey: "settings.tab.dynamicIsland.description",
    icon: PanelTop,
    rows: [
      { titleKey: "settings.notch.show.title", descriptionKey: "settings.notch.show.description", macOS: true },
      {
        titleKey: "settings.notch.show.titleTopOfScreen",
        descriptionKey: "settings.notch.show.description",
        macOS: false,
      },
      { titleKey: "settings.notch.idle.title", descriptionKey: "settings.notch.idle.description" },
      { titleKey: "settings.notch.displays.title", descriptionKey: "settings.notch.displays.description" },
      { titleKey: "settings.notch.haptics.title", descriptionKey: "settings.notch.haptics.description", macOS: true },
      { titleKey: "settings.notch.servers.title", descriptionKey: "settings.notch.servers.description" },
      { titleKey: "settings.notch.size.title", descriptionKey: "settings.notch.size.description" },
    ],
  },
  {
    value: "agent-dock",
    titleKey: "settings.tab.agentDock.title",
    descriptionKey: "settings.tab.agentDock.description",
    icon: PanelRight,
    rows: [
      { titleKey: "settings.agentDock.show.title", descriptionKey: "settings.agentDock.show.description" },
      { titleKey: "settings.agentDock.placement.title", descriptionKey: "settings.agentDock.placement.description" },
      { titleKey: "settings.agentDock.display.title", descriptionKey: "settings.agentDock.display.description" },
      { titleKey: "settings.agentDock.agents.title" },
    ],
  },
  {
    value: "computer-use",
    titleKey: "settings.tab.computerUse.title",
    descriptionKey: "settings.tab.computerUse.description",
    icon: MousePointer2,
    rows: [{ titleKey: "computerUse.permissions.title", descriptionKey: "computerUse.permissions.description" }],
  },
  {
    value: "billing",
    titleKey: "settings.tab.billing.title",
    descriptionKey: "settings.tab.billing.description",
    icon: CreditCard,
    rows: [],
  },
  {
    value: "mobile-connect",
    titleKey: "settings.tab.mobileConnect.title",
    descriptionKey: "settings.tab.mobileConnect.description",
    icon: Smartphone,
    rows: [
      {
        titleKey: "settings.mobileConnect.phones.title",
        descriptionKey: "settings.mobileConnect.phones.description",
      },
      { titleKey: "settings.mobileConnect.phones.add", descriptionKey: "settings.mobileConnect.add.question" },
      { titleKey: "settings.mobileConnect.link.title", descriptionKey: "settings.mobileConnect.link.cardHint" },
      {
        titleKey: "settings.mobileConnect.route.title",
        descriptionKey: "settings.mobileConnect.route.description",
      },
    ],
  },
  {
    value: "updates",
    titleKey: "settings.tab.updates.title",
    descriptionKey: "settings.tab.updates.description",
    icon: CircleArrowDown,
    rows: [
      { titleKey: "settings.updates.track.title", descriptionKey: "settings.updates.track.description" },
      { titleKey: "settings.updates.idleRestart.title" },
      { titleKey: "settings.updates.autoDownload.title", descriptionKey: "settings.updates.autoDownload.description" },
      { titleKey: "settings.updates.autoInstall.title", descriptionKey: "settings.updates.autoInstall.description" },
      { titleKey: "settings.updates.allowRemote.title", descriptionKey: "settings.updates.allowRemote.description" },
      { titleKey: "settings.updates.managed.title", descriptionKey: "settings.updates.managed.description" },
    ],
  },
  {
    value: "hosted-servers",
    titleKey: "settings.tab.hostedServers.title",
    descriptionKey: "settings.tab.hostedServers.description",
    icon: Server,
    rows: [],
  },
];

export function navItem(tab: SettingsTab): SettingsNavItem {
  const found = navItems.find((item) => item.value === tab);
  if (!found) throw new Error(`Unknown settings tab: ${tab}`);
  return found;
}

/**
 * Whether the settings panel and its search show the tab. Hosted servers opens from its own entry, not
 * from this panel. The Dynamic Island and the agent dock are macOS, Windows and Linux features of the main window.
 */
export function settingsTabShown(
  tab: SettingsTab,
  window: { platform: AppInfo["platform"] | undefined; chatWindow: boolean },
): boolean {
  if (tab === "hosted-servers") return false;
  if (tab === "dynamic-island") return dynamicIslandSettingsShown(window.platform, window.chatWindow);
  if (tab === "agent-dock") return window.platform !== undefined && !window.chatWindow;
  return true;
}

/**
 * The Dynamic Island exists on macOS, Windows and Linux, and only the main window owns it: main rejects
 * its calls from a chat window.
 */
export function dynamicIslandSettingsShown(platform: AppInfo["platform"] | undefined, chatWindow: boolean): boolean {
  return platform !== undefined && !chatWindow;
}
