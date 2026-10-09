import {
  type ConversationMessageSender,
  type DynamicIslandAction,
  LOCAL_SERVER_ID,
  type SendMessageInput,
} from "@openbot/contracts/ipc";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { Effect } from "effect";
import type { AgentLifecycleFailed } from "../backend/agent-service";
import type { RemoteWorkflowError } from "./remote-service-effects";

/** The island actions that main runs against the agent itself, with no help from the main window. */
export type CriticalAction = Extract<
  DynamicIslandAction,
  { type: "answer-prompt" | "respond-approval" | "send-message" | "stop-agent" }
>;

export interface DynamicIslandActionAgent {
  respondToPrompt(input: {
    requestId: string | number;
    answers: Record<string, string[]>;
  }): Effect.Effect<void, AgentLifecycleFailed>;
  respondToApproval(input: {
    requestId: string | number;
    decision: "accept" | "decline";
  }): Effect.Effect<void, AgentLifecycleFailed>;
  sendMessage(
    input: SendMessageInput,
    sender?: ConversationMessageSender,
  ): Effect.Effect<unknown, AgentLifecycleFailed>;
  interrupt(agentId: string, turnId: string): Effect.Effect<void, AgentLifecycleFailed>;
}

export interface DynamicIslandRemoteAgent {
  request(
    serverId: string,
    path: string,
    decoder: (value: unknown) => unknown,
    init: { method: "POST"; body: unknown },
  ): Effect.Effect<unknown, RemoteWorkflowError>;
}

export const performDynamicIslandCriticalAction = Effect.fn("DynamicIsland.criticalAction")(function* (
  action: CriticalAction,
  local: DynamicIslandActionAgent,
  remote: DynamicIslandRemoteAgent,
  decoders: { decodeVoid: (value: unknown) => void; decodeQueuedMessageReceipt: (value: unknown) => unknown },
  sender: () => ConversationMessageSender | undefined,
) {
  const { decodeVoid, decodeQueuedMessageReceipt } = decoders;
  if (action.type === "send-message") {
    const input = { agentId: action.agentId, text: action.text, clientMessageId: action.clientMessageId };
    return yield* action.serverId === LOCAL_SERVER_ID
      ? local.sendMessage(input, sender()).pipe(Effect.asVoid)
      : remote
          .request(action.serverId, TEAM_API_ROUTES.agent.messages(action.agentId), decodeQueuedMessageReceipt, {
            method: "POST",
            // The host uses this computer's zone for a routine the agent creates from the message.
            body: { ...input, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
          })
          .pipe(Effect.asVoid);
  }
  if (action.type === "stop-agent") {
    return yield* action.serverId === LOCAL_SERVER_ID
      ? local.interrupt(action.agentId, action.turnId)
      : remote
          .request(action.serverId, TEAM_API_ROUTES.agent.interrupt(action.agentId), decodeVoid, {
            method: "POST",
            body: { turnId: action.turnId },
          })
          .pipe(Effect.asVoid);
  }
  if (action.type === "answer-prompt") {
    const input = { requestId: action.requestId, answers: action.answers };
    return yield* action.serverId === LOCAL_SERVER_ID
      ? local.respondToPrompt(input)
      : remote
          .request(action.serverId, TEAM_API_ROUTES.respond.prompt, decodeVoid, { method: "POST", body: input })
          .pipe(Effect.asVoid);
  }
  const input = { requestId: action.requestId, decision: action.decision };
  return yield* action.serverId === LOCAL_SERVER_ID
    ? local.respondToApproval(input)
    : remote
        .request(action.serverId, TEAM_API_ROUTES.respond.approval, decodeVoid, { method: "POST", body: input })
        .pipe(Effect.asVoid);
});
