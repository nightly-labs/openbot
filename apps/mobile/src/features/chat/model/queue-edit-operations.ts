import type { MobileAgent, MobileWorkspaceContextValue } from "../../workspace/model/workspace-types";
import type { QueueMessage } from "../components/chat-queue";

export interface PreparedQueueEdit {
  body: string;
  attachments: QueueMessage["attachments"];
  mode: "taken" | "queued";
}

type QueueEditWorkspace = Pick<
  MobileWorkspaceContextValue,
  "canTakeQueuedMessage" | "takeQueuedMessage" | "updateQueuedMessage" | "sendMessage" | "discardAttachment"
>;
type Scope = Pick<MobileAgent, "id" | "serverId">;
export interface QueueEditTarget {
  message: QueueMessage;
  mode: PreparedQueueEdit["mode"];
}

export async function prepareQueueEdit(
  workspace: QueueEditWorkspace,
  agent: Scope,
  message: QueueMessage,
): Promise<PreparedQueueEdit> {
  if (!message.delivery) throw new Error("This message is not queued.");
  if (!workspace.canTakeQueuedMessage(agent.serverId)) {
    return { body: message.body, attachments: message.attachments, mode: "queued" };
  }
  const draft = await workspace.takeQueuedMessage(
    { agentId: agent.id, deliveryId: message.delivery.id },
    agent.serverId,
  );
  return { body: draft.text, attachments: draft.attachments, mode: "taken" };
}

export async function saveQueueEdit(
  workspace: QueueEditWorkspace,
  agent: Scope,
  edit: QueueEditTarget,
  text: string,
  uploaded: string[],
) {
  const retained = edit.message.attachments?.map((file) => file.id) ?? [];
  if (edit.mode === "queued") {
    if (!edit.message.delivery) throw new Error("This message is not queued.");
    await workspace.updateQueuedMessage(
      {
        agentId: agent.id,
        deliveryId: edit.message.delivery.id,
        text,
        keepAttachmentIds: retained,
        attachmentDraftIds: uploaded,
      },
      agent.serverId,
    );
  } else {
    await workspace.sendMessage(agent.id, text, [...retained, ...uploaded], edit.message.replyToMessageId);
  }
}

export async function discardQueueEdit(workspace: QueueEditWorkspace, agent: Scope, edit: QueueEditTarget) {
  if (edit.mode === "taken") {
    await Promise.allSettled(
      (edit.message.attachments ?? []).map((file) => workspace.discardAttachment(agent.id, file.id)),
    );
  }
}
