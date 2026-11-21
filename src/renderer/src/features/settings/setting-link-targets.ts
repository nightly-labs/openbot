import type { AppInfo, SettingLinkId } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import type { AgentSettingLinkId } from "@openbot/ui/features/conversation/agent-setting-links";
import { type SettingsTab, settingsTabShown } from "./settings-tabs";

export type AppSettingLinkId = Exclude<SettingLinkId, AgentSettingLinkId>;

export interface AppSettingLinkTarget {
  tab: SettingsTab;
  row: AppTextKey;
}

const TARGETS: Record<Exclude<AppSettingLinkId, "island.show">, AppSettingLinkTarget> = {
  "general.send-shortcut": { tab: "general", row: "settings.sendShortcut.title" },
  "general.sort-chats": { tab: "general", row: "sidebar.order.title" },
  "general.agent-steps": { tab: "general", row: "settings.showAgentSteps.title" },
  "general.compact-message-actions": { tab: "general", row: "settings.compactMessageActions.title" },
  "general.external-links": { tab: "general", row: "settings.externalLinks.title" },
  "appearance.theme": { tab: "appearance", row: "settings.appearance.theme.title" },
  "appearance.language": { tab: "appearance", row: "settings.language.title" },
  "appearance.interface-size": { tab: "appearance", row: "settings.interfaceSize.title" },
  "appearance.interface-font": { tab: "appearance", row: "settings.interfaceFont.title" },
  "appearance.code-font": { tab: "appearance", row: "settings.codeFont.title" },
  "appearance.chat-color": { tab: "appearance", row: "settings.chatColor.title" },
  "appearance.bubble-style": { tab: "appearance", row: "settings.bubbleStyle.title" },
  "appearance.chat-background": { tab: "appearance", row: "settings.chatBackground.title" },
  "appearance.logo-color": { tab: "appearance", row: "settings.logoColor.title" },
  "notifications.desktop": { tab: "notifications", row: "settings.desktopNotifications.title" },
  "notifications.preview": { tab: "notifications", row: "settings.notificationPreview.title" },
  "notifications.task-sound": { tab: "notifications", row: "settings.taskSound.title" },
  "notifications.action-sounds": { tab: "notifications", row: "settings.soundFeedback.title" },
  "voice.dictation": { tab: "voice", row: "settings.voice.dictation.section" },
  "voice.dictation-language": { tab: "voice", row: "settings.voice.language.section" },
  "voice.read-replies": { tab: "voice", row: "settings.voice.speech.readReplies.title" },
  "voice.speech-voice": { tab: "voice", row: "settings.voice.speech.voice.title" },
  "voice.speech-speed": { tab: "voice", row: "settings.voice.speech.speed.title" },
  "voice.codex-live": { tab: "voice", row: "settings.voice.speech.codexLive.title" },
  "voice.server": { tab: "voice", row: "settings.voice.server.section" },
  "phones.devices": { tab: "mobile-connect", row: "settings.mobileConnect.phones.title" },
  "app.launch-at-login": { tab: "app-behavior", row: "settings.launchAtLogin.title" },
  "app.restore-workspace": { tab: "app-behavior", row: "settings.restoreWorkspace.title" },
  "app.fast-server-connection": { tab: "app-behavior", row: "settings.keepRemoteSessions.title" },
  "app.keep-awake": { tab: "app-behavior", row: "settings.keepAwake.title" },
  "app.keep-awake-on-battery": { tab: "app-behavior", row: "settings.keepAwakeOnBattery.title" },
  "dock.show": { tab: "agent-dock", row: "settings.agentDock.show.title" },
  "dock.agents": { tab: "agent-dock", row: "settings.agentDock.agents.title" },
  "updates.track": { tab: "updates", row: "settings.updates.track.title" },
  "updates.auto-install": { tab: "updates", row: "settings.updates.autoInstall.title" },
};

export function appSettingLinkTarget(
  settingId: AppSettingLinkId,
  platform: AppInfo["platform"] | undefined,
): AppSettingLinkTarget {
  if (settingId !== "island.show") return TARGETS[settingId];
  return {
    tab: "dynamic-island",
    row: platform === "darwin" ? "settings.notch.show.title" : "settings.notch.show.titleTopOfScreen",
  };
}

export function appSettingRowOpener(
  window: () => { platform: AppInfo["platform"] | undefined; chatWindow: boolean },
  openRow: (tab: SettingsTab, row: AppTextKey) => void,
): (settingId: AppSettingLinkId) => (() => void) | undefined {
  return (settingId) => {
    const current = window();
    const target = appSettingLinkTarget(settingId, current.platform);
    return settingsTabShown(target.tab, current) ? () => openRow(target.tab, target.row) : undefined;
  };
}
