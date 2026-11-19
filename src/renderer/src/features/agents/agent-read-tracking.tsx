import { createSimpleContext } from "../../simple-context";
import type { AgentAutoReadEntry } from "../conversation/conversation-read-state";

const AgentReadTracking = createSimpleContext({
  name: "Agent read tracking",
  init: () => ({
    agentChatsToMarkRead: new Set<string>(),
    agentChatsToRetryRead: new Set<string>(),
    autoReadAgentMessages: new Map<string, AgentAutoReadEntry>(),
  }),
});

export const AgentReadTrackingProvider = AgentReadTracking.provider;
export const useAgentReadTracking = AgentReadTracking.use;
