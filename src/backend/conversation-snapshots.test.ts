import type { ConversationMessage, ConversationSnapshot } from "@openbot/contracts/ipc";
import { describe, expect, it } from "vitest";
import {
  CURRENT_MESSAGE_SEPARATOR,
  combinedPromptInput,
  type DeliveryInputItem,
  deliveryPromptInput,
  HANDOFF_END,
  HANDOFF_START,
} from "./agent/delivery-content";
import { isMailboxMessageCopy, mergeProviderHistory, snapshotFromThread } from "./conversation-snapshots";
import type { DeliveryContext } from "./mailbox-store";

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
    expect(
      snapshotFromThread(
        "chief",
        decoded.thread,
        () => null,
        () => null,
      ).messages,
    ).toEqual([
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

  it("removes imported Claude task notifications and keeps delivered text", () => {
    const notice = "<task-notification>\n<status>stopped</status>\n</task-notification>";
    const delivered: ConversationMessage = {
      ...message("delivery-1", "user", notice),
      delivery: { id: "delivery-1", status: "completed", position: 0 },
    };
    const stored = snapshot([message("session-notice", "user", notice), delivered]);
    expect(mergeProviderHistory(stored, snapshot([]), "claude").messages).toEqual([delivered]);
  });

  it("removes imported Claude summaries, interrupt markers, and command output, and keeps every answer", () => {
    const summary = "This session is being continued from a previous conversation that ran out of context.";
    const kept = [
      message("user-1", "user", "Plan it"),
      message("turn-1:assistant", "assistant", "Done.", "agentMessage"),
      { ...message("copy-1", "assistant", "Done.", "agentMessage"), turnId: "summary-1" },
    ];
    const stored = snapshot([
      { ...message("summary-1", "user", `${summary}\n\nSummary: ...`), turnId: "summary-1" },
      ...kept,
      message("interrupt-1", "user", "[Request interrupted by user for tool use]"),
      message("command-output-1", "user", "<local-command-stdout>Compacted </local-command-stdout>"),
    ]);
    expect(mergeProviderHistory(stored, snapshot([]), "claude").messages).toEqual(kept);
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

  it("splits a released Claude turn that stored narration and the answer together", () => {
    /* A turn released before narration rode the thinking disclosure kept both in one message. The
       import now splits them, so the aggregate has to be matched whole or the backfill leaves the
       old bubble in place and adds the split copy beside it. */
    const aggregate = {
      ...message("turn-1:assistant", "assistant", "Let me read it.The file sets the timeout.", "agentMessage"),
      reaction: "\u{1f44d}" as const,
    };
    const imported = snapshot([
      message("part-1", "assistant", "Let me read it.", "commentary"),
      message("part-2", "assistant", "The file sets the timeout.", "agentMessage"),
    ]);
    const merged = mergeProviderHistory(snapshot([aggregate]), imported, "claude");
    expect(merged.messages).toEqual([
      expect.objectContaining({ id: "part-1", itemType: "commentary", text: "Let me read it." }),
      { ...aggregate, text: "The file sets the timeout." },
    ]);
    // A second startup finds the split shape already stored and changes nothing more.
    expect(mergeProviderHistory(merged, imported, "claude").messages).toEqual(merged.messages);
  });

  it("splits a released Claude turn that also stored its thinking", () => {
    /* Thinking has always been stored as commentary under `${turnId}:reasoning`, so a turn's
       reasoning must not be mistaken for its narration in either direction. */
    const reasoning = {
      ...message("turn-1:reasoning", "assistant", "Weighing it.", "commentary"),
      createdAt: "2026-08-25T08:00:00.000Z",
    };
    const aggregate = message(
      "turn-1:assistant",
      "assistant",
      "Let me read it.The file sets the timeout.",
      "agentMessage",
    );
    const imported = snapshot([
      reasoning,
      { ...message("part-1", "assistant", "Let me read it.", "commentary"), createdAt: "2026-08-25T08:00:01.000Z" },
      {
        ...message("part-2", "assistant", "The file sets the timeout.", "agentMessage"),
        createdAt: "2026-08-25T08:00:02.000Z",
      },
    ]);
    const merged = mergeProviderHistory(snapshot([reasoning, aggregate]), imported, "claude");
    expect(merged.messages).toEqual([
      reasoning,
      expect.objectContaining({ id: "part-1", itemType: "commentary", text: "Let me read it." }),
      { ...aggregate, text: "The file sets the timeout." },
    ]);
    expect(mergeProviderHistory(merged, imported, "claude").messages).toEqual(merged.messages);
  });

  it("takes the bubble off a released Claude turn that ended on its tool call", () => {
    /* Such a turn has narration and no answer at all, so nothing imports as an `agentMessage` and
       the turn is never reached by the reconciliation that walks those. */
    const bubble = {
      ...message("turn-1:assistant", "assistant", "Let me fix it.", "agentMessage"),
      reaction: "\u{1f44d}" as const,
    };
    const imported = snapshot([message("part-1", "assistant", "Let me fix it.", "commentary")]);
    const merged = mergeProviderHistory(snapshot([bubble]), imported, "claude");
    expect(merged.messages).toEqual([{ ...bubble, itemType: "commentary", text: "Let me fix it." }]);
    expect(mergeProviderHistory(merged, imported, "claude").messages).toEqual(merged.messages);
  });

  it("adds no second copy of narration a turn without an answer already stored", () => {
    const stored = snapshot([message("turn-1:narration:0", "assistant", "Let me fix it.", "commentary")]);
    const imported = snapshot([message("part-1", "assistant", "Let me fix it.", "commentary")]);
    expect(mergeProviderHistory(stored, imported, "claude").messages).toEqual(stored.messages);
  });

  it("leaves one visible answer when a turn's split rows are already stored", () => {
    /* A database can hold the aggregate and the canonical rows together. None of them is removed,
       because each can carry saved references, but only one may still read as an answer. */
    const aggregate = {
      ...message("turn-1:assistant", "assistant", "Before.After.", "agentMessage"),
      reaction: "\u{1f44d}" as const,
    };
    const stored = snapshot([
      aggregate,
      message("part-1", "assistant", "Before.", "agentMessage"),
      message("part-2", "assistant", "After.", "agentMessage"),
    ]);
    const imported = snapshot([
      message("part-1", "assistant", "Before.", "commentary"),
      message("part-2", "assistant", "After.", "agentMessage"),
    ]);
    const merged = mergeProviderHistory(stored, imported, "claude");
    expect(merged.messages.filter((item) => item.itemType !== "commentary")).toEqual([
      { ...aggregate, text: "After." },
    ]);
    expect(merged.messages.map((item) => item.id).toSorted()).toEqual(["part-1", "part-2", "turn-1:assistant"]);
    expect(mergeProviderHistory(merged, imported, "claude").messages).toEqual(merged.messages);
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

describe("teammate messages in provider history", () => {
  const agentNames = new Map([
    ["builder", "Builder (QA)"],
    ["tester", "Tester"],
  ]);
  const reply = teammateDelivery(
    "delivery-1",
    "message-1",
    "builder",
    "Status: done\nResult: Deployed.\nEvidence: none",
    {
      replyToMessageId: "request-1",
    },
  );
  const note = teammateDelivery("delivery-2", "message-2", "tester", "The staging host moved.", {
    expectsReply: false,
  });
  const promptText = (context: DeliveryContext) => {
    const [item] = deliveryPromptInput(context, { agentNames, snapshot: snapshot([]), routineRun: null });
    return item?.type === "text" ? item.text : "";
  };

  it("keeps the sender of a teammate message whose provider ID names no delivery", () => {
    const found = snapshotFromThread(
      "chief",
      providerThread(promptText(reply)),
      () => null,
      (messageId) => (messageId === "message-1" ? reply : null),
    );
    expect(found.messages).toEqual([
      expect.objectContaining({
        id: "delivery-1",
        author: "agent",
        senderAgentId: "builder",
        text: reply.delivery.text,
      }),
    ]);

    const [combined] = combinedPromptInput(
      [reply, note].map((context) =>
        deliveryPromptInput(context, { agentNames, snapshot: snapshot([]), routineRun: null }),
      ),
      ["planner"],
      agentNames,
    );
    const handoff = `${HANDOFF_START}\n--- previous transcript ---\n${HANDOFF_END}${CURRENT_MESSAGE_SEPARATOR}${combined?.type === "text" ? combined.text : ""}`;
    const rebuilt = snapshotFromThread(
      "chief",
      providerThread(handoff),
      () => null,
      () => null,
    );
    expect(rebuilt.messages).toEqual([
      expect.objectContaining({
        id: "provider-1",
        author: "agent",
        senderAgentId: "builder",
        replyToMessageId: "request-1",
        text: reply.delivery.text,
        exchange: expect.objectContaining({
          direction: "incoming",
          messageId: "message-1",
          recipientAgentIds: ["chief"],
        }),
      }),
      expect.objectContaining({
        id: "provider-1:message-2",
        author: "agent",
        senderAgentId: "tester",
        text: note.delivery.text,
        exchange: expect.objectContaining({ messageId: "message-2", expectsReply: false }),
      }),
    ]);
  });

  it("finds a stored user copy of a teammate message that the mailbox holds", () => {
    const copy = message("provider-1", "user", promptText(reply));
    const mailbox = new Map([
      ["message-1", { ...message("delivery-1", "agent", reply.delivery.text), senderAgentId: "builder" }],
    ]);
    expect(isMailboxMessageCopy(copy, mailbox)).toBe(true);
    expect(isMailboxMessageCopy(copy, new Map())).toBe(false);
    expect(isMailboxMessageCopy(message("user-1", "user", reply.delivery.text), mailbox)).toBe(false);
  });

  it("keeps the user's own words that share a turn or a message with a teammate prompt", () => {
    const mailbox = new Map([
      ["message-1", { ...message("delivery-1", "agent", reply.delivery.text), senderAgentId: "builder" }],
    ]);
    const pasted = message("user-1", "user", `${promptText(reply)}\n\nWhy is this shown as mine?`);
    expect(isMailboxMessageCopy(pasted, mailbox)).toBe(false);
    const quoted = message("user-2", "user", `Look at this:\n${promptText(reply)}`);
    expect(isMailboxMessageCopy(quoted, mailbox)).toBe(false);
    const separated = message("user-3", "user", `Why?${CURRENT_MESSAGE_SEPARATOR}${promptText(reply)}`);
    expect(isMailboxMessageCopy(separated, mailbox)).toBe(false);
    const appended = snapshotFromThread(
      "chief",
      providerThread(pasted.text),
      () => null,
      () => reply,
    );
    expect(appended.messages).toEqual([
      expect.objectContaining({ id: "provider-1", author: "user", text: pasted.text }),
    ]);

    const [combined] = combinedPromptInput(
      [deliveryPromptInput(reply, { agentNames, snapshot: snapshot([]), routineRun: null }), userText("Deploy now.")],
      [],
      agentNames,
    );
    const text = combined?.type === "text" ? combined.text : "";
    const imported = snapshotFromThread(
      "chief",
      providerThread(text),
      () => null,
      () => null,
    );
    expect(imported.messages).toEqual([expect.objectContaining({ id: "provider-1", author: "user", text })]);
    expect(isMailboxMessageCopy(message("provider-1", "user", text), mailbox)).toBe(false);
  });
});

function userText(text: string): DeliveryInputItem[] {
  return [{ type: "text", text }];
}

function teammateDelivery(
  id: string,
  messageId: string,
  senderAgentId: string,
  text: string,
  options: { replyToMessageId?: string; expectsReply?: false },
): DeliveryContext {
  return {
    delivery: {
      id,
      messageId,
      recipientAgentId: "chief",
      sender: { kind: "agent", agentId: senderAgentId },
      text,
      attachments: [],
      replyToMessageId: options.replyToMessageId ?? null,
      status: "completed",
      position: null,
      turnId: "turn-1",
      error: null,
      createdAt: "2026-08-25T08:00:00.000Z",
      ...(options.expectsReply === false ? { expectsReply: false } : {}),
    },
    managedAttachments: [],
  };
}

function providerThread(text: string) {
  return decodeThreadResponse({
    thread: {
      id: "thread-1",
      turns: [
        {
          id: "provider-1",
          status: "completed",
          items: [{ id: "provider-1", type: "userMessage", clientId: "provider-1", content: [{ type: "text", text }] }],
        },
      ],
    },
  }).thread;
}

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
