import type { QueueEditInput, QueueEditState } from "@openbot/contracts/ipc";
import { expect, it, vi } from "vitest";
import { QueueEditSession } from "./queue-edit-session";

it("retries an uncertain save before later text and sends only the held delivery", async () => {
  let state: QueueEditState | null = {
    deliveryId: "held",
    revision: 1,
    text: "Original",
    attachments: [],
    replyToMessageId: null,
  };
  let loseResponse = true;
  const request = vi.fn(async (input: QueueEditInput) => {
    if (input.operation === "save") {
      state = {
        deliveryId: "held",
        revision: input.revision + 1,
        text: input.text,
        attachments: [],
        replyToMessageId: null,
      };
      if (loseResponse) {
        loseResponse = false;
        throw new Error("Response lost");
      }
      return state;
    }
    state = null;
    return null;
  });
  const session = new QueueEditSession("chief", state, request);
  await expect(session.save({ text: "First edit", attachmentDraftIds: [] })).rejects.toThrow("Response lost");
  await session.send({ text: "Last edit", attachmentDraftIds: [] });
  expect(request.mock.calls.map(([input]) => input)).toEqual([
    {
      agentId: "chief",
      deliveryId: "held",
      revision: 1,
      operation: "save",
      text: "First edit",
      attachmentDraftIds: [],
    },
    {
      agentId: "chief",
      deliveryId: "held",
      revision: 1,
      operation: "save",
      text: "First edit",
      attachmentDraftIds: [],
    },
    { agentId: "chief", deliveryId: "held", revision: 2, operation: "save", text: "Last edit", attachmentDraftIds: [] },
    { agentId: "chief", deliveryId: "held", revision: 3, operation: "send", text: "Last edit", attachmentDraftIds: [] },
  ]);
  expect(session.state).toBeNull();
});
