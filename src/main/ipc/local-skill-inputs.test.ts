import { describe, expect, it } from "vitest";
import {
  parseCreateLocalSkill,
  parseInstallLocalSkill,
  parseReadLocalSkill,
  parseReviseLocalSkill,
} from "./local-skill-inputs";

const skillId = "local-skill-11111111-1111-4111-8111-111111111111";
describe("local skill IPC inputs", () => {
  it("accepts workspace source and exact revisions", () => {
    expect(parseCreateLocalSkill({ agentId: "chief", sourcePath: "draft" })).toEqual({
      agentId: "chief",
      sourcePath: "draft",
    });
    expect(
      parseReviseLocalSkill({ agentId: "chief", sourcePath: "draft", skillId, expectedRevision: 1 }).expectedRevision,
    ).toBe(1);
    expect(parseInstallLocalSkill({ agentId: "chief", skillId, revision: 2 }).revision).toBe(2);
    expect(parseReadLocalSkill({ skillId })).toEqual({ skillId });
  });
  it.each([0, -1, 1.5, "2", Number.MAX_SAFE_INTEGER + 1])("rejects invalid revision %s", (revision) => {
    expect(() => parseInstallLocalSkill({ agentId: "chief", skillId, revision })).toThrow();
  });
  it("rejects missing identity, foreign IDs, and replacement bypasses", () => {
    expect(() => parseCreateLocalSkill({ sourcePath: "draft" })).toThrow();
    expect(() => parseReadLocalSkill({ skillId: "../../other" })).toThrow();
    expect(() => parseInstallLocalSkill({ agentId: "chief", skillId, revision: 1, replaceModified: true })).toThrow();
  });
});
