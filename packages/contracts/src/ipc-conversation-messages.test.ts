import { describe, expect, it } from "vitest";
import { isConversationMessage } from "./ipc-conversation-messages";

const question = {
  id: "action",
  header: "Send the letter?",
  question: "Send the letter?",
  isSecret: false,
  options: [{ label: "Send", description: "" }],
};

const message = {
  id: "question-prompt:turn-1:request-1",
  turnId: "turn-1",
  author: "assistant",
  text: "Question: Send the letter?",
  createdAt: "2026-10-08T10:00:00.000Z",
  status: "completed",
  itemType: "question_prompt",
  questionPrompt: { requestId: "request-1", questions: [question], resolution: null },
};

const uiBlock = {
  version: 1,
  blockId: "letter",
  spec: { type: "confirm", title: "Send the letter?", actions: [{ id: "send", label: "Send", style: "primary" }] },
  state: { status: "pending" },
};

describe("conversation message ui blocks", () => {
  it("accepts a message without a block and one with a valid block", () => {
    expect(isConversationMessage(message)).toBe(true);
    expect(isConversationMessage({ ...message, uiBlock })).toBe(true);
  });

  it("fails closed on a broken block", () => {
    expect(isConversationMessage({ ...message, uiBlock: null })).toBe(false);
    expect(isConversationMessage({ ...message, uiBlock: { ...uiBlock, spec: { type: "confirm" } } })).toBe(false);
    expect(isConversationMessage({ ...message, uiBlock: { ...uiBlock, state: { status: "unknown" } } })).toBe(false);
  });
});
