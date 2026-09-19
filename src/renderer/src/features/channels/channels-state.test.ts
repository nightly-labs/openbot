import { beforeEach, describe, expect, it } from "vitest";
import { CHANNEL_SELECTION_STORAGE_KEY, readChannelSelection, writeChannelSelection } from "./channel-selection";
import { emptyChannelDraft, toggleChannelMember } from "./channels-draft";

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

describe("channel selection storage", () => {
  let target: ReturnType<typeof storage>;

  beforeEach(() => {
    target = storage();
  });

  it("keeps selections separate for each account and server", () => {
    writeChannelSelection("user-1", "local", "channel-local", target);
    writeChannelSelection("user-1", "remote", "channel-remote", target);
    writeChannelSelection("user-2", "local", "channel-other", target);

    expect(readChannelSelection(target)).toEqual({
      "user-1": { local: "channel-local", remote: "channel-remote" },
      "user-2": { local: "channel-other" },
    });
  });

  it("removes only the selection that was closed", () => {
    writeChannelSelection("signed_out", "local", "channel-local", target);
    writeChannelSelection("signed_out", "remote", "channel-remote", target);
    writeChannelSelection("signed_out", "local", null, target);

    expect(readChannelSelection(target)).toEqual({ signed_out: { remote: "channel-remote" } });
  });

  it("ignores malformed stored data", () => {
    target.setItem(CHANNEL_SELECTION_STORAGE_KEY, "not json");

    expect(readChannelSelection(target)).toEqual({});
  });
});

describe("channel drafts", () => {
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
});
