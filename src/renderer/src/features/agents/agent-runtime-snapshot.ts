import type { AgentApproval, AgentEvent, AgentRuntimeSnapshot } from "@openbot/contracts/ipc";
import { cleanAgentMessageText } from "@openbot/team-client/agent-message-text";
import { reconcilePendingRequests } from "@openbot/team-client/runtime-attention";
import type { AgentMessage } from "@openbot/ui/data";
import { createStoredMessage } from "../../app-stored-values";
import { promptRequestKey } from "../conversation/conversation-keys";

type PromptEvent = Extract<AgentEvent, { type: "prompt" }>;
type BrowserTakeoverEvent = Extract<AgentEvent, { type: "browser-takeover-requested" }>;

type AttentionEvent = PromptEvent | BrowserTakeoverEvent;

/**
 * The waiting prompts and browser takeovers, by `attentionKey`. Each thread of an agent has its own
 * entry, so a wait in a side thread or a channel never hides the one in the agent's own chat.
 */
export type PendingAttentionPrompts = Record<string, AttentionEvent | undefined>;

/** An agent with no thread yet has a key that no wait has. */
export function attentionKey(agentId: string, threadId: string | null): string {
  return `${agentId}\u0000${threadId ?? ""}`;
}

/**
 * Whether the answer to this prompt is on its way to main. The agent's own chat marks it by agent id,
 * and a side thread by its `attentionKey`, so an answer in one does not replace the mark of the other.
 */
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

/** The waits of an agent, in any thread. */
export function attentionOfAgent(prompts: PendingAttentionPrompts, agentId: string): AttentionEvent[] {
  return Object.values(prompts).filter(
    (event): event is AttentionEvent => event !== undefined && attentionAgentId(event) === agentId,
  );
}

/** Removes the waits that `matches` selects. The same object when none matches. */
export function withoutAttention(
  prompts: PendingAttentionPrompts,
  matches: (event: AttentionEvent) => boolean,
): PendingAttentionPrompts {
  const kept = Object.entries(prompts).filter(([, event]) => event !== undefined && !matches(event));
  return kept.length === Object.keys(prompts).length ? prompts : Object.fromEntries(kept);
}

/**
 * One wait per agent, for a view that shows one: the wait of the agent's own chat first, else the
 * newest of another thread.
 */
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

/**
 * Folding a runtime snapshot into what the renderer already holds.
 *
 * A snapshot is main's whole answer to "what are the agents doing", and it
 * arrives both on reconnect and as a compact update that main may have had to
 * truncate. `attentionComplete` is the flag that separates the two: when it is
 * true the snapshot lists every prompt and approval there is, so anything the
 * renderer still shows and the snapshot omits is gone; when it is false the
 * snapshot is a partial view and dropping what it omits would clear a prompt
 * the user is looking at.
 *
 * Kept apart from `agent-event-bridge.tsx` because that file is routing - one
 * event, several domains - while this is the arithmetic underneath it, and the
 * arithmetic is where the reconnect edge cases live.
 */
export function reconcileAttentionPrompts(
  current: PendingAttentionPrompts,
  snapshot: Pick<AgentRuntimeSnapshot, "attentionComplete" | "pendingPrompts" | "pendingBrowserTakeovers">,
  submittedRequests: Record<string, string | undefined>,
): PendingAttentionPrompts {
  const next: PendingAttentionPrompts = snapshot.attentionComplete ? {} : { ...current };
  for (const prompt of snapshot.pendingPrompts) {
    // A prompt whose answer is already on its way to main would otherwise come
    // back the moment a snapshot crosses the answer in flight.
    if (!promptAnswerInFlight(prompt, submittedRequests)) {
      next[attentionKey(prompt.agentId, prompt.threadId)] = { type: "prompt", ...prompt };
    }
  }
  for (const request of snapshot.pendingBrowserTakeovers) {
    next[attentionKey(request.agentId, request.threadId)] = { type: "browser-takeover-requested", request };
  }
  return next;
}

/**
 * The prompts a server scope starts with, out of what the coordinator remembers
 * that server was blocked on.
 *
 * The coordinator's memory is the renderer's own projection played back, so it
 * still lists a prompt the user answered while main was working out that the
 * answer had arrived. Seeding it unfiltered remounts `QuestionPromptBubble` on
 * its first page - the bubble hides the questions in local state that the
 * remount throws away - and the user is asked again. The two markers outlive the
 * scope for exactly this window; `reconcileAttentionPrompts` consults the
 * submitted one against main's snapshots, and this consults both against the
 * coordinator's, which is the only other way a prompt enters the scope.
 *
 * Only prompts are filtered. A browser takeover leaves `pendingPrompts` the
 * moment main accepts the response, so the projection above this has already
 * dropped it. The coordinator keeps one wait per agent; the scope keys each by
 * its thread.
 */
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
  return reconcilePendingRequests(current, snapshot.pendingApprovals, snapshot.attentionComplete);
}

/**
 * The tail of each agent's transcript, as the snapshot last saw it. A message
 * the renderer already has stays as it is: it may be further along than the
 * snapshot's copy, which is capped at `AGENT_RUNTIME_TEXT_LIMIT`.
 *
 * An appended message is only the start of the reply, so it is a stored message: the conversation
 * snapshot, delta or page that follows must be able to replace its body.
 */
export function appendLatestRuntimeMessages(
  current: Record<string, AgentMessage[]>,
  latestMessages: AgentRuntimeSnapshot["latestMessages"],
): Record<string, AgentMessage[]> {
  const next = { ...current };
  for (const message of latestMessages) {
    const messages = next[message.agentId] ?? [];
    if (messages.some((candidate) => candidate.id === message.id)) continue;
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
