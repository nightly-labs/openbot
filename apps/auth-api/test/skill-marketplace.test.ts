import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  enforceSubmissionLimits,
  inspectSkillArchive,
  SkillMarketplace,
  type SkillMarketplaceError,
} from "../src/server/skill-marketplace";

const encoder = new TextEncoder();

function archive(files: Record<string, string>): Uint8Array {
  return zipSync(Object.fromEntries(Object.entries(files).map(([name, value]) => [name, encoder.encode(value)])));
}

describe("skill marketplace archives", () => {
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

  it("reads author example text without including it in the instructions", () => {
    const result = inspectSkillArchive(
      archive({
        "SKILL.md":
          '---\nname: Notes\ndescription: Write notes.\nexample-prompt: "  Summarize the latest commits.  "\n---\n# Notes\nExplain changes.',
      }),
    );
    expect(result.examplePrompt).toBe("Summarize the latest commits.");
    expect(result.instructions).toBe("# Notes\nExplain changes.");
  });

  it.each([undefined, "", "   ", 4, { value: "text" }, "a".repeat(1_001)])(
    "keeps bundles usable with absent or invalid example text: %s",
    (example) => {
      const metadata = example === undefined ? "" : `example-prompt: ${JSON.stringify(example)}\n`;
      const result = inspectSkillArchive(
        archive({ "SKILL.md": `---\nname: Notes\ndescription: Write notes.\n${metadata}---\nInstructions` }),
      );
      expect(result.examplePrompt).toBeUndefined();
      expect(result.instructions).toBe("Instructions");
    },
  );

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

// A read-only catalog and in-memory bundle exercise both detail read paths.
function detailMarketplace(bundle: Uint8Array): SkillMarketplace {
  const row = {
    id: "notes",
    slug: "notes",
    installs: 0,
    featured: 0,
    name: "Notes",
    description: "Write notes.",
    category: "documents",
    version: 1,
    version_id: "v1",
    bundle_key: "bundle",
    bundle_sha256: "hash",
    files_json: '["SKILL.md"]',
    icon_key: null,
    updated_at: 0,
    creator_name: "Author",
    creator_email: "author@example.com",
    creator_avatar_url: null,
    show_creator_avatar: 0,
  };
  const unused = () => {
    throw new Error("Unexpected storage operation");
  };
  const statement: D1PreparedStatement = {
    bind: () => statement,
    first: async () => JSON.parse(JSON.stringify(row)),
    all: unused,
    run: unused,
    raw: unused,
  };
  const DB: D1Database = {
    prepare: () => statement,
    batch: unused,
    exec: unused,
    withSession: unused,
    dump: unused,
  };
  const response = () => new Response(Uint8Array.from(bundle).buffer);
  const SKILLS: R2Bucket = {
    get: async () => ({
      key: "bundle",
      version: "v1",
      size: bundle.length,
      etag: "hash",
      httpEtag: '"hash"',
      checksums: { toJSON: () => ({}) },
      uploaded: new Date(0),
      storageClass: "Standard",
      writeHttpMetadata: () => undefined,
      body: new ReadableStream(),
      bodyUsed: false,
      arrayBuffer: () => response().arrayBuffer(),
      bytes: async () => Uint8Array.from(bundle),
      text: () => response().text(),
      json: () => response().json(),
      blob: () => response().blob(),
    }),
    head: unused,
    put: unused,
    delete: unused,
    list: unused,
    createMultipartUpload: unused,
    resumeMultipartUpload: unused,
  };
  return new SkillMarketplace({ DB, SKILLS });
}

describe("skill detail examples", () => {
  it.each([true, false])(
    "returns optional author text in current and version detail reads: %s",
    async (withExample) => {
      const metadata = withExample ? "example-prompt: Summarize commits.\n" : "";
      const marketplace = detailMarketplace(
        archive({ "SKILL.md": `---\nname: Notes\ndescription: Write notes.\n${metadata}---\nExplain changes.` }),
      );
      for (const detail of [await marketplace.get("notes"), await marketplace.getVersion("notes", "v1")]) {
        expect(detail.instructions).toBe("Explain changes.");
        expect(detail.examplePrompt).toBe(withExample ? "Summarize commits." : undefined);
      }
    },
  );
});
