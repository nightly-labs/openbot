import { describe, expect, it } from "vitest";
import { sortConversationMessages } from "./conversation-order";
import type { ConversationMessage } from "./ipc-conversation-messages";

function message(id: string, createdAt: string, fields: Partial<ConversationMessage> = {}): ConversationMessage {
  return { id, author: "assistant", text: id, createdAt, status: "completed", ...fields };
}

describe("conversation order", () => {
  it("orders turns by their first message and a turn's messages by role", () => {
    const messages = [
      message("no-time", "not a date"),
      message("second-answer", "2026-09-23T10:05:00.000Z", { turnId: "turn-2" }),
      message("first-answer", "2026-09-23T10:00:01.000Z", { turnId: "turn-1" }),
      message("first-commentary", "2026-09-23T10:00:02.000Z", { turnId: "turn-1", itemType: "commentary" }),
      message("first-question", "2026-09-23T10:00:03.000Z", { turnId: "turn-1", author: "user" }),
      message("second-question", "2026-09-23T10:04:00.000Z", { turnId: "turn-2", author: "user" }),
    ];

    const sorted = sortConversationMessages(messages);

    expect(sorted).toBe(messages);
    expect(sorted.map(({ id }) => id)).toEqual([
      "first-question",
      "first-commentary",
      "first-answer",
      "second-question",
      "second-answer",
      "no-time",
    ]);
  });
});
