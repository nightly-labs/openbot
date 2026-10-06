import { type DynamicIslandAction, LOCAL_SERVER_ID } from "@openbot/contracts/ipc";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { Effect } from "effect";
import type { AgentLifecycleFailed } from "../backend/agent-service";
import type { RemoteWorkflowError } from "./remote-service-effects";

type CriticalAction = Extract<DynamicIslandAction, { type: "answer-prompt" | "respond-approval" }>;

export interface DynamicIslandActionAgent {
  respondToPrompt(input: {
    requestId: string | number;
    answers: Record<string, string[]>;
  }): Effect.Effect<void, AgentLifecycleFailed>;
  respondToApproval(input: {
    requestId: string | number;
    decision: "accept" | "decline";
  }): Effect.Effect<void, AgentLifecycleFailed>;
}

export interface DynamicIslandRemoteAgent {
  request(
    serverId: string,
    path: string,
    decoder: (value: unknown) => void,
    init: { method: "POST"; body: unknown },
  ): Effect.Effect<void, RemoteWorkflowError>;
}

export const performDynamicIslandCriticalAction = Effect.fn("DynamicIsland.criticalAction")(function* (
  action: CriticalAction,
  local: DynamicIslandActionAgent,
  remote: DynamicIslandRemoteAgent,
  decodeVoid: (value: unknown) => void,
) {
  if (action.type === "answer-prompt") {
    const input = { requestId: action.requestId, answers: action.answers };
    return yield* action.serverId === LOCAL_SERVER_ID
      ? local.respondToPrompt(input)
      : remote.request(action.serverId, TEAM_API_ROUTES.respond.prompt, decodeVoid, { method: "POST", body: input });
  }
  const input = { requestId: action.requestId, decision: action.decision };
  return yield* action.serverId === LOCAL_SERVER_ID
    ? local.respondToApproval(input)
    : remote.request(action.serverId, TEAM_API_ROUTES.respond.approval, decodeVoid, { method: "POST", body: input });
});
