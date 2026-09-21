import { expect, it } from "vitest";
import { parseChatMarkdown } from "./chat-markdown-parser";
import type { ChatMessage } from "./chat-messages";
import { createReplyReveal, isStreamingReply, replyWordDelay, replyWordFeedback } from "./reply-reveal";

it("identifies active replies without treating interrupted replies or user messages as streaming", () => {
  const message: ChatMessage = {
    id: "reply",
    kind: "message",
    author: "agent",
    body: "Partial",
    streaming: true,
    status: "streaming",
  };
  expect(isStreamingReply(message)).toBe(true);
  expect(isStreamingReply({ ...message, streaming: false, status: "completed" })).toBe(false);
  expect(isStreamingReply({ ...message, streaming: false, status: "interrupted" })).toBe(false);
  expect(isStreamingReply({ ...message, streaming: false, status: "failed" })).toBe(false);
  expect(isStreamingReply({ ...message, author: "user" })).toBe(false);
});

it.each([
  "A **bold pair** and [a link](https://example.com).",
  "# Heading here\n\n- First item\n- Second item\n\n> Quoted words",
  "```ts\nconst x = 1;\n```\n\nNext paragraph.",
  "| One | Two |\n| --- | --- |\n| Three | Four |",
])("reveals fixed Markdown leaves in order without reparsing partial syntax: %s", (body) => {
  const tokens = parseChatMarkdown(body);
  const plan = createReplyReveal(tokens);
  expect(plan.words.length).toBeGreaterThan(0);
  expect(plan.at(0)).toEqual([]);
  for (let count = 1; count <= plan.words.length; count += 1) {
    expect(createReplyReveal(plan.at(count)).words).toEqual(plan.words.slice(0, count));
  }
  expect(plan.at(plan.words.length)).toBe(tokens);
  expect(createReplyReveal(tokens).words).toEqual(plan.words);
});

it("keeps formatting and link destinations from the completed document", () => {
  const plan = createReplyReveal(parseChatMarkdown("**First second** [third fourth](https://example.com)"));
  expect(plan.at(1)[0]).toMatchObject({ tokens: [{ type: "strong", tokens: [{ text: "First " }] }] });
  expect(plan.at(3)[0]).toMatchObject({
    tokens: [
      { type: "strong" },
      { type: "text" },
      { type: "link", href: "https://example.com", tokens: [{ text: "third " }] },
    ],
  });
});

it("gives punctuation and longer words distinct rhythm and accents", () => {
  expect(["One", "two", "extraordinary", "done."].map(replyWordFeedback)).toEqual([
    "soft",
    "selection",
    "soft",
    "light",
  ]);
  expect(replyWordDelay("end.")).toBeGreaterThan(replyWordDelay("pause,"));
  expect(replyWordDelay("pause,")).toBeGreaterThan(replyWordDelay("word"));
});
