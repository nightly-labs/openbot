import type { ConversationMessage, QueueDelivery } from "@openbot/contracts/ipc";
import { describe, expect, it } from "vitest";
import { latestReadableMessage, projectChatMessages, withFailureReasons } from "./chat-messages";

function planMessage(text: string, status: ConversationMessage["status"], plan?: ConversationMessage["plan"]) {
  return {
    id: "plan",
    turnId: "turn",
    author: "assistant",
    itemType: "plan",
    text,
    createdAt: "2026-09-28T10:00:00.000Z",
    status,
    ...(plan ? { plan } : {}),
  } satisfies ConversationMessage;
}

const answer = {
  id: "answer",
  turnId: "turn",
  author: "assistant",
  text: "Done.",
  createdAt: "2026-09-28T09:59:00.000Z",
  status: "completed",
} satisfies ConversationMessage;

describe("mobile plan messages", () => {
  it("reads the task list from the checklist text of a restored plan", () => {
    const [plan] = projectChatMessages([planMessage("Fix the build\n\n- [x] Read logs\n- [ ] Patch", "completed")]);
    expect(plan).toEqual({
      id: "plan",
      kind: "plan",
      heading: "Fix the build",
      explanation: null,
      stopped: false,
      steps: [
        { id: "0", text: "Read logs", state: "done" },
        { id: "1", text: "Patch", state: "pending" },
      ],
    });
  });

  it("shows the running step while the plan streams, and drops a cut last line", () => {
    const structured = projectChatMessages([
      planMessage("- [ ] Test", "streaming", {
        explanation: null,
        steps: [{ id: "a", text: "Test", activeText: "Running tests", status: "inProgress" }],
      }),
    ]);
    const cut = projectChatMessages([planMessage("- [x] Read logs\n- [", "streaming")]);
    expect([structured[0], cut[0]].map((item) => (item?.kind === "plan" ? item.steps : item?.kind))).toEqual([
      [{ id: "a", text: "Running tests", state: "active" }],
      [{ id: "0", text: "Read logs", state: "done" }],
    ]);
  });

  it("keeps text that is not a checklist as an ordinary message", () => {
    const [item] = projectChatMessages([planMessage("Some answer\n- not a checklist", "completed")]);
    expect(item?.kind === "message" && item.body).toBe("Some answer\n- not a checklist");
  });

  it("marks an interrupted plan as stopped and does not use a plan as the latest message", () => {
    const messages = [answer, planMessage("- [ ] Patch", "interrupted")];
    const plan = projectChatMessages(messages).find((item) => item.kind === "plan");
    expect([plan?.kind === "plan" && plan.stopped, latestReadableMessage(messages)?.id]).toEqual([true, "answer"]);
  });
});

function userMessage(id: string, status: ConversationMessage["status"]): ConversationMessage {
  return {
    id,
    author: "user",
    source: "user",
    text: `Question ${id}`,
    createdAt: `2026-09-28T10:00:0${id.length}.000Z`,
    status,
    delivery: { id, status: status === "failed" ? "failed" : "completed", position: null },
  };
}

function delivery(id: string, status: QueueDelivery["status"], error: string | null): QueueDelivery {
  return {
    id,
    messageId: `message-${id}`,
    recipientAgentId: "agent-1",
    sender: { kind: "user" },
    text: `Question ${id}`,
    attachments: [],
    replyToMessageId: null,
    status,
    position: null,
    turnId: `turn-${id}`,
    error,
    createdAt: "2026-09-28T10:00:00.000Z",
  };
}

function reasons(messages: ReturnType<typeof projectChatMessages>) {
  return messages.flatMap((message) =>
    message.kind === "message" ? [{ id: message.id, status: message.status, reason: message.failureReason }] : [],
  );
}

describe("withFailureReasons", () => {
  it("puts the reason of a failed delivery under its own user message only", () => {
    const projected = projectChatMessages([userMessage("a", "completed"), userMessage("bb", "failed")]);
    const result = withFailureReasons(projected, [
      delivery("a", "completed", null),
      delivery("bb", "failed", "You have hit your usage limit."),
    ]);
    expect(reasons(result)).toEqual([
      { id: "a", status: "completed", reason: undefined },
      { id: "bb", status: "failed", reason: "You have hit your usage limit." },
    ]);
  });

  it("keeps a failed message without a reason until the queue reports one", () => {
    const projected = projectChatMessages([userMessage("a", "failed")]);
    // Before the queue loads, after a reconnect, or for a delivery the host keeps no reason for.
    expect(reasons(withFailureReasons(projected, []))).toEqual([{ id: "a", status: "failed", reason: undefined }]);
    expect(reasons(withFailureReasons(projected, [delivery("a", "failed", null)]))).toEqual([
      { id: "a", status: "failed", reason: undefined },
    ]);
    const loaded = withFailureReasons(projected, [delivery("a", "failed", "Provider stopped.")]);
    expect(reasons(loaded)).toEqual([{ id: "a", status: "failed", reason: "Provider stopped." }]);
    // A refreshed queue with the same reason keeps the same item, so the row does not render again.
    expect(withFailureReasons(projected, [delivery("a", "failed", "Provider stopped.")])[0]).toBe(loaded[0]);
  });

  it("shows no reason after the message is sent again and its turn completes", () => {
    const projected = projectChatMessages([userMessage("a", "failed"), userMessage("bb", "completed")]);
    const result = withFailureReasons(projected, [
      delivery("a", "failed", "Provider stopped."),
      delivery("bb", "completed", null),
    ]);
    expect(reasons(result)).toEqual([
      { id: "a", status: "failed", reason: "Provider stopped." },
      { id: "bb", status: "completed", reason: undefined },
    ]);
  });
});

describe("mobile message senders", () => {
  const sent = (id: string, senderMember?: { id: string; name: string }) =>
    ({
      id,
      author: "user",
      text: `Message ${id}`,
      createdAt: "2026-09-28T10:00:00.000Z",
      status: "completed",
      ...(senderMember ? { senderMember } : {}),
    }) satisfies ConversationMessage;
  const authors = (messages: ReturnType<typeof projectChatMessages>) =>
    messages.flatMap((message) =>
      message.kind === "message" ? [{ id: message.id, author: message.author, sender: message.sender }] : [],
    );

  it("names another member, and keeps the reader's own and older messages as the reader's", () => {
    const messages = [
      sent("mine", { id: "member-self", name: "Me" }),
      sent("ada", { id: "member-ada", name: "Ada" }),
      sent("old"),
    ];
    expect(authors(projectChatMessages(messages, "member-self"))).toEqual([
      { id: "mine", author: "user", sender: undefined },
      { id: "ada", author: "user", sender: { id: "member-ada", name: "Ada" } },
      { id: "old", author: "user", sender: undefined },
    ]);
    // A server that is still connecting names no reader, so no message is shown as another person's.
    expect(authors(projectChatMessages(messages, "")).every((message) => message.sender === undefined)).toBe(true);
  });
});
