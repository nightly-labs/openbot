import type { ConversationMessage } from "./ipc-conversation-messages";

export const SETTING_LINK_ITEM_TYPE_PREFIX = "setting-link:";

export const SETTING_LINK_SCOPES = {
  "general.send-shortcut": "app",
  "general.sort-chats": "app",
  "general.agent-steps": "app",
  "general.compact-message-actions": "app",
  "general.external-links": "app",
  "appearance.theme": "app",
  "appearance.language": "app",
  "appearance.interface-size": "app",
  "appearance.interface-font": "app",
  "appearance.code-font": "app",
  "appearance.chat-color": "app",
  "appearance.bubble-style": "app",
  "appearance.chat-background": "app",
  "appearance.logo-color": "app",
  "notifications.desktop": "app",
  "notifications.preview": "app",
  "notifications.task-sound": "app",
  "notifications.action-sounds": "app",
  "voice.dictation": "app",
  "voice.dictation-language": "app",
  "voice.read-replies": "app",
  "voice.speech-voice": "app",
  "voice.speech-speed": "app",
  "phones.devices": "app",
  "app.launch-at-login": "app",
  "app.restore-workspace": "app",
  "app.fast-server-connection": "app",
  "app.keep-awake": "app",
  "app.keep-awake-on-battery": "app",
  "island.show": "app",
  "dock.show": "app",
  "dock.agents": "app",
  "updates.track": "app",
  "updates.auto-install": "app",
  "agent.model": "agent",
  "agent.backup-models": "agent",
  "agent.chat-color": "agent",
  "agent.instructions": "agent",
  "agent.memories": "agent",
  "agent.skills": "agent",
  "agent.routines": "agent",
  "agent.notification-level": "agent",
  "agent.access": "agent",
  "agent.computer-use": "agent",
  "agent.local-scripts": "agent",
  "agent.folders": "agent",
  "agent.busy-message": "agent",
  "agent.browser-profile": "agent",
  "agent.new-chat": "agent",
  "agent.starts-new-chats": "agent",
  "agent.plan-card": "agent",
} as const satisfies Record<string, "app" | "agent">;

export type SettingLinkId = keyof typeof SETTING_LINK_SCOPES;
export type SettingLinkScope = (typeof SETTING_LINK_SCOPES)[SettingLinkId];

export const SETTING_LINK_IDS: readonly SettingLinkId[] = Object.keys(SETTING_LINK_SCOPES).filter(isSettingLinkId);

export function isSettingLinkId(value: string): value is SettingLinkId {
  return Object.hasOwn(SETTING_LINK_SCOPES, value);
}

export function settingLinkItemType(id: SettingLinkId): string {
  return `${SETTING_LINK_ITEM_TYPE_PREFIX}${id}`;
}

export function settingLinkEvent(message: ConversationMessage): { settingId: SettingLinkId } | null {
  if (message.author !== "system" || message.source !== "system" || message.status !== "completed") return null;
  if (!message.itemType?.startsWith(SETTING_LINK_ITEM_TYPE_PREFIX)) return null;
  const settingId = message.itemType.slice(SETTING_LINK_ITEM_TYPE_PREFIX.length);
  return isSettingLinkId(settingId) ? { settingId } : null;
}
