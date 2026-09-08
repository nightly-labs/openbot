import { expect, it } from "vitest";
import { emptyChannelDraft, toggleChannelMember } from "./channels-draft";

it("keeps a lead on a current member while members join and leave", () => {
  const draft = emptyChannelDraft();
  toggleChannelMember(draft, "chief", "Coordinates");
  expect(draft.leadAgentId).toBe("chief");
  toggleChannelMember(draft, "research", "Finds sources");
  expect(draft.leadAgentId).toBe("chief");
  toggleChannelMember(draft, "chief", null);
  expect(draft.leadAgentId).toBe("research");
  toggleChannelMember(draft, "research", null);
  expect(draft).toMatchObject({ members: [], leadAgentId: null });
});

it("leads with the member that was selected first after a removal and reselection", () => {
  const draft = emptyChannelDraft();
  toggleChannelMember(draft, "chief", "Coordinates");
  toggleChannelMember(draft, "chief", null);
  toggleChannelMember(draft, "chief", "Coordinates");
  toggleChannelMember(draft, "sales-outbound", "Prepares research");
  expect(draft.members.map((member) => member.agentId)).toEqual(["chief", "sales-outbound"]);
  expect(draft.leadAgentId).toBe("chief");
});

it("gives each draft its own collections", () => {
  const first = emptyChannelDraft();
  toggleChannelMember(first, "chief", "Coordinates");
  first.linkedThreadIds.push("thread-1");
  expect(emptyChannelDraft()).toMatchObject({ members: [], linkedThreadIds: [] });
});
