import type { ConversationMessage, ConversationSearchPage } from "@openbot/contracts/ipc";
import { expect, it } from "vitest";
import { decodeConversationSearchPage } from "../../workspace/model/conversation";
import type { MobileAgent } from "../../workspace/model/workspace-types";
import { mobileSearchView } from "./mobile-search";

const agent: MobileAgent = {
  id: "chief",
  serverId: "host",
  name: "Chief",
  title: "Planner",
  description: "",
  preview: "Ready",
  updatedLabel: "",
  avatarSeed: "chief",
  avatarHue: null,
};

function message(id: string, text: string): ConversationMessage {
  return { id, author: "assistant", text, createdAt: "2026-09-28T10:00:00.000Z", status: "completed" };
}

const page: ConversationSearchPage = {
  results: [
    { agentId: "chief", message: message("one", "Budget   draft\nready") },
    // A hidden or deleted agent is not in the list, so its message stays out of the results.
    { agentId: "hidden", message: message("two", "Budget for hidden agent") },
  ],
  total: 2,
  nextCursor: null,
};

it("shows host message results with local agent matches", () => {
  const view = mobileSearchView({
    query: "budget",
    agents: [agent],
    messages: { status: "ready", page, hasMore: false },
  });
  expect(view).toEqual({
    state: "results",
    messages: "ready",
    canLoadMore: false,
    results: [
      {
        id: "message-chief-one",
        category: "messages",
        agent,
        message: page.results[0]?.message,
        text: "Budget draft ready",
      },
    ],
  });

  const agents = mobileSearchView({
    query: "chief",
    agents: [agent],
    messages: { status: "ready", page: { results: [], total: 0, nextCursor: null }, hasMore: false },
  });
  expect(agents).toEqual({
    state: "results",
    messages: "ready",
    canLoadMore: false,
    results: [{ id: "agent-chief", category: "agents", agent }],
  });
});

it("says when nothing matches", () => {
  const empty = { results: [], total: 0, nextCursor: null };
  expect(
    mobileSearchView({
      query: "nothing",
      agents: [agent],
      messages: { status: "ready", page: empty, hasMore: false },
    }),
  ).toEqual({ state: "empty" });
  // An empty query lists every agent and does not search messages.
  expect(mobileSearchView({ query: "", agents: [agent], messages: { status: "idle" } })).toEqual({
    state: "results",
    messages: "idle",
    canLoadMore: false,
    results: [{ id: "agent-chief", category: "agents", agent }],
  });
});

it("reads past pages that hold only hidden agents' matches", () => {
  const hiddenOnly = {
    results: [{ agentId: "hidden", message: message("two", "Budget for hidden agent") }],
    total: 51,
    nextCursor: "50",
  };
  // More pages exist, so a page with no visible match is not "no matches".
  expect(
    mobileSearchView({
      query: "budget",
      agents: [agent],
      messages: { status: "ready", page: hiddenOnly, hasMore: true },
    }),
  ).toEqual({ state: "loading" });
  expect(
    mobileSearchView({
      query: "budget",
      agents: [agent],
      messages: { status: "ready", page: hiddenOnly, hasMore: false },
    }),
  ).toEqual({ state: "empty" });
  // Visible matches with more pages offer the older ones.
  expect(
    mobileSearchView({ query: "budget", agents: [agent], messages: { status: "ready", page, hasMore: true } }),
  ).toMatchObject({ state: "results", messages: "ready", canLoadMore: true });
});

it("reports loading and errors from the host search", () => {
  expect(
    mobileSearchView({ query: "budget", agents: [agent], messages: { status: "loading", page: null, hasMore: false } }),
  ).toEqual({
    state: "loading",
  });
  expect(
    mobileSearchView({ query: "budget", agents: [agent], messages: { status: "error", page: null, hasMore: false } }),
  ).toEqual({
    state: "error",
  });
  // Agent matches stay visible while the message search fails.
  expect(
    mobileSearchView({ query: "chief", agents: [agent], messages: { status: "error", page: null, hasMore: false } }),
  ).toMatchObject({
    state: "results",
    messages: "error",
  });
});

it("decodes the released search page and rejects a malformed one", () => {
  expect(decodeConversationSearchPage(page)).toEqual(page);
  expect(() => decodeConversationSearchPage({ results: [{ agentId: "chief" }], total: 1, nextCursor: null })).toThrow();
  expect(() => decodeConversationSearchPage({ results: [], total: 0 })).toThrow();
});
