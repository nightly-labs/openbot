import { describe, expect, it } from "vitest";
import { decodeMarketplaceAgentDetail, decodeMarketplaceAgentPage } from "./skills-decoding";

const SUMMARY = {
  category: "coding",
  id: "0f8fad5b-d9cb-469f-a165-70867728950e",
  name: "Release Scout",
  title: "Release manager",
  description: "Checks every release.",
  creatorName: "Ada",
  creatorAvatarUrl: null,
  version: 1,
  installs: 0,
  featured: true,
  avatarSeed: "scout",
  avatarHue: null,
  avatarUrl: null,
  skillCount: 0,
  routineCount: 0,
  activeRoutineCount: 0,
  updatedAt: "2026-10-31T00:00:00.000Z",
};

const DETAIL = { ...SUMMARY, versionId: "av-1", skills: [], routines: [] };

// The shield, the Verified filter and the trust line read these flags. A Worker before them sends
// none, and the agent is then a public one that OpenBot reviewed.
describe("Marketplace agent decoding", () => {
  it.each([true, false])("keeps verified %s in a catalog page", (verified) => {
    const page = decodeMarketplaceAgentPage({ agents: [{ ...SUMMARY, verified }], nextCursor: null });
    expect(page.agents[0]?.verified).toBe(verified);
  });

  it("keeps verified and pending in a listing", () => {
    expect(decodeMarketplaceAgentDetail({ ...DETAIL, verified: true, pending: true })).toMatchObject({
      verified: true,
      pending: true,
    });
  });

  it.each([
    ["absent", {}],
    ["not booleans", { verified: "yes", pending: 1 }],
  ])("leaves out flags that are %s", (_name, flags) => {
    const detail = decodeMarketplaceAgentDetail({ ...DETAIL, ...flags });
    expect(detail).not.toHaveProperty("verified");
    expect(detail).not.toHaveProperty("pending");
  });
});
