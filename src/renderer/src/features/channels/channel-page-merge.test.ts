import type { ChannelMessage } from "@openbot/contracts/ipc";
import { expect, it } from "vitest";
import { mergeChannelPage } from "./channel-page-merge";

function message(sequence: number): ChannelMessage {
  return {
    id: `m${sequence}`,
    channelId: "channel-1",
    sequence,
    author: { kind: "member", id: "person", name: "You" },
    taskId: null,
    superseded: false,
    message: {
      id: `m${sequence}`,
      author: "user",
      text: `Message ${sequence}`,
      createdAt: "2026-09-09T12:00:00.000Z",
      status: "completed",
      replyToMessageId: null,
    },
  };
}

it("keeps the loaded transcript when the fetched window continues it", () => {
  const merged = mergeChannelPage([message(1), message(2)], [message(3), message(4)]);
  expect(merged.messages.map((item) => item.sequence)).toEqual([1, 2, 3, 4]);
  expect(merged.takeFetchedCursor).toBe(false);
});

it("keeps the loaded transcript when the fetched window overlaps it", () => {
  const merged = mergeChannelPage([message(1), message(2), message(3)], [message(2), message(3), message(4)]);
  expect(merged.messages.map((item) => item.sequence)).toEqual([1, 2, 3, 4]);
  expect(merged.takeFetchedCursor).toBe(false);
});

it("drops the loaded transcript when messages arrived between the two blocks", () => {
  // Sequences 3 to 9 are outside the fetched window and outside the loaded block. Keeping the
  // loaded block would leave them unreachable, because its cursor starts below sequence 1.
  const merged = mergeChannelPage([message(1), message(2)], [message(10), message(11)]);
  expect(merged.messages.map((item) => item.sequence)).toEqual([10, 11]);
  expect(merged.takeFetchedCursor).toBe(true);
});

it("takes the fetched window and its cursor when nothing is loaded below it", () => {
  const merged = mergeChannelPage([], [message(1), message(2)]);
  expect(merged.messages.map((item) => item.sequence)).toEqual([1, 2]);
  expect(merged.takeFetchedCursor).toBe(true);
});
