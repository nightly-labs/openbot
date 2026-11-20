import { MESSAGE_PINS_CAPABILITY, MESSAGE_PINS_ROUTES } from "@openbot/contracts/team-protocol/message-pins-v1";
import { sourceText } from "@openbot/i18n/source";
import { MessagePinRefusedError, runMessagePin } from "../message-pin-refusal";
import type { TeamApiAgents, TeamApiAgentTasks } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import {
  conversationSnapshotForCapabilities,
  markerExclusionsForCapabilities,
  memberSender,
  readJson,
  requireAgentLevel,
  stringField,
  WEBRTC_FRAME_BODY_BUDGET,
} from "./request-helpers";

const REFUSED_STATUS = { "not-found": 404, limit: 409 } as const;
const ROUTES: ReadonlySet<string> = new Set(Object.values(MESSAGE_PINS_ROUTES));

export async function routeMessagePins(
  context: TeamApiRequestContext,
  agents: Pick<TeamApiAgents, "listPinnedMessages" | "setMessagePinned" | "listAgents">,
  tasks: Pick<TeamApiAgentTasks, "readTaskAround"> | undefined,
  hiddenAgentIds: ReadonlySet<string>,
): Promise<RouteOutcome> {
  const { method, url, capabilities, request, json } = context;
  const path = url.pathname;
  if (method !== "POST" || !ROUTES.has(path)) return "unmatched";
  if (!capabilities.has(MESSAGE_PINS_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.messagePinsUnsupported"));
  const body = await readJson(request);
  const agentId = stringField(body, "agentId");
  if (hiddenAgentIds.has(agentId) || !agents.listAgents().some((agent) => agent.id === agentId))
    throw new HttpError(404, sourceText("error.team.agentNotFound"));
  requireAgentLevel(context, agentId, "chat");
  if (path === MESSAGE_PINS_ROUTES.list) return json(200, agents.listPinnedMessages(agentId));
  if (path === MESSAGE_PINS_ROUTES.readThread) {
    if (!tasks) throw new HttpError(400, sourceText("error.backend.threadRemoteUnsupported"));
    const input = { agentId, taskId: stringField(body, "taskId"), messageId: stringField(body, "messageId") };
    for (let limit = typeof body.limit === "number" ? body.limit : 50; ; limit = Math.floor(limit / 2)) {
      const part = tasks.readTaskAround({ ...input, limit }, markerExclusionsForCapabilities(capabilities));
      const answer = { ...part, conversation: conversationSnapshotForCapabilities(part.conversation, capabilities) };
      if (Buffer.byteLength(JSON.stringify(answer)) <= WEBRTC_FRAME_BODY_BUDGET) return json(200, answer);
      if (limit <= 1) throw new HttpError(413, sourceText("error.team.conversationPageTooLarge"));
    }
  }
  if (typeof body.pinned !== "boolean") throw new HttpError(400, "Invalid pinned.");
  const target = typeof body.taskId === "string" ? { agentId, taskId: body.taskId } : { agentId };
  try {
    return json(
      200,
      await runMessagePin(
        agents.setMessagePinned(
          { ...target, messageId: stringField(body, "messageId"), pinned: body.pinned },
          { kind: "person", sender: memberSender(context.member) ?? null },
        ),
      ),
    );
  } catch (error) {
    if (error instanceof MessagePinRefusedError) throw new HttpError(REFUSED_STATUS[error.reason], error.message);
    throw error;
  }
}
