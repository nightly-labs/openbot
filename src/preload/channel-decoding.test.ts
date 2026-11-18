// @vitest-environment node

import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { decodeChannel, parseChannelCommand } from "@openbot/contracts/ipc";
import { describe, expect, it } from "vitest";

const CHANNEL = {
  id: "channel-1",
  name: "Prospectacao",
  title: "",
  instructions: "",
  members: [{ agentId: "agent-1" }],
  leadAgentId: "agent-1",
  archived: false,
  revision: 3,
  createdAt: "2026-11-09T00:00:00.000Z",
};

const save = (instructions: string) => ({
  type: "save",
  operationId: "operation-1",
  channelId: "channel-1",
  update: true,
  draft: { name: "Renamed", title: "", instructions, members: [{ agentId: "agent-1" }], leadAgentId: "agent-1" },
});

// #5929: a database can hold channel instructions over the 2,000-character limit. A read that
// refused them made the channel, and every save of it, fail with "Invalid channel response".
describe("stored channel instructions over the limit", () => {
  const long = "y".repeat(INPUT_LIMITS.agentDescription + 66);

  it("decodes the channel with its full instructions", () => {
    expect(decodeChannel({ ...CHANNEL, instructions: long }).instructions).toBe(long);
  });

  it("passes a save that sends the stored instructions with the other fields", () => {
    const command = parseChannelCommand(save(long));
    expect(command.type === "save" && command.draft.instructions).toBe(long);
  });

  it("still refuses instructions over the stored bound", () => {
    const tooLong = "y".repeat(INPUT_LIMITS.storedChannelInstructions + 1);
    expect(() => decodeChannel({ ...CHANNEL, instructions: tooLong })).toThrow("Invalid channel response.");
    expect(() => parseChannelCommand(save(tooLong))).toThrow();
  });
});

// #9141: a database can hold a channel whose lead is not a member. Startup reads every channel, so
// refusing that row stopped every provider from starting.
describe("stored channel lead that is not a member", () => {
  const members = [{ agentId: "agent-1" }, { agentId: "agent-3" }];

  it("reads the lead as the first member", () => {
    expect(decodeChannel({ ...CHANNEL, members, leadAgentId: "agent-2" }).leadAgentId).toBe("agent-1");
  });

  it("reads no lead when the channel has no members", () => {
    expect(decodeChannel({ ...CHANNEL, members: [], leadAgentId: "agent-2" }).leadAgentId).toBeNull();
  });

  it("keeps a lead that is a member", () => {
    expect(decodeChannel({ ...CHANNEL, members, leadAgentId: "agent-3" }).leadAgentId).toBe("agent-3");
  });

  it("still refuses a save with that lead", () => {
    expect(() => parseChannelCommand({ ...save(""), draft: { ...save("").draft, leadAgentId: "agent-2" } })).toThrow();
  });
});
