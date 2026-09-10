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

  it("keeps the stored Claude answer ID, timestamp, metadata, and reply references", () => {
    const answer = {
      ...message("turn-1:assistant", "assistant", "Before.After.", "agentMessage"),
      reaction: "👍" as const,
      reactions: [{ emoji: "👍" as const, actor: { kind: "user" as const } }],
      replyToMessageId: "user-1",
      attachments: [
        {
          id: "notes",
          name: "notes.txt",
          size: 4,
          kind: "file" as const,
          mimeType: "text/plain",
          previewKind: "text" as const,
          previewUrl: null,
        },
      ],
    };
    const reply = {
      ...message("reply", "user", "Thanks"),
      turnId: "turn-2",
      createdAt: "2026-08-25T08:01:00.000Z",
      replyToMessageId: answer.id,
    };
    const stored = snapshot([message("user-1", "user", "Plan it"), answer, reply]);
    const imported = snapshot([
      { ...message("part-1", "assistant", "Before.", "agentMessage"), createdAt: "2026-09-10T10:00:00.000Z" },
      { ...message("part-2", "assistant", "After.", "agentMessage"), createdAt: "2026-09-10T10:00:01.000Z" },
    ]);
    const merged = mergeProviderHistory(stored, imported, "claude");
    expect(merged.messages).toEqual(stored.messages);
    expect(mergeProviderHistory(merged, imported, "claude").messages).toEqual(stored.messages);
  });

  it("finishes an interrupted Claude answer without adding its imported parts", () => {
    const answer = {
      ...message("turn-1:assistant", "assistant", "Before.Af", "agentMessage"),
      status: "interrupted" as const,
    };
    const merged = mergeProviderHistory(
      snapshot([answer]),
      snapshot([
        message("part-1", "assistant", "Before.", "agentMessage"),
        message("part-2", "assistant", "After.", "agentMessage"),
      ]),
      "claude",
    );
    expect(merged.messages).toEqual([{ ...answer, text: "Before.After.", status: "completed" }]);
  });

  it.each(["Only reply.", "Before.After."])("preserves already imported Claude records: %s", (text) => {
    const parts =
      text === "Only reply."
        ? [message("part-1", "assistant", text, "agentMessage")]
        : [
            message("part-1", "assistant", "Before.", "agentMessage"),
            message("part-2", "assistant", "After.", "agentMessage"),
          ];
    const aggregate = { ...message("turn-1:assistant", "assistant", text, "agentMessage"), reaction: "👍" as const };
    const stored = snapshot([aggregate, ...parts]);
    expect(mergeProviderHistory(stored, snapshot(parts), "claude").messages).toEqual(stored.messages);
  });

  it("retains repeated canonical Claude replies and imports history without a live answer", () => {
    const imported = snapshot([
      message("part-1", "assistant", "Again.", "agentMessage"),
      message("part-2", "assistant", "Again.", "agentMessage"),
    ]);
    expect(mergeProviderHistory(snapshot([]), imported, "claude").messages).toEqual(imported.messages);
  });

  it("does not replace a Claude answer with incomplete or different provider text", () => {
    const answer = message("turn-1:assistant", "assistant", "Before.After.", "agentMessage");
    for (const text of ["Before.", "A different reply."]) {
      const part = message("part-1", "assistant", text, "agentMessage");
      expect(mergeProviderHistory(snapshot([answer]), snapshot([part]), "claude").messages).toEqual([answer, part]);
    }
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
