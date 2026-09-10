import type { QueueEditState } from "@openbot/contracts/ipc";
import { QueueEditSession } from "@openbot/team-client/queue-edit-session";
import type { MobileAgent, MobileWorkspaceContextValue } from "../../workspace/model/workspace-types";
import type { QueueMessage } from "../components/chat-queue";

export interface PreparedQueueEdit {
  body: string;
  attachments: QueueMessage["attachments"];
  session: QueueEditSession;
}

type QueueEditWorkspace = Pick<MobileWorkspaceContextValue, "queueEdit">;
type Scope = Pick<MobileAgent, "id" | "serverId">;
export interface QueueEditTarget {
  message: QueueMessage;
  session: QueueEditSession;
}

function prepare(workspace: QueueEditWorkspace, agent: Scope, state: QueueEditState): PreparedQueueEdit {
  return {
    body: state.text,
    attachments: state.attachments,
    session: new QueueEditSession(agent.id, state, (input) => workspace.queueEdit(input, agent.serverId)),
  };
}

export async function recoverQueueEdit(workspace: QueueEditWorkspace, agent: Scope) {
  const state = await workspace.queueEdit({ agentId: agent.id, operation: "read" }, agent.serverId);
  if (!state) return null;
  return {
    ...prepare(workspace, agent, state),
    message: {
      id: state.deliveryId,
      kind: "message",
      author: "user",
      body: state.text,
      streaming: false,
      attachments: state.attachments,
      replyToMessageId: state.replyToMessageId,
      delivery: { id: state.deliveryId, status: "cancelled", position: null },
    } satisfies QueueMessage,
  };
}

export async function prepareQueueEdit(
  workspace: QueueEditWorkspace,
  agent: Scope,
  message: QueueMessage,
): Promise<PreparedQueueEdit> {
  if (!message.delivery) throw new Error("This message is not queued.");
  const state = await workspace.queueEdit(
    { agentId: agent.id, deliveryId: message.delivery.id, operation: "begin" },
    agent.serverId,
  );
  if (!state) throw new Error("The queue edit is unavailable.");
  return prepare(workspace, agent, state);
}

export async function saveQueueEdit(edit: QueueEditTarget, text: string, uploaded: string[]) {
  await edit.session.send({
    text,
    attachmentDraftIds: [...(edit.message.attachments?.map((file) => file.id) ?? []), ...uploaded],
  });
}

export async function discardQueueEdit(edit: QueueEditTarget) {
  await edit.session.cancel();
}
