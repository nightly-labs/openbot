import { X_AGENT_LISTING_ID, type XReplyPayload } from "@openbot/contracts/browser-extension-x";
import { type ClientAgentSummary, isQueuedMessageReceipt } from "@openbot/contracts/ipc";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { AGENT_TASKS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-tasks-v1";
import { runTeamEffect } from "@openbot/team-client";
import { startAgentTask, type TeamApiRequest } from "@openbot/team-client/team-api-requests";
import { currentText } from "@openbot/ui/text";
import { saveXChat } from "./extension-storage";
import { decodeAgents } from "./workspace";
import type { XLabels, XSendResult, XStatusAnswer } from "./x-messages";
import { xPostMessage } from "./x-post-message";

export interface XTarget {
  hostId: string;
  request: TeamApiRequest;
  capabilities: readonly string[];
  syncedAgents?: () => readonly ClientAgentSummary[] | null;
}

async function xAgentId(target: XTarget): Promise<string | null> {
  const agents = target.syncedAgents?.() ?? (await target.request("GET", TEAM_API_ROUTES.agents.all, decodeAgents));
  return agents.find((agent) => agent.marketplaceSource?.listingId === X_AGENT_LISTING_ID)?.id ?? null;
}

function labels(): XLabels {
  const { t } = currentText();
  return {
    armed: t("extension.x.armed"),
    sentTitle: t("extension.x.sentTitle"),
    sentBody: t("extension.x.sentBody"),
    droppedTitle: t("extension.x.droppedTitle"),
    droppedBody: t("extension.x.droppedBody"),
  };
}

export async function xStatus(target: XTarget): Promise<XStatusAnswer> {
  try {
    return (await xAgentId(target)) ? { ready: true, labels: labels() } : { ready: false, reason: "no-x-agent" };
  } catch (error) {
    const detail = error instanceof Error ? error.message.slice(0, 160) : "";
    return { ready: false, reason: detail ? `server-failed (${detail})` : "server-failed" };
  }
}

export async function xSend(target: XTarget, payload: XReplyPayload, clientMessageId: string): Promise<XSendResult> {
  const { t } = currentText();
  let sending = false;
  try {
    const agentId = await xAgentId(target);
    if (!agentId) return { ok: false, error: t("extension.x.noAgent"), reached: false };
    const text = xPostMessage(payload);
    let taskId: string | null = null;
    sending = true;
    if (target.capabilities.includes(AGENT_TASKS_CAPABILITY)) {
      taskId = (await runTeamEffect(startAgentTask(target.request, { agentId, text, clientMessageId }))).id;
    } else {
      await target.request(
        "POST",
        TEAM_API_ROUTES.agent.messages(agentId),
        (value) => {
          if (!isQueuedMessageReceipt(value)) throw new Error(t("extension.chat.sendFailed"));
          return value;
        },
        {
          text,
          attachmentDraftIds: [],
          replyToMessageId: null,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          clientMessageId,
        },
      );
    }
    await saveXChat(clientMessageId, { hostId: target.hostId, agentId, taskId });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error && error.message ? error.message : t("extension.chat.sendFailed"),
      reached: sending,
    };
  }
}
