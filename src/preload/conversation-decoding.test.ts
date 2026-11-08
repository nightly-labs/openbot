// @vitest-environment node

import { describe, expect, it } from "vitest";
import { decodeAgentTask, decodeAgentTaskReadStates, decodeFilePreview } from "./conversation-decoding";

const preview = {
  name: "report.html",
  size: 1,
  mimeType: "text/html",
  previewKind: "text",
  bytes: new Uint8Array([60]),
};
const pageUrl = "openbot-visual://preview/6e25cdd3-e985-4b45-8f86-572bb037ed50";

describe("file preview page decoding", () => {
  it("keeps a temporary page address and accepts previews from main without it", () => {
    expect(decodeFilePreview({ ...preview, pageUrl })).toEqual({ ...preview, pageUrl });
    expect(decodeFilePreview(preview)).toEqual(preview);
  });

  it("rejects page addresses outside the isolated preview scheme", () => {
    for (const address of [
      "file:///private.html",
      "javascript:alert(1)",
      "https://example.com",
      "openbot-app://app/index.html",
      "openbot-visual://preview/../../private.html",
      `${pageUrl}?file=/private.html`,
      null,
      1,
    ]) {
      expect(() => decodeFilePreview({ ...preview, pageUrl: address })).toThrow("Invalid file preview response.");
    }
  });
});

const task = {
  id: "task-1",
  agentId: "agent-1",
  threadId: "thread-1",
  origin: "user",
  title: "Thread",
  state: "running",
  outcome: null,
  hold: null,
  activeTurnId: "turn-1",
  progress: null,
  error: null,
  queuedMessages: [{ deliveryId: "delivery-1", text: "next", createdAt: "2026-11-04T18:00:00.000Z" }],
  createdAt: "2026-11-04T18:00:00.000Z",
  updatedAt: "2026-11-04T18:00:00.000Z",
  closedAt: null,
};
const queued = {
  id: "delivery-1",
  messageId: "message-1",
  recipientAgentId: "agent-1",
  sender: { kind: "user" },
  text: "next",
  attachments: [],
  replyToMessageId: null,
  status: "queued",
  position: 1,
  turnId: null,
  error: null,
  createdAt: "2026-11-04T18:00:00.000Z",
};

describe("side thread queue decoding", () => {
  it("accepts a task with or without the full queue of its thread", () => {
    expect(decodeAgentTask(task)).toEqual(task);
    expect(decodeAgentTask({ ...task, queue: [queued] })).toEqual({ ...task, queue: [queued] });
  });

  it("rejects a queue that is not a list of queued messages", () => {
    for (const queue of [null, queued, [{ ...queued, status: "waiting" }], [{ ...queued, text: 1 }]]) {
      expect(() => decodeAgentTask({ ...task, queue })).toThrow("Invalid task response.");
    }
  });
});

describe("thread read state decoding", () => {
  const read = { taskId: "pricing", unreadCount: 2, firstUnreadMessageId: "m1", throughMessageId: "m0" };

  it("keeps a list of read states", () => {
    expect(decodeAgentTaskReadStates([read])).toEqual([read]);
    expect(decodeAgentTaskReadStates([])).toEqual([]);
  });

  it("rejects a value that is not a list of read states", () => {
    for (const value of [null, read, [{ ...read, taskId: "" }], [{ ...read, unreadCount: "2" }]]) {
      expect(() => decodeAgentTaskReadStates(value)).toThrow("Invalid thread read states.");
    }
  });
});
