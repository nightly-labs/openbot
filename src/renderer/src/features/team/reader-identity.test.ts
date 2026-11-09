import type { ChannelPage, ServerSummary, TeamPresenceMember } from "@openbot/contracts/ipc";
import { describe, expect, it } from "vitest";
import { sentChannelMessageId } from "../channels/channel-conversation-rows";
import { currentReaderMember, isReaderAuthor } from "./reader-identity";

const owner: TeamPresenceMember = {
  id: "owner-a",
  username: "owner",
  email: null,
  name: null,
  role: "owner",
  createdAt: "",
  disabled: false,
  online: true,
  typingAgentId: null,
};
const teammate: TeamPresenceMember = {
  ...owner,
  id: "teammate",
  username: "other",
  email: "me@example.com",
  role: "member",
};
// biome-ignore lint/nursery/noUnsafeTypeAssertion: Only identity fields are used by these fixtures.
const localServer = { thisComputer: true, role: "owner" } as ServerSummary;
// biome-ignore lint/nursery/noUnsafeTypeAssertion: Only identity fields are used by these fixtures.
const remoteServer = { role: "owner" } as ServerSummary;

describe("currentReaderMember", () => {
  it("recognizes the local server owner regardless of cloud sign-in or a matching teammate", () => {
    for (const email of [null, "me@example.com", "another@example.com"]) {
      expect(currentReaderMember([teammate, owner], localServer, email)).toBe(owner);
    }
  });

  it("finds the stored owner message even when another member sends the same text", () => {
    const memberId = currentReaderMember([teammate, owner], localServer, "me@example.com")?.id ?? null;
    const reader = { memberId, accountUserId: null, onOwnComputer: false };
    const page = {
      messages: [
        { id: "other", sequence: 2, author: { kind: "member", id: teammate.id }, message: { text: "hello" } },
        { id: "mine", sequence: 3, author: { kind: "member", id: owner.id }, message: { text: "hello" } },
      ],
      // biome-ignore lint/nursery/noUnsafeTypeAssertion: The lookup only reads message identity, sequence and text.
    } as ChannelPage;
    expect(sentChannelMessageId(page, 1, "hello", (id) => isReaderAuthor(id, reader))).toBe("mine");
  });

  it("does not choose another member when the local password owner is missing or disabled", () => {
    for (const invalid of [[], [{ ...owner, disabled: true }], [{ ...owner, role: "member" as const }]]) {
      expect(currentReaderMember([...invalid, teammate], localServer, "me@example.com")).toBeUndefined();
    }
  });

  it("keeps cloud matching on remote servers and for non-owner connections", () => {
    for (const server of [remoteServer, { ...localServer, role: "member" as const }, undefined]) {
      expect(currentReaderMember([owner, teammate], server, " ME@example.com ")).toBe(teammate);
      expect(currentReaderMember([owner, teammate], server, null)).toBeUndefined();
    }
  });

  it("selects the owner from the provided server roster", () => {
    const otherOwner = { ...owner, id: "owner-b" };
    expect(currentReaderMember([owner], localServer, null)?.id).toBe("owner-a");
    expect(currentReaderMember([otherOwner], localServer, null)?.id).toBe("owner-b");
  });
});
