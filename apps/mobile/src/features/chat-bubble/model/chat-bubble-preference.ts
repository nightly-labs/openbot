import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { create } from "zustand";

export const CHAT_BUBBLE_STORAGE_KEY = "openbot.mobile.chat-bubble.v1";

export interface ChatBubblePreference {
  enabled: boolean;
  agents: Record<string, boolean>;
}

export interface BubbleAgent {
  id: string;
  serverId: string;
}

export const DEFAULT_CHAT_BUBBLE_PREFERENCE: ChatBubblePreference = { enabled: false, agents: {} };

export function agentBubbleKey(serverId: string, agentId: string): string {
  return `${serverId}:${agentId}`;
}

export function bubbleEnabledFor(preference: ChatBubblePreference, serverId: string, agentId: string): boolean {
  return preference.enabled && (preference.agents[agentBubbleKey(serverId, agentId)] ?? true);
}

export function resolvedBubbleAgents(preference: ChatBubblePreference, agents: readonly BubbleAgent[]): string[] {
  return agents
    .filter((agent) => bubbleEnabledFor(preference, agent.serverId, agent.id))
    .map((agent) => agentBubbleKey(agent.serverId, agent.id));
}

export const useChatBubblePreference = create<ChatBubblePreference & { ready: boolean; saving: boolean }>(() => ({
  ...DEFAULT_CHAT_BUBBLE_PREFERENCE,
  ready: false,
  saving: false,
}));

export function decodeChatBubblePreference(value: string | null): ChatBubblePreference {
  if (!value) return DEFAULT_CHAT_BUBBLE_PREFERENCE;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return DEFAULT_CHAT_BUBBLE_PREFERENCE;
  }
  if (!isDynamicRecord(parsed)) return DEFAULT_CHAT_BUBBLE_PREFERENCE;
  const agents: Record<string, boolean> = {};
  if (isDynamicRecord(parsed.agents)) {
    for (const [key, enabled] of Object.entries(parsed.agents)) {
      if (typeof enabled === "boolean") agents[key] = enabled;
    }
  }
  return { enabled: parsed.enabled === true, agents };
}

export function chatBubblePreferenceText(preference: ChatBubblePreference): string {
  return JSON.stringify({ enabled: preference.enabled, agents: preference.agents });
}
