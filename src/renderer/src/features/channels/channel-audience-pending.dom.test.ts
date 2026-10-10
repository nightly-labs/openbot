import type { ChannelAudienceInput } from "@openbot/contracts/ipc";
import { beforeEach, expect, it, vi } from "vitest";
import { clearChannelAudience, pendingChannelAudience, saveChannelAudience } from "./channel-audience-pending";

const input = (operationId: string, channelId = "room"): ChannelAudienceInput => ({
  operationId,
  channelId,
  text: "Original",
  audience: { kind: "members", agentIds: ["a", "b"] },
  replyToMessageId: "reply",
  attachmentDraftIds: ["file"],
});
beforeEach(() => window.localStorage.clear());
it("pending audience storage preserves original evidence across scopes and clears only the matching operation", () => {
  saveChannelAudience("account/server", input("one"));
  saveChannelAudience("other/server", input("two"));
  expect(() => saveChannelAudience("account/server", input("changed"))).toThrow();
  clearChannelAudience("account/server", input("wrong"));
  expect(pendingChannelAudience("account/server", "room")).toEqual(input("one"));
  clearChannelAudience("account/server", input("one"));
  expect(pendingChannelAudience("account/server", "room")).toBeNull();
  expect(pendingChannelAudience("other/server", "room")).toEqual(input("two"));
});
it("pending audience bounds refuse before eviction and storage failure preserves earlier evidence", () => {
  for (let index = 0; index < 20; index++) saveChannelAudience("scope", input(`operation-${index}`, `room-${index}`));
  expect(() => saveChannelAudience("scope", input("overflow"))).toThrow();
  expect(pendingChannelAudience("scope", "room-0")).toEqual(input("operation-0", "room-0"));
  clearChannelAudience("scope", input("operation-19", "room-19"));
  vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => {
    throw new Error("Storage full");
  });
  expect(() => saveChannelAudience("scope", input("overflow"))).toThrow("Storage full");
  expect(pendingChannelAudience("scope", "room-0")).not.toBeNull();
});
it("pending audience byte bound rejects without dropping unconfirmed inputs", () => {
  const text = "x".repeat(90_000);
  for (let index = 0; index < 11; index++)
    saveChannelAudience("scope", { ...input(`operation-${index}`, `room-${index}`), text });
  expect(() => saveChannelAudience("scope", { ...input("overflow"), text })).toThrow();
  expect(pendingChannelAudience("scope", "room-0")?.text).toBe(text);
});
