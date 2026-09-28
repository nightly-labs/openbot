import type { ConversationMessage, ConversationSearchPage } from "@openbot/contracts/ipc";
import type { MobileAgent } from "@/features/workspace/context/mobile-workspace-context";
import { markdownPreviewText } from "../../chat/model/chat-markdown-parser";

interface MobileSearchAgentResult {
  id: string;
  category: "agents";
  agent: MobileAgent;
}

interface MobileSearchMessageResult {
  id: string;
  category: "messages";
  agent: MobileAgent;
  message: ConversationMessage;
  text: string;
}

export type MobileSearchResult = MobileSearchAgentResult | MobileSearchMessageResult;

/** What the screen shows. Message search runs on the host, so its state is separate from the local agent match. */
export type MobileSearchView =
  | { state: "results"; results: MobileSearchResult[]; messages: "idle" | "loading" | "error" | "ready" }
  | { state: "loading" }
  | { state: "error" }
  | { state: "empty" };

export function normalizeMobileSearchQuery(query: string): string {
  return query.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function messageSearchText(message: ConversationMessage): string {
  return markdownPreviewText(message.text);
}

function agentSearchResults(agents: MobileAgent[], query: string): MobileSearchAgentResult[] {
  return agents
    .filter(
      (agent) =>
        !query ||
        [agent.name, agent.title, agent.preview].some((value) => normalizeMobileSearchQuery(value).includes(query)),
    )
    .map((agent) => ({ id: `agent-${agent.id}`, category: "agents", agent }));
}

/** Keeps only results for agents this device shows, as the desktop search does. */
function messageSearchResults(page: ConversationSearchPage, agents: MobileAgent[]): MobileSearchMessageResult[] {
  const agentsById = new Map(agents.map((agent) => [agent.id, agent]));
  return page.results.flatMap(({ agentId, message }) => {
    const agent = agentsById.get(agentId);
    const text = messageSearchText(message);
    return agent && text
      ? [{ id: `message-${agentId}-${message.id}`, category: "messages" as const, agent, message, text }]
      : [];
  });
}

export function mobileSearchView({
  query,
  agents,
  messages,
}: {
  query: string;
  agents: MobileAgent[];
  /** The host message search for the current query; `idle` when no search runs. */
  messages:
    | { status: "idle" }
    | { status: "loading" }
    | { status: "error" }
    | { status: "ready"; page: ConversationSearchPage };
}): MobileSearchView {
  const normalized = normalizeMobileSearchQuery(query);
  // Messages are searched only for a query; an empty query lists the agents.
  const messageStatus = normalized ? messages.status : "idle";
  const messageResults = messages.status === "ready" && normalized ? messageSearchResults(messages.page, agents) : [];
  const results = [...agentSearchResults(agents, normalized), ...messageResults];
  if (results.length > 0) return { state: "results", results, messages: messageStatus };
  if (messageStatus === "loading") return { state: "loading" };
  if (messageStatus === "error") return { state: "error" };
  return { state: "empty" };
}
