import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  enforceSubmissionLimits,
  inspectSkillArchive,
  SkillMarketplace,
  type SkillMarketplaceError,
} from "../src/server/skill-marketplace";
import { migratedDatabase, sqliteD1 } from "./sqlite-d1";

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

// The catalog index in migration 0011 is featured, then updated_at, then id. Only all three name a
// row. Skill "a" and skill "d" share an updated_at across the featured flag, so a cursor that keeps
// the timestamp alone cannot say where the last page stopped.
const CATALOG = [
  { id: "a", featured: 1, updatedAt: 100 },
  { id: "b", featured: 1, updatedAt: 90 },
  { id: "c", featured: 1, updatedAt: 50 },
  { id: "d", featured: 0, updatedAt: 100 },
  { id: "e", featured: 0, updatedAt: 70 },
  { id: "f", featured: 0, updatedAt: 60 },
];
const CATALOG_ORDER = ["a", "b", "c", "d", "e", "f"];

function unusedBucket(): R2Bucket {
  const unused = () => {
    throw new Error("Unexpected storage operation");
  };
  return {
    get: unused,
    head: unused,
    put: unused,
    delete: unused,
    list: unused,
    createMultipartUpload: unused,
    resumeMultipartUpload: unused,
  };
}

function catalogMarketplace(): SkillMarketplace {
  const database = migratedDatabase();
  database
    .prepare("INSERT INTO users(id, identity_key, email, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run("user-1", "identity-1", "owner@example.com", "Owner", 1, 1);
  const insertSkill = database.prepare(
    "INSERT INTO marketplace_skills(id, slug, owner_user_id, featured, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const insertVersion = database.prepare(
    `INSERT INTO marketplace_skill_versions(
      id, skill_id, version, name, description, category, status, bundle_key, bundle_sha256, files_json, created_at
    ) VALUES (?, ?, 1, ?, ?, 'productivity', 'approved', ?, 'hash', '[]', ?)`,
  );
  const approve = database.prepare("UPDATE marketplace_skills SET approved_version_id = ? WHERE id = ?");
  for (const row of CATALOG) {
    insertSkill.run(row.id, row.id, "user-1", row.featured, row.updatedAt, row.updatedAt);
    insertVersion.run(`version-${row.id}`, row.id, row.id, row.id, `bundle-${row.id}`, row.updatedAt);
    approve.run(`version-${row.id}`, row.id);
  }
  return new SkillMarketplace({ DB: sqliteD1(database), SKILLS: unusedBucket() });
}

async function walkCatalog(marketplace: SkillMarketplace, legacy: boolean): Promise<string[]> {
  const seen: string[] = [];
  let cursor: string | undefined;
  for (let request = 0; request < 10; request += 1) {
    const result = await marketplace.list({ limit: 2, ...(cursor ? { cursor } : {}) });
    seen.push(...result.skills.map((skill) => skill.id));
    const last = result.skills.at(-1);
    if (!result.nextCursor || !last) return seen;
    // A client from before cursor v1 sent the updated_at of its last row. Every later request
    // echoes the cursor the server returned.
    cursor = legacy && request === 0 ? String(Date.parse(last.updatedAt)) : result.nextCursor;
  }
  throw new Error("The catalog walk did not end");
}

describe("skill marketplace catalog paging", () => {
  it("pages every skill in catalog order with the cursor the server returns", async () => {
    expect(await walkCatalog(catalogMarketplace(), false)).toEqual(CATALOG_ORDER);
  });

  it("still delivers every skill when a client holds a cursor from before cursor v1", async () => {
    // The v0 cursor cannot narrow the query, so the first page comes again. That page hands out a
    // v1 cursor, and the rest of the catalog follows it. No skill may go missing.
    const walked = await walkCatalog(catalogMarketplace(), true);
    expect([...new Set(walked)].sort()).toEqual(CATALOG_ORDER);
  });
});
