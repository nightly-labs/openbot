import type { AgentApproval, AgentEvent, AgentRuntimeSnapshot } from "@openbot/contracts/ipc";
import { cleanAgentMessageText } from "@openbot/team-client/agent-message-text";
import { keepWholeApprovals, reconcilePendingRequests } from "@openbot/team-client/runtime-attention";
import type { AgentMessage } from "@openbot/ui/data";
import { createStoredMessage } from "../../app-stored-values";
import { promptRequestKey } from "../conversation/conversation-keys";

type PromptEvent = Extract<AgentEvent, { type: "prompt" }>;
type BrowserTakeoverEvent = Extract<AgentEvent, { type: "browser-takeover-requested" }>;

type AttentionEvent = PromptEvent | BrowserTakeoverEvent;

export type PendingAttentionPrompts = Record<string, AttentionEvent | undefined>;

export function attentionKey(agentId: string, threadId: string | null): string {
  return `${agentId}\u0000${threadId ?? ""}`;
}

function promptAnswerInFlight(
  prompt: { agentId: string; threadId: string; turnId: string; requestId: string | number },
  submittedRequests: Record<string, string | undefined>,
): boolean {
  const key = promptRequestKey(prompt.turnId, prompt.requestId);
  return (
    key === submittedRequests[prompt.agentId] ||
    key === submittedRequests[attentionKey(prompt.agentId, prompt.threadId)]
  );
}

export function attentionEventKey(event: AttentionEvent): string {
  return event.type === "prompt"
    ? attentionKey(event.agentId, event.threadId)
    : attentionKey(event.request.agentId, event.request.threadId);
}

export function attentionAgentId(event: AttentionEvent): string {
  return event.type === "prompt" ? event.agentId : event.request.agentId;
}

export function attentionOfAgent(prompts: PendingAttentionPrompts, agentId: string): AttentionEvent[] {
  return Object.values(prompts).filter(
    (event): event is AttentionEvent => event !== undefined && attentionAgentId(event) === agentId,
  );
}

export function withoutAttention(
  prompts: PendingAttentionPrompts,
  matches: (event: AttentionEvent) => boolean,
): PendingAttentionPrompts {
  const kept = Object.entries(prompts).filter(([, event]) => event !== undefined && !matches(event));
  return kept.length === Object.keys(prompts).length ? prompts : Object.fromEntries(kept);
}

export function attentionByAgent(
  prompts: PendingAttentionPrompts,
  agents: readonly { id: string; threadId: string | null }[],
): PendingAttentionPrompts {
  const byAgent: PendingAttentionPrompts = {};
  for (const event of Object.values(prompts)) if (event) byAgent[attentionAgentId(event)] = event;
  for (const agent of agents) {
    const own = prompts[attentionKey(agent.id, agent.threadId)];
    if (own) byAgent[agent.id] = own;
  }
  return byAgent;
}

export function reconcileAttentionPrompts(
  current: PendingAttentionPrompts,
  snapshot: Pick<AgentRuntimeSnapshot, "attentionComplete" | "pendingPrompts" | "pendingBrowserTakeovers">,
  submittedRequests: Record<string, string | undefined>,
): PendingAttentionPrompts {
  const next: PendingAttentionPrompts = snapshot.attentionComplete ? {} : { ...current };
  for (const prompt of snapshot.pendingPrompts) {
    if (!promptAnswerInFlight(prompt, submittedRequests)) {
      next[attentionKey(prompt.agentId, prompt.threadId)] = { type: "prompt", ...prompt };
    }
  }
  for (const request of snapshot.pendingBrowserTakeovers) {
    next[attentionKey(request.agentId, request.threadId)] = { type: "browser-takeover-requested", request };
  }
  return keepEqualRecord(current, next);
}

export function sameData(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (typeof left !== "object" || typeof right !== "object" || left === null || right === null) return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((item, index) => sameData(item, right[index]));
  }
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);
  return (
    leftEntries.length === rightEntries.length &&
    leftEntries.every(([key, value], index) => {
      const other = rightEntries[index];
      return other !== undefined && other[0] === key && sameData(value, other[1]);
    })
  );
}

export function keepEqualRecord<Value>(
  current: Record<string, Value>,
  next: Record<string, Value>,
): Record<string, Value> {
  const currentKeys = Object.keys(current);
  const nextKeys = Object.keys(next);
  let changed = currentKeys.length !== nextKeys.length;
  for (const [index, key] of nextKeys.entries()) {
    const previous = current[key];
    if (Object.hasOwn(current, key) && sameData(previous, next[key])) {
      if (previous !== undefined) next[key] = previous;
      if (currentKeys[index] !== key) changed = true;
    } else changed = true;
  }
  return changed ? next : current;
}

export function keepEqualList<Item>(current: Item[], next: Item[]): Item[] {
  let changed = current.length !== next.length;
  for (const [index, item] of next.entries()) {
    const previous = current[index];
    if (index < current.length && sameData(previous, item)) {
      if (previous !== undefined) next[index] = previous;
    } else changed = true;
  }
  return changed ? next : current;
}

export function seededAttentionPrompts(
  seed: PendingAttentionPrompts | undefined,
  presentedResolutions: Record<string, string | undefined>,
  submittedRequests: Record<string, string | undefined>,
): PendingAttentionPrompts {
  if (!seed) return {};
  const next: PendingAttentionPrompts = {};
  for (const entry of Object.values(seed)) {
    if (!entry) continue;
    const agentId = attentionAgentId(entry);
    if (entry.type === "prompt") {
      const key = promptRequestKey(entry.turnId, entry.requestId);
      if (key === presentedResolutions[agentId] || promptAnswerInFlight(entry, submittedRequests)) continue;
    }
    next[attentionEventKey(entry)] = entry;
  }
  return next;
}

export function reconcileAttentionApprovals(
  current: readonly AgentApproval[],
  snapshot: Pick<AgentRuntimeSnapshot, "attentionComplete" | "pendingApprovals">,
): AgentApproval[] {
  return reconcilePendingRequests(
    current,
    keepWholeApprovals(current, snapshot.pendingApprovals),
    snapshot.attentionComplete,
  );
}

export function appendLatestRuntimeMessages(
  current: Record<string, AgentMessage[]>,
  latestMessages: AgentRuntimeSnapshot["latestMessages"],
): Record<string, AgentMessage[]> {
  const next = { ...current };
  for (const message of latestMessages) {
    const messages = next[message.agentId] ?? [];
    if (messages.some((candidate) => candidate.id === message.id)) continue;
    const oldestLoaded = messages.find((candidate) => candidate.createdAt)?.createdAt ?? "";
    if (Date.parse(message.createdAt) < Date.parse(oldestLoaded)) continue;
    next[message.agentId] = [
      ...messages,
      createStoredMessage({
        id: message.id,
        author: "agent",
        body: cleanAgentMessageText(message.text),
        time: message.createdAt,
        createdAt: message.createdAt,
      }),
    ];
  }
  return next;
}
