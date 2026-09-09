import { chatTagReferences, serializeChatTagReference } from "@openbot/contracts/chat-tag-references";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { markdown, parseChatMarkdown } from "./chat-markdown-parser";
import { editMentionDraft, insertMention, mentionDraft, mentionQuery, plainMentionParts } from "./chat-mentions";
import { projectChatMessages } from "./chat-messages";

// Node provides these methods, but the mobile runtime used by the app does not.
beforeEach(() => {
  vi.spyOn(Array.prototype, "toSorted").mockImplementation(() => {
    throw new TypeError("toSorted is unavailable in the mobile runtime");
  });
  vi.spyOn(Array.prototype, "toReversed").mockImplementation(() => {
    throw new TypeError("toReversed is unavailable in the mobile runtime");
  });
});
afterEach(() => vi.restoreAllMocks());

const git = serializeChatTagReference("agent", "Git", "git-id");

describe("mobile agent mentions", () => {
  it("keeps identities when surrounding text changes, but removes them when a name is edited", () => {
    expect([
      editMentionDraft(`${git} hello`, "@Git hello again"),
      editMentionDraft(`Hi ${git}`, "Hello @Git"),
      editMentionDraft(`${git} hello`, "@Gi hello"),
      editMentionDraft(`${git} hello`, "hello"),
    ]).toEqual([`${git} hello again`, `Hello ${git}`, "@Gi hello", "hello"]);
  });

  it("inserts encoded names in the middle without losing other mentions", () => {
    const agent = { id: "id)", name: "Mail [team]" };
    const inserted = insertMention(`${git} @Ma after ${git}`, { start: 5, end: 8 }, agent);
    expect(mentionDraft(inserted).text).toBe("@Git @Mail [team]  after @Git");
    expect(chatTagReferences(inserted).map(({ id }) => id)).toEqual(["git-id", "id)", "git-id"]);
  });

  it("suggests at the caret, excluding email addresses and completed mentions", () => {
    expect([
      mentionQuery("Ask @Mail team please", 14),
      mentionQuery("mail@example.com", 16),
      mentionQuery(`${git} hello`, 4),
    ]).toEqual([{ start: 4, end: 14, query: "mail team" }, null, null]);
  });

  it("recognizes mentions in prose without changing code", () => {
    const tokens = parseChatMarkdown(`${git}\n\n\`${git}\`\n\n\`\`\`js\n${git}\n\`\`\``);
    const types: string[] = [];
    markdown.walkTokens(tokens, (token) => {
      types.push(token.type);
    });
    expect(types.filter((type) => ["agentMention", "codespan", "code"].includes(type))).toEqual([
      "agentMention",
      "codespan",
      "code",
    ]);
  });

  it("keeps exchange markers and the current agent response without exposing another agent message", () => {
    const exchange = {
      direction: "outgoing" as const,
      messageId: "m",
      senderAgentId: "git-id",
      recipientAgentIds: ["mail-id"],
      replyToMessageId: null,
      deliveries: [],
    };
    const result = projectChatMessages([
      { id: "out", author: "system", text: "hello", createdAt: "now", status: "completed", exchange },
      {
        id: "in",
        author: "agent",
        text: "reply",
        createdAt: "now",
        status: "completed",
        exchange: { ...exchange, direction: "incoming" },
      },
      { id: "response", author: "assistant", text: "Current agent response", createdAt: "now", status: "completed" },
    ]);
    expect(
      result.map((message) =>
        message.kind === "exchange"
          ? message.exchange.direction
          : message.kind === "message"
            ? message.body
            : message.kind,
      ),
    ).toEqual(["outgoing", "incoming", "Current agent response"]);
  });
});

it("resolves plain names in old messages and replies, with longest names first", () => {
  const agents = [
    { id: "design", name: "Design" },
    { id: "team", name: "Design Team" },
    { id: "special", name: "C++" },
  ];
  const body = "@Design test. Wysłano do @design: cześć @Design Team! @C++ mail@Design.com @Designer";
  expect(
    plainMentionParts(body, agents)
      .filter((part) => part.agent)
      .map((part) => [part.text, part.agent?.id]),
  ).toEqual([
    ["@Design", "design"],
    ["@design", "design"],
    ["@Design Team", "team"],
    ["@C++", "special"],
  ]);
  expect(
    plainMentionParts(body, agents)
      .map((part) => part.text)
      .join(""),
  ).toBe(body);
});
