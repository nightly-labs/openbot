import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  enforceSubmissionLimits,
  inspectSkillArchive,
  type SkillMarketplaceError,
} from "../src/server/skill-marketplace";

const encoder = new TextEncoder();

function archive(files: Record<string, string>): Uint8Array {
  return zipSync(Object.fromEntries(Object.entries(files).map(([name, value]) => [name, encoder.encode(value)])));
}

describe("skill marketplace archives", () => {
  it("rejects a ZIP64 entry without its required extra field", () => {
    // Central directory, ZIP64 end record, locator, and end record. The compressed
    // size requests ZIP64, but the central directory has no ZIP64 extra field.
    const bytes = new Uint8Array(162);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, 0x02014b50, true);
    view.setUint32(20, 0xffffffff, true);
    view.setUint32(64, 0x06064b50, true);
    view.setUint32(96, 1, true);
    view.setUint32(120, 0x07064b50, true);
    view.setUint32(128, 64, true);
    view.setUint32(140, 0x06054b50, true);
    view.setUint16(148, 0xffff, true);
    expect(() => inspectSkillArchive(bytes)).toThrowError(
      expect.objectContaining<Partial<SkillMarketplaceError>>({ code: "invalid_archive" }),
    );
  });

  it("parses a skill directory and strips one ZIP wrapper", () => {
    const result = inspectSkillArchive(
      archive({
        "my-skill/SKILL.md":
          "---\nname: Release Notes\ndescription: Turns merged work into clear release notes.\n---\n",
        "my-skill/references/template.md": "Template",
      }),
    );
    expect(result).toEqual({
      name: "Release Notes",
      description: "Turns merged work into clear release notes.",
      slug: "release-notes",
      files: ["SKILL.md", "references/template.md"],
      instructions: "",
    });
  });

  it.each([
    ["../secret.txt", "unsafe_archive"],
    [".env", "unsafe_archive"],
    ["payload.zip", "unsafe_archive"],
  ])("rejects unsafe file %s", (name, code) => {
    expect(() =>
      inspectSkillArchive(
        archive({
          "SKILL.md": "---\nname: Safe Skill\ndescription: A valid description.\n---\n",
          [name]: "unsafe",
        }),
      ),
    ).toThrowError(expect.objectContaining<Partial<SkillMarketplaceError>>({ code }));
  });

  it("requires valid root metadata", () => {
    expect(() => inspectSkillArchive(archive({ "SKILL.md": "No frontmatter" }))).toThrow("YAML frontmatter");
    expect(() =>
      inspectSkillArchive(archive({ "nested/SKILL.md": "---\nname: Only\ndescription: Wrapper is okay.\n---\n" })),
    ).not.toThrow();
  });
});

describe("skill marketplace submission limits", () => {
  it("rejects a sixth skill owned by the same user", () => {
    expect(() => enforceSubmissionLimits({ skillCount: 5 })).toThrowError(
      expect.objectContaining<Partial<SkillMarketplaceError>>({ status: 409, code: "skill_limit" }),
    );
  });

  it("rejects a sixth version of the same skill", () => {
    expect(() => enforceSubmissionLimits({ versionCount: 5 })).toThrowError(
      expect.objectContaining<Partial<SkillMarketplaceError>>({ status: 409, code: "skill_version_limit" }),
    );
  });

  it("allows the fifth skill and fifth version", () => {
    expect(() => enforceSubmissionLimits({ skillCount: 4, versionCount: 4 })).not.toThrow();
  });
});
