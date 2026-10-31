import type { AgentTask, ConversationMessage, ConversationSnapshot } from "@openbot/contracts/ipc";
import type { MockOpenBotOptions } from "../src/preview/mock-openbot";

/** Side threads of Chief for the desktop and web thread stories. */
export const AGENT_ID = "chief";
export const TABS_KEY = "openbot:thread-tabs:v1";

function message(id: string, author: "user" | "assistant", text: string, createdAt: string): ConversationMessage {
  return { id, author, source: author, text, createdAt, status: "completed" };
}

function thread(id: string, title: string, updatedAt: string, fields: Partial<AgentTask> = {}): AgentTask {
  return {
    id,
    agentId: AGENT_ID,
    threadId: `thread-${id}`,
    origin: "user",
    title,
    state: "idle",
    outcome: "completed",
    hold: null,
    activeTurnId: null,
    progress: null,
    error: null,
    queuedMessages: [],
    createdAt: updatedAt,
    updatedAt,
    closedAt: null,
    ...fields,
  };
}

const PRICING = thread("pricing", "Pricing page copy", "2026-08-19T09:58:00.000Z");

/** A branch of "Pricing page copy" through its headline answer. The menu nests it under its source. */
const PRICING_SHORT = thread("pricing-short", "Pricing page copy #2", "2026-08-19T10:04:00.000Z", {
  branch: { sourceTaskId: PRICING.id, sourceMessageId: "pricing-2", throughMessageId: "pricing-short-2" },
});

/** A branch whose source thread was deleted. Its divider has no link. */
const PRICING_ORPHAN = thread("pricing-orphan", "Pricing FAQ", "2026-08-19T08:20:00.000Z", {
  branch: { sourceTaskId: "deleted-thread", sourceMessageId: "deleted-2", throughMessageId: "pricing-orphan-2" },
});

const THREADS: AgentTask[] = [
  PRICING_SHORT,
  PRICING,
  thread("pricing-long", "Pricing page copy #3", "2026-08-19T10:01:00.000Z", {
    branch: { sourceTaskId: PRICING.id, sourceMessageId: "pricing-2", throughMessageId: "pricing-long-2" },
  }),
  // A branch of a branch: the line of "#2" runs on past it to "#3".
  thread("pricing-short-alt", "Pricing page copy #4", "2026-08-19T10:06:00.000Z", {
    branch: {
      sourceTaskId: PRICING_SHORT.id,
      sourceMessageId: "pricing-short-2",
      throughMessageId: "pricing-short-alt-2",
    },
  }),
  thread("competitors", "Competitor scan", "2026-08-19T09:50:00.000Z", {
    state: "running",
    outcome: null,
    activeTurnId: "turn-competitors",
    progress: "Reading three pricing pages",
  }),
  thread("release", "Release notes draft", "2026-08-19T09:40:00.000Z", {
    outcome: "failed",
    error: "The provider stopped the turn: usage limit reached.",
  }),
  thread("links", "Check broken links", "2026-08-19T09:30:00.000Z", {
    origin: "agent",
    state: "queued",
    outcome: null,
    hold: "task-limit",
    queuedMessages: [
      { deliveryId: "links-1", text: "Check every link on the docs site.", createdAt: "2026-08-19T09:30:00.000Z" },
    ],
  }),
  PRICING_ORPHAN,
  thread("onboarding", "Old onboarding copy", "2026-08-18T16:00:00.000Z", {
    state: "closed",
    closedAt: "2026-08-18T17:00:00.000Z",
  }),
];

function snapshot(task: AgentTask, messages: ConversationMessage[]): ConversationSnapshot {
  return { agentId: AGENT_ID, threadId: task.threadId, activeTurnId: task.activeTurnId, revision: 1, messages };
}

export const THREAD_OPTIONS: MockOpenBotOptions = {
  tasks: { [AGENT_ID]: THREADS },
  // The open thread shows its context meter, with the Compact action.
  runtimeSnapshot: {
    threadContextStates: [
      {
        agentId: AGENT_ID,
        threadId: PRICING.threadId,
        usage: { usedTokens: 148_000, windowTokens: 258_000, autoCompactAt: 0.8, nativeManaged: false },
        compaction: null,
      },
    ],
    agents: [],
    activeTurns: [],
    work: [],
    latestMessages: [],
    attentionComplete: true,
    pendingPrompts: [],
    pendingApprovals: [],
    pendingBrowserTakeovers: [],
    failedTurns: [],
  },
  taskConversations: {
    pricing: snapshot(PRICING, [
      message(
        "pricing-1",
        "user",
        "Write two headline options for the pricing page. Keep them under eight words.",
        "2026-08-19T09:55:00.000Z",
      ),
      message(
        "pricing-2",
        "assistant",
        "Two headline options are in `pricing.md`:\n\n1. **Your team of agents, on your computer.**\n2. **Hire agents. Keep your data.**",
        "2026-08-19T09:58:00.000Z",
      ),
    ]),
    "pricing-short": snapshot(PRICING_SHORT, [
      message(
        "pricing-short-1",
        "user",
        "Write two headline options for the pricing page. Keep them under eight words.",
        "2026-08-19T09:55:00.000Z",
      ),
      message(
        "pricing-short-2",
        "assistant",
        "Two headline options are in `pricing.md`:\n\n1. **Your team of agents, on your computer.**\n2. **Hire agents. Keep your data.**",
        "2026-08-19T09:58:00.000Z",
      ),
      message("pricing-short-3", "user", "Make the second one shorter.", "2026-08-19T10:03:00.000Z"),
      message("pricing-short-4", "assistant", "**Agents that keep your data.**", "2026-08-19T10:04:00.000Z"),
    ]),
    "pricing-orphan": snapshot(PRICING_ORPHAN, [
      message("pricing-orphan-1", "user", "List the questions people ask about pricing.", "2026-08-19T08:10:00.000Z"),
      message(
        "pricing-orphan-2",
        "assistant",
        "The top three: can I pay yearly, what counts as a member, and can I move my license.",
        "2026-08-19T08:12:00.000Z",
      ),
      message("pricing-orphan-3", "user", "Answer each in one sentence.", "2026-08-19T08:18:00.000Z"),
      message(
        "pricing-orphan-4",
        "assistant",
        "Yes, with the yearly switch. A member is a person who signs in. Yes, from Settings.",
        "2026-08-19T08:20:00.000Z",
      ),
    ]),
  },
};
