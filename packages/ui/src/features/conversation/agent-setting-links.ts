import type { SettingLinkId } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";

export type AgentSettingsPage = "permissions" | "folders" | "backup-models" | "advanced";

export const AGENT_SETTINGS_PAGE_TITLE: Record<AgentSettingsPage, AppTextKey> = {
  permissions: "agentSettings.permissions.title",
  folders: "agentSettings.folders.title",
  "backup-models": "agentSettings.backupModels.title",
  advanced: "agentSettings.advanced.title",
};

export type AgentSettingLinkId = Extract<SettingLinkId, `agent.${string}`>;

export interface AgentSettingLinkRow {
  title: AppTextKey;
  page: AgentSettingsPage | null;
  match: AppTextKey | null;
}

export const AGENT_SETTING_LINK_ROWS: Record<AgentSettingLinkId, AgentSettingLinkRow> = {
  "agent.model": { title: "agentSettings.runtime.model", page: null, match: "agentSettings.groups.brain" },
  "agent.backup-models": {
    title: "agentSettings.backupModels.title",
    page: null,
    match: "agentSettings.backupModels.title",
  },
  "agent.chat-color": { title: "settings.chatColor.title", page: null, match: "settings.chatColor.title" },
  "agent.instructions": { title: "agentSettings.instructions", page: null, match: "agentSettings.instructions" },
  "agent.memories": { title: "agentSettings.links.memories", page: null, match: "agentSettings.links.memories" },
  "agent.skills": { title: "agentSettings.links.skills", page: null, match: "agentSettings.links.skills" },
  "agent.routines": { title: "agentSettings.links.routines", page: null, match: "agentSettings.links.routines" },
  "agent.notification-level": {
    title: "agentSettings.notificationLevel.title",
    page: null,
    match: "agentSettings.notificationLevel.title",
  },
  "agent.access": { title: "agentSettings.runtime.access", page: "permissions", match: "agentSettings.runtime.access" },
  "agent.computer-use": {
    title: "agentSettings.computerUse.title",
    page: "permissions",
    match: "agentSettings.computerUse.title",
  },
  "agent.local-scripts": {
    title: "agentSettings.automation.title",
    page: "permissions",
    match: "agentSettings.automation.title",
  },
  "agent.folders": { title: "agentSettings.folders.title", page: "folders", match: null },
  "agent.busy-message": {
    title: "agentSettings.runtime.busyMessage",
    page: "advanced",
    match: "agentSettings.runtime.busyMessage",
  },
  "agent.browser-profile": {
    title: "agentSettings.browserProfile.label",
    page: "advanced",
    match: "agentSettings.browserProfile.label",
  },
  "agent.new-chat": { title: "agentSettings.newChat.title", page: "advanced", match: "agentSettings.newChat.title" },
  "agent.starts-new-chats": {
    title: "agentSettings.agentNewChat.title",
    page: "advanced",
    match: "agentSettings.agentNewChat.title",
  },
  "agent.plan-card": {
    title: "agentSettings.quickAcknowledgement.title",
    page: "advanced",
    match: "agentSettings.quickAcknowledgement.title",
  },
  "agent.builtin-memory": {
    title: "agentSettings.builtinMemory.title",
    page: "advanced",
    match: "agentSettings.builtinMemory.title",
  },
};

export function isAgentSettingLinkId(id: SettingLinkId): id is AgentSettingLinkId {
  return id.startsWith("agent.");
}

export interface AgentSettingReveal {
  settingId: AgentSettingLinkId;
  nonce: number;
}

const LABELS = ".settings-link-text, .settings-link-section-title, .agent-settings-runtime-label, strong";
const ROWS = ".settings-link, .agent-settings-notifications, .agent-settings-runtime-row, .settings-link-section";

export function revealSettingRow(root: HTMLElement, label: string): boolean {
  for (const marked of root.querySelectorAll("[data-search-match]")) marked.removeAttribute("data-search-match");
  const found = [...root.querySelectorAll<HTMLElement>(LABELS)].find(
    (element) => element.textContent?.trim() === label,
  );
  const row = found?.closest<HTMLElement>(ROWS);
  if (!row) return false;
  const target = row.matches(".settings-link-section")
    ? (row.querySelector<HTMLElement>(".settings-link-group") ?? row)
    : row;
  target.setAttribute("data-search-match", "");
  target.scrollIntoView({ block: "center" });
  const control = target.matches("button")
    ? target
    : // A switch is an input, so `input` also finds it.
      target.querySelector<HTMLElement>("button:not(:disabled), input, select");
  control?.focus({ preventScroll: true });
  return true;
}

export function waitForSettingRow(root: HTMLElement, done: () => boolean): () => void {
  const stop = () => {
    observer.disconnect();
    root.removeEventListener("pointerdown", stop, true);
    root.removeEventListener("keydown", stop, true);
  };
  const observer = new MutationObserver(() => {
    if (done()) stop();
  });
  observer.observe(root, { childList: true, subtree: true });
  root.addEventListener("pointerdown", stop, true);
  root.addEventListener("keydown", stop, true);
  return stop;
}
