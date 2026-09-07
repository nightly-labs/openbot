import type { ConversationMessage, ConversationSnapshot } from "@openbot/contracts/ipc";
import { describe, expect, it } from "vitest";
import { mergeProviderHistory, snapshotFromThread } from "./conversation-snapshots";

import { decodeThreadResponse } from "./protocol";

describe("provider conversation history", () => {
  it("restores Codex reasoning as thinking while keeping the answer separate", () => {
    const decoded = decodeThreadResponse({
      thread: {
        id: "thread-1",
        turns: [
          {
            id: "turn-1",
            status: "completed",
            items: [
              {
                id: "reasoning-1",
                type: "reasoning",
                summary: ["First step.", "Second step."],
                content: ["Raw content."],
              },
              { id: "answer-1", type: "agentMessage", phase: "final_answer", text: "Done." },
            ],
          },
        ],
      },
    });
    expect(snapshotFromThread("chief", decoded.thread, () => null).messages).toEqual([
      expect.objectContaining({ id: "reasoning-1", itemType: "commentary", text: "First step.\n\nSecond step." }),
      expect.objectContaining({ id: "answer-1", itemType: "final_answer", text: "Done." }),
    ]);
  });
  it("replaces provisional assistant IDs with canonical provider IDs", () => {
    const stored = snapshot([
      message("user-1", "user", "Plan the follow-ups"),
      message("item-3", "assistant", "Here is the follow-up plan", "final_answer"),
    ]);
    const imported = snapshot([
      message("user-1", "user", "Plan the follow-ups"),
      message("msg-canonical", "assistant", "Here is the follow-up plan", "final_answer"),
    ]);

    expect(mergeProviderHistory(stored, imported).messages.map((item) => item.id)).toEqual(["user-1", "msg-canonical"]);
  });

  it("keeps repeated messages when both canonical IDs exist in provider history", () => {
    const imported = snapshot([
      message("msg-1", "assistant", "Same reply", "final_answer"),
      message("msg-2", "assistant", "Same reply", "final_answer"),
    ]);

    expect(mergeProviderHistory(snapshot([]), imported).messages.map((item) => item.id)).toEqual(["msg-1", "msg-2"]);
  });
});

function snapshot(messages: ConversationMessage[]): ConversationSnapshot {
  return {
    agentId: "chief",
    threadId: "thread-1",
    activeTurnId: null,
    revision: 1,
    messages,
  };
}

function message(
  id: string,
  author: ConversationMessage["author"],
  text: string,
  itemType?: string,
): ConversationMessage {
  return {
    id,
    turnId: "turn-1",
    author,
    text,
    createdAt: "2026-08-25T08:00:00.000Z",
    status: "completed",
    itemType,
  };
}
