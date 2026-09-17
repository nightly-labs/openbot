import type { ConversationMessage, QueueDelivery } from "@openbot/contracts/ipc";
import { expect, it } from "vitest";
import { projectChatMessages } from "./chat-messages";
import { decodeQueueEditDraft, orderedQueue, queueReceiptMessages, queueRowsWithHeldEdit } from "./queue-edit-draft";
import { retainConfirmedAttachments } from "./upload-chat-attachments";

const delivery: QueueDelivery = {
  id: "delivery-1",
  messageId: "message-1",
  recipientAgentId: "agent-1",
  sender: { kind: "user" },
  text: "Original",
  attachments: [],
  replyToMessageId: null,
  status: "queued",
  position: 1,
  turnId: null,
  error: null,
  createdAt: "2026-09-15T00:00:00Z",
};
it("restores the edit identity, text and attachment order without creating a second delivery", () => {
  const files = ["notes.txt", "image.png"].map((name, index) => ({
    id: `file-${index}`,
    name,
    mimeType: "text/plain",
    size: 5,
    kind: "file" as const,
    previewKind: "none" as const,
    previewUrl: null,
  }));
  const draft = {
    initialized: true,
    editId: "edit-1",
    delivery: { ...delivery, attachments: files },
    text: "Changed",
    keepAttachmentIds: files.map((item) => item.id).reverse(),
  };
  expect(decodeQueueEditDraft(JSON.stringify(draft))).toEqual({ ...draft, addedAttachments: [] });
  expect(decodeQueueEditDraft(null)).toBeNull();
  expect(() => decodeQueueEditDraft('{"editId": "wrong"}')).toThrow("saved queue edit");
});
it("orders queued deliveries by host position without mutating the received snapshot", () => {
  const rows = [
    { ...delivery, id: "second", position: 2 },
    { ...delivery, id: "done", status: "completed" as const },
    delivery,
  ];
  expect(orderedQueue(rows).map((item) => item.id)).toEqual(["delivery-1", "second"]);
  expect(rows[0].id).toBe("second");
});
it("keeps the held delivery in the list the host no longer reports", () => {
  const second = { ...delivery, id: "second", position: 2 };
  expect(queueRowsWithHeldEdit([second], delivery).map((item) => item.id)).toEqual(["delivery-1", "second"]);
  expect(queueRowsWithHeldEdit([delivery, second], delivery).map((item) => item.id)).toEqual(["delivery-1", "second"]);
  expect(queueRowsWithHeldEdit([second], null).map((item) => item.id)).toEqual(["second"]);
});
it("breaks queue ties by arrival so receipts keep the host order", () => {
  const rows = [
    { ...delivery, id: "later", position: null, createdAt: "2026-09-15T00:00:02Z" },
    { ...delivery, id: "earlier", position: null, createdAt: "2026-09-15T00:00:01Z" },
  ];
  expect(orderedQueue(rows).map((item) => item.id)).toEqual(["earlier", "later"]);
  expect(queueReceiptMessages(rows).map((item) => item.id)).toEqual(["earlier", "later"]);
});
it("keeps queued and cancelled messages out of chat while a streamed response updates", () => {
  const message: ConversationMessage = {
    id: "message-1",
    author: "user",
    text: "Next",
    status: "completed",
    createdAt: "2026-09-15T00:00:00Z",
    delivery: { id: delivery.id, status: "queued", position: 1 },
  };
  const streamed: ConversationMessage = {
    ...message,
    id: "answer",
    author: "assistant",
    text: "Working",
    status: "streaming",
    delivery: undefined,
  };
  expect(projectChatMessages([message, streamed]).map((item) => item.id)).toEqual(["answer"]);
  expect(
    projectChatMessages([{ ...message, delivery: { id: delivery.id, status: "cancelled", position: null } }]),
  ).toEqual([]);
  expect(
    projectChatMessages([{ ...message, delivery: { id: delivery.id, status: "running", position: null } }]).map(
      (item) => item.id,
    ),
  ).toEqual([message.id]);
});

it("confirms a queued send by delivery ID and retains its attachment without waiting for history", () => {
  const attachment = {
    id: "stored-image",
    name: "image.png",
    mimeType: "image/png",
    size: 3,
    kind: "image" as const,
    previewKind: "image" as const,
    previewUrl: null,
  };
  const file = { name: "image.png", mimeType: "image/png", base64: "YWJj", uri: "file:///image.png" };
  const retained: string[] = [];
  expect(
    retainConfirmedAttachments(
      queueReceiptMessages([{ ...delivery, attachments: [attachment] }]),
      delivery.id,
      [file],
      (id) => retained.push(id),
    ),
  ).toBe(true);
  expect(retained).toEqual([attachment.id]);
});
