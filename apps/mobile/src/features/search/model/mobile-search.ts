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
  | {
      state: "results";
      results: MobileSearchResult[];
      messages: "idle" | "loading" | "error" | "ready";
      /** The host has older matches that the user can ask for. */
      canLoadMore: boolean;
    }
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
  /**
   * The host message search for the current query, with the pages read so far; `idle` when no search
   * runs. `hasMore` is true when the host has another page.
   */
  messages:
    | { status: "idle" }
    | { status: "loading" | "error" | "ready"; page: ConversationSearchPage | null; hasMore: boolean };
}): MobileSearchView {
  const normalized = normalizeMobileSearchQuery(query);
  // Messages are searched only for a query; an empty query lists the agents.
  const search = normalized && messages.status !== "idle" ? messages : null;
  const messageResults = search?.page ? messageSearchResults(search.page, agents) : [];
  const hasMore = search?.hasMore ?? false;
  let messageStatus: "idle" | "loading" | "error" | "ready" = search?.status ?? "idle";
  // The host sorts every match before this device drops hidden agents, so a page can hold no visible
  // match while a later one does. The screen reads on in that case; show it as loading, not empty.
  if (messageStatus === "ready" && messageResults.length === 0 && hasMore) messageStatus = "loading";
  const results = [...agentSearchResults(agents, normalized), ...messageResults];
  if (results.length > 0)
    return { state: "results", results, messages: messageStatus, canLoadMore: messageStatus === "ready" && hasMore };
  if (messageStatus === "loading") return { state: "loading" };
  if (messageStatus === "error") return { state: "error" };
  return { state: "empty" };
}
