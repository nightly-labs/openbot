import { expect, it } from "vitest";
import { emptyChannelDraft, toggleChannelMember } from "./channels-draft";

it("keeps a lead on a current member while members join and leave", () => {
  const draft = emptyChannelDraft();
  toggleChannelMember(draft, "chief", true);
  expect(draft.leadAgentId).toBe("chief");
  toggleChannelMember(draft, "research", true);
  expect(draft.leadAgentId).toBe("chief");
  toggleChannelMember(draft, "chief", false);
  expect(draft.leadAgentId).toBe("research");
  toggleChannelMember(draft, "research", false);
  expect(draft).toMatchObject({ members: [], leadAgentId: null });
});

it("leads with the member that was selected first after a removal and reselection", () => {
  const draft = emptyChannelDraft();
  toggleChannelMember(draft, "chief", true);
  toggleChannelMember(draft, "chief", false);
  toggleChannelMember(draft, "chief", true);
  toggleChannelMember(draft, "sales-outbound", true);
  expect(draft.members.map((member) => member.agentId)).toEqual(["chief", "sales-outbound"]);
  expect(draft.leadAgentId).toBe("chief");
});

it("gives each draft its own collections", () => {
  const first = emptyChannelDraft();
  toggleChannelMember(first, "chief", true);
  expect(first.members).toHaveLength(1);
  expect(emptyChannelDraft()).toMatchObject({ members: [], leadAgentId: null });
});
