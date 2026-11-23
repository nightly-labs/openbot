import type { ClientAgentSummary } from "@openbot/contracts/ipc";
import { markdownPreviewText } from "@openbot/contracts/markdown-preview-text";
import { cleanAgentMessageText } from "@openbot/team-client/agent-message-text";
import type { AgentProfile } from "../../data";
import { currentText } from "../../text";

/** The profile that the agent screens read, from the summary that the host sends. */
export function toAgentProfile(stored: ClientAgentSummary): AgentProfile {
  return {
    id: stored.id,
    name: stored.name,
    title: stored.title,
    description: stored.description,
    notifications: stored.notifications,
    provider: stored.provider,
    model: stored.model,
    reasoningEffort: stored.reasoningEffort,
    ...(stored.providerAccountId === undefined ? {} : { providerAccountId: stored.providerAccountId }),
    ...(stored.access === undefined ? {} : { access: stored.access }),
    ...(stored.computerUse === undefined ? {} : { computerUse: stored.computerUse }),
    ...(stored.allowAutomation === undefined ? {} : { allowAutomation: stored.allowAutomation }),
    ...(stored.allowNewChat === undefined ? {} : { allowNewChat: stored.allowNewChat }),
    ...(stored.quickAcknowledgement === undefined ? {} : { quickAcknowledgement: stored.quickAcknowledgement }),
    ...(stored.fastMode === undefined ? {} : { fastMode: stored.fastMode }),
    ...(stored.ultrafast === undefined ? {} : { ultrafast: stored.ultrafast }),
    ...(stored.ownBrowserSession === undefined ? {} : { ownBrowserSession: stored.ownBrowserSession }),
    ...(stored.browserProfileId === undefined ? {} : { browserProfileId: stored.browserProfileId }),
    ...(stored.busyMessageMode === undefined ? {} : { busyMessageMode: stored.busyMessageMode }),
    ...(stored.taskLimit === undefined ? {} : { taskLimit: stored.taskLimit }),
    ...(stored.backupModels === undefined ? {} : { backupModels: stored.backupModels }),
    ...(stored.additionalFolders === undefined ? {} : { additionalFolders: stored.additionalFolders }),
    ...(stored.excludedFolders === undefined ? {} : { excludedFolders: stored.excludedFolders }),
    ...(stored.usageLimitReturn === undefined ? {} : { usageLimitReturn: stored.usageLimitReturn }),
    ...(stored.pendingRuntime === undefined ? {} : { pendingRuntime: stored.pendingRuntime }),
    threadId: stored.threadId,
    workspacePath: stored.workspacePath,
    avatarSeed: stored.avatarSeed,
    avatarHue: stored.avatarHue,
    ...(stored.avatarColor == null ? {} : { avatarColor: stored.avatarColor }),
    ...(stored.chatColor === undefined ? {} : { chatColor: stored.chatColor }),
    avatarUrl: stored.avatarUrl,
    ...(stored.marketplaceSource === undefined ? {} : { marketplaceSource: stored.marketplaceSource }),
    updatedAt: stored.updatedAt,
    time: stored.updatedAt ? formatTime(stored.updatedAt) : currentText().t("chat.day.now"),
    preview: cleanPreview(stored.preview),
  };
}

function cleanPreview(preview: string): string {
  // The stored preview is the start of the message as written, Markdown and all.
  const cleaned = markdownPreviewText(cleanAgentMessageText(preview))
    .replace(/\binbox\s+at\s+zero\b[:,]?\s*/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return cleaned || currentText().t("app.agent.noMessages");
}

function formatTime(value: string): string {
  const date = new Date(value);
  const { t, format } = currentText();
  if (Number.isNaN(date.getTime())) return t("chat.day.now");
  return format.date(date, { hour: "2-digit", minute: "2-digit" });
}
