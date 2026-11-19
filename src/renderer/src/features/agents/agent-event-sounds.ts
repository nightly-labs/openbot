import type { AgentEvent, TeamRealtimeEvent } from "@openbot/contracts/ipc";
import { playActionSound } from "../../action-sounds";

export function createAgentEventSounds(
  notifies: (agentId: string) => boolean,
): (event: AgentEvent | TeamRealtimeEvent) => void {
  const askedRequests = new Map<string, string>();
  const ask = (agentId: string, request: string) => {
    if (askedRequests.get(agentId) === request) return;
    askedRequests.set(agentId, request);
    if (notifies(agentId)) playActionSound("attention");
  };
  return (event) => {
    switch (event.type) {
      case "approval":
        ask(event.approval.agentId, `approval:${event.approval.turnId}:${event.approval.requestId}`);
        return;
      case "prompt":
        ask(event.agentId, `prompt:${event.turnId}:${event.requestId}`);
        return;
      case "browser-takeover-requested":
        ask(event.request.agentId, `browser:${event.request.turnId}:${event.request.requestId}`);
        return;
      case "turn-completed":
        if (
          event.status === "failed" &&
          event.origin !== "routine" &&
          event.origin !== "agent" &&
          notifies(event.agentId)
        ) {
          playActionSound("error");
        }
        return;
    }
  };
}
