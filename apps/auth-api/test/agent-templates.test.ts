import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { isAgentTemplateId } from "@openbot/contracts/agent-template-links";
import type { AgentTemplateSnapshot } from "@openbot/contracts/ipc";
import { afterEach, describe, expect, it } from "vitest";
import { AgentMarketplace } from "../src/server/agent-marketplace";
import { AgentTemplates } from "../src/server/agent-templates";

const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

const owner = { id: "user-1", name: "Owner", email: "owner@example.com", avatarUrl: null };
const intruder = { id: "user-2", name: "Other", email: "other@example.com", avatarUrl: null };
const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

function snapshot(overrides: Partial<AgentTemplateSnapshot> = {}): AgentTemplateSnapshot {
  return {
    name: "Writer",
    title: "Writes release notes",
    description: "Write clear release notes from merged work.",
    avatarSeed: "writer",
    avatarHue: null,
    skills: [
      { kind: "embedded", slug: "notes", name: "Notes", markdown: "---\nname: Notes\ndescription: Notes.\n---\nBody" },
    ],
    routines: [
      { name: "Daily notes", instruction: "Write notes.", active: true, schedule: { kind: "daily", time: "09:00" } },
    ],
    ...overrides,
  };
}

describe("agent templates", () => {
  it("publishes a template that anyone can read, and updates it in place", async () => {
    const { templates, bucket } = setup();
    const published = await templates.publish({
      user: owner,
      sourceAgentId: "local-agent",
      snapshot: { ...snapshot(), extra: "dropped" },
      avatar: { bytes: png, mimeType: "image/png" },
    });
    expect(isAgentTemplateId(published.id)).toBe(true);

    const detail = await templates.get(published.id);
    expect(detail).toMatchObject({ id: published.id, name: "Writer", creatorName: "Owner" });
    expect(detail).not.toHaveProperty("extra");
    expect(JSON.stringify(detail)).not.toContain("owner@example.com");
    expect(detail.avatarUrl).toMatch(new RegExp(`^/v1/agent-templates/${published.id}/avatar\\?v=`));
    expect(bucket.size).toBe(1);

    const republished = await templates.publish({
      user: owner,
      sourceAgentId: "local-agent",
      snapshot: snapshot({ name: "Writer 2", routines: [] }),
      avatar: null,
    });
    expect(republished.id).toBe(published.id);
    expect(await templates.get(published.id)).toMatchObject({ name: "Writer 2", routines: [], avatarUrl: null });
    expect(bucket.size).toBe(0);
    expect(await templates.listMine(owner.id)).toEqual([
      { id: published.id, sourceAgentId: "local-agent", updatedAt: republished.updatedAt },
    ]);
  });

  it("lets only the owner unpublish, and a removed template is not found", async () => {
    const { templates } = setup();
    const { id } = await templates.publish({ user: owner, sourceAgentId: "a", snapshot: snapshot(), avatar: null });

    await expect(templates.unpublish(intruder.id, id)).rejects.toMatchObject({ status: 404 });
    await expect(
      templates.publish({ user: intruder, sourceAgentId: "a", snapshot: snapshot({ name: "Taken" }), avatar: null }),
    ).resolves.not.toMatchObject({ id });
    expect((await templates.get(id)).name).toBe("Writer");

    await templates.unpublish(owner.id, id);
    await expect(templates.get(id)).rejects.toMatchObject({ status: 404 });
  });

  it.each<[string, Partial<AgentTemplateSnapshot>]>([
    [
      "a routine without an instruction",
      { routines: [{ name: "R", instruction: "", active: true, schedule: { kind: "daily", time: "09:00" } }] },
    ],
    ["an oversize skill", { skills: [{ kind: "embedded", slug: "big", name: "Big", markdown: "a".repeat(65_537) }] }],
    ["a skill slug with a path", { skills: [{ kind: "embedded", slug: "../x", name: "X", markdown: "x" }] }],
    [
      "an unapproved marketplace skill",
      { skills: [{ kind: "marketplace", skillId: "s", versionId: "v", slug: "s", name: "S", version: 1 }] },
    ],
  ])("refuses %s", async (_reason, overrides) => {
    const { templates } = setup();
    await expect(
      templates.publish({ user: owner, sourceAgentId: "a", snapshot: snapshot(overrides), avatar: null }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("is not listed in the agent marketplace", async () => {
    const { templates, database } = setup();
    await templates.publish({ user: owner, sourceAgentId: "a", snapshot: snapshot(), avatar: null });
    const marketplace = new AgentMarketplace({ DB: d1(database), SKILLS: memoryBucket() });
    expect((await marketplace.list()).agents).toEqual([]);
  });
});

function setup() {
  const database = new DatabaseSync(":memory:");
  databases.push(database);
  database.exec(
    "PRAGMA foreign_keys = ON; CREATE TABLE users(id TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT, avatar_url TEXT);",
  );
  for (const name of [
    "0009_skills_marketplace.sql",
    "0010_agents_marketplace.sql",
    "0019_marketplace_presentation.sql",
    "0021_agent_templates.sql",
  ])
    database.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
  database.prepare("INSERT INTO users(id, email, name) VALUES (?, ?, ?)").run(owner.id, owner.email, owner.name);
  database
    .prepare("INSERT INTO users(id, email, name) VALUES (?, ?, ?)")
    .run(intruder.id, intruder.email, intruder.name);
  const bucket = new Set<string>();
  return { database, bucket, templates: new AgentTemplates({ DB: d1(database), SKILLS: memoryBucket(bucket) }) };
}

function d1(database: DatabaseSync): D1Database {
  const unused = () => {
    throw new Error("Unused");
  };
  return {
    prepare: (query) => statement(database, query),
    batch: unused,
    exec: unused,
    withSession: unused,
    dump: unused,
  };
}

function statement(database: DatabaseSync, query: string, values: SQLInputValue[] = []): D1PreparedStatement {
  const result = <T>(results: T[], changes: number): D1Result<T> => ({
    success: true,
    results,
    meta: {
      changes,
      duration: 0,
      last_row_id: 0,
      changed_db: changes > 0,
      size_after: 0,
      rows_read: 0,
      rows_written: changes,
    },
  });
  return {
    bind: (...input) =>
      statement(
        database,
        query,
        input.map((value) => {
          if (value === null || typeof value === "string" || typeof value === "number") return value;
          throw new Error("Invalid binding");
        }),
      ),
    async first<T>(): Promise<T | null> {
      const row = database.prepare(query).get(...values);
      return row ? JSON.parse(JSON.stringify(row)) : null;
    },
    async all<T>(): Promise<D1Result<T>> {
      return result(JSON.parse(JSON.stringify(database.prepare(query).all(...values))), 0);
    },
    async run<T>(): Promise<D1Result<T>> {
      return result<T>([], Number(database.prepare(query).run(...values).changes));
    },
    raw() {
      throw new Error("Unused raw");
    },
  };
}

function memoryBucket(objects = new Set<string>()): R2Bucket {
  const unused = () => {
    throw new Error("Unused");
  };
  return {
    async put(key) {
      objects.add(key);
      return {
        key,
        version: "1",
        size: 0,
        etag: "etag",
        httpEtag: '"etag"',
        checksums: { toJSON: () => ({}) },
        uploaded: new Date(),
        storageClass: "Standard",
        customMetadata: {},
        httpMetadata: {},
        range: undefined,
        writeHttpMetadata() {},
      } satisfies R2Object;
    },
    async delete(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key);
    },
    head: unused,
    get: unused,
    list: unused,
    createMultipartUpload: unused,
    resumeMultipartUpload: unused,
  };
}
