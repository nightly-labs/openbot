import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { AgentMarketplace } from "../src/server/agent-marketplace";
import { SkillMarketplace } from "../src/server/skill-marketplace";

const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("marketplace catalog indexes migration", () => {
  it("preserves marketplace data and passes integrity checks", () => {
    const database = new DatabaseSync(":memory:");
    databases.push(database);
    database.exec("PRAGMA foreign_keys = ON; CREATE TABLE users(id TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT);");
    database.exec(migration("0009_skills_marketplace.sql"));
    database.exec(migration("0010_agents_marketplace.sql"));
    seedMarketplace(database);

    database.exec("BEGIN");
    database.exec(migration("0011_marketplace_catalog_indexes.sql"));
    database.exec("COMMIT");
    database.exec(migration("0011_marketplace_catalog_indexes.sql"));

    expect(count(database, "marketplace_skills")).toBe(1);
    expect(count(database, "marketplace_skill_versions")).toBe(1);
    expect(count(database, "marketplace_agents")).toBe(1);
    expect(count(database, "marketplace_agent_versions")).toBe(1);
    expect(
      database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'marketplace_%_catalog_%' ORDER BY name",
        )
        .all()
        .map((row) => row.name),
    ).toEqual([
      "marketplace_agents_catalog_installs",
      "marketplace_agents_catalog_updated",
      "marketplace_skills_catalog_installs",
      "marketplace_skills_catalog_updated",
    ]);
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(database.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  });
});

describe("marketplace presentation migration", () => {
  it("preserves listings and supports inserts from the old Worker", () => {
    const database = presentationDatabase();
    expect(database.prepare("SELECT category, description FROM marketplace_agent_versions").get()).toEqual({
      category: "other",
      description: "Description",
    });
    expect(database.prepare("SELECT show_creator_avatar FROM marketplace_agents").get()).toEqual({
      show_creator_avatar: 0,
    });
    database.exec(
      "INSERT INTO marketplace_agents(id, owner_user_id, created_at, updated_at) VALUES ('old-worker', 'user-1', 2, 2)",
    );
    expect(
      database.prepare("SELECT show_creator_avatar FROM marketplace_agents WHERE id = 'old-worker'").get(),
    ).toEqual({ show_creator_avatar: 0 });
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("stores the publisher's category and keeps consent when an older client submits a new version", async () => {
    const database = presentationDatabase();
    const agents = new AgentMarketplace({ DB: d1(database), SKILLS: unusedBucket() });
    const user = { id: "user-1", name: "Owner", email: "owner@example.com", avatarUrl: null };
    const snapshot = {
      botId: "local",
      name: "Writer",
      title: "Writes",
      description: "Writes clear documents.",
      avatarSeed: "writer",
      avatarHue: null,
      avatarUrl: null,
      skills: [],
      routines: [],
    };
    const published = await agents.submit({
      user,
      snapshot,
      avatar: null,
      category: "documents",
      showCreatorAvatar: true,
    });
    expect(published).toMatchObject({ category: "documents", showCreatorAvatar: true });
    await agents.review(published.id, "approved", null);
    expect((await agents.list({ category: "documents" })).agents.map((item) => item.name)).toEqual(["Writer"]);
    const next = await agents.submit({ user, snapshot, avatar: null, agentId: published.agentId });
    expect(next.showCreatorAvatar).toBe(true);
  });

  it("filters agent categories and publishes account photos only with the owner's consent", async () => {
    const database = presentationDatabase();
    const bindings = { DB: d1(database), SKILLS: unusedBucket() };
    const agents = new AgentMarketplace(bindings);
    const skills = new SkillMarketplace(bindings);
    expect((await skills.list({ query: "Owner" })).skills.map((item) => item.id)).toEqual(["skill-1"]);
    expect((await agents.list({ query: "Owner" })).agents.map((item) => item.id)).toEqual(["agent-1"]);
    database.exec("UPDATE users SET name = NULL");
    expect((await skills.list({ query: "owner@example.com" })).skills.map((item) => item.id)).toEqual(["skill-1"]);
    expect((await agents.list({ query: "owner@example.com" })).agents.map((item) => item.id)).toEqual(["agent-1"]);

    expect((await agents.list({ category: "coding" })).agents).toEqual([]);
    expect((await agents.list({ category: "other" })).agents.map((item) => item.id)).toEqual(["agent-1"]);
    database.exec("UPDATE marketplace_agent_versions SET category = 'coding'");
    expect((await agents.list({ category: "coding" })).agents.map((item) => item.id)).toEqual(["agent-1"]);
    for (const [service, id] of [
      [agents, "agent-1"],
      [skills, "skill-1"],
    ] as const) {
      const read = async () =>
        service === agents
          ? (await agents.list()).agents[0]?.creatorAvatarUrl
          : (await skills.list({})).skills[0]?.creatorAvatarUrl;
      expect(await read()).toBeNull();
      await expect(service.setCreatorAvatar("intruder", id, true)).rejects.toMatchObject({ status: 404 });
      await service.setCreatorAvatar("user-1", id, true);
      expect(await read()).toBe("/v1/avatars/user-1?v=one");
      database.exec("UPDATE users SET avatar_url = '/v1/avatars/user-1?v=two'");
      expect(await read()).toBe("/v1/avatars/user-1?v=two");
      database.exec("UPDATE users SET avatar_url = NULL");
      expect(await read()).toBeNull();
      database.exec("UPDATE users SET avatar_url = '/v1/avatars/user-1?v=one'");
      await service.setCreatorAvatar("user-1", id, false);
      expect(await read()).toBeNull();
    }
  });
});

function presentationDatabase(): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  databases.push(database);
  database.exec(
    "PRAGMA foreign_keys = ON; CREATE TABLE users(id TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT, avatar_url TEXT);",
  );
  database.exec(migration("0009_skills_marketplace.sql"));
  database.exec(migration("0010_agents_marketplace.sql"));
  seedMarketplace(database);
  database.exec(migration("0019_marketplace_presentation.sql"));
  database.exec("UPDATE users SET avatar_url = '/v1/avatars/user-1?v=one'");
  return database;
}

function d1(database: DatabaseSync): D1Database {
  return {
    prepare(query) {
      return statement(database, query);
    },
    batch() {
      throw new Error("Unused batch");
    },
    exec() {
      throw new Error("Unused exec");
    },
    withSession() {
      throw new Error("Unused session");
    },
    dump() {
      throw new Error("Unused dump");
    },
  };
}

function statement(database: DatabaseSync, query: string, values: SQLInputValue[] = []): D1PreparedStatement {
  return {
    bind(...input) {
      return statement(
        database,
        query,
        input.map((value) => {
          if (value === null || typeof value === "string" || typeof value === "number") return value;
          throw new Error("Invalid binding");
        }),
      );
    },
    async first<T>(column?: string): Promise<T | null> {
      const row = database.prepare(query).get(...values);
      return row ? JSON.parse(JSON.stringify(column ? row[column] : row)) : null;
    },
    async all<T>(): Promise<D1Result<T>> {
      return result(JSON.parse(JSON.stringify(database.prepare(query).all(...values))), 0);
    },
    async run<T>(): Promise<D1Result<T>> {
      return result([], Number(database.prepare(query).run(...values).changes));
    },
    raw() {
      throw new Error("Unused raw");
    },
  };
}

function result<T>(results: T[], changes: number): D1Result<T> {
  return {
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
  };
}

function unusedBucket(): R2Bucket {
  return {
    head() {
      throw new Error("Unused head");
    },
    get() {
      throw new Error("Unused get");
    },
    put() {
      throw new Error("Unused put");
    },
    delete() {
      throw new Error("Unused delete");
    },
    list() {
      throw new Error("Unused list");
    },
    createMultipartUpload() {
      throw new Error("Unused multipart");
    },
    resumeMultipartUpload() {
      throw new Error("Unused multipart");
    },
  };
}

function migration(name: string): string {
  return readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8");
}

function seedMarketplace(database: DatabaseSync): void {
  database.prepare("INSERT INTO users(id, email, name) VALUES (?, ?, ?)").run("user-1", "owner@example.com", "Owner");
  database
    .prepare("INSERT INTO marketplace_skills(id, slug, owner_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .run("skill-1", "skill-one", "user-1", 1, 1);
  database
    .prepare(
      `INSERT INTO marketplace_skill_versions(
        id, skill_id, version, name, description, category, status, bundle_key, bundle_sha256, files_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'approved', ?, ?, '[]', ?)`,
    )
    .run("skill-version-1", "skill-1", 1, "Skill", "Description", "productivity", "bundle.zip", "hash", 1);
  database
    .prepare("UPDATE marketplace_skills SET approved_version_id = ? WHERE id = ?")
    .run("skill-version-1", "skill-1");
  database
    .prepare("INSERT INTO marketplace_agents(id, owner_user_id, created_at, updated_at) VALUES (?, ?, ?, ?)")
    .run("agent-1", "user-1", 1, 1);
  database
    .prepare(
      `INSERT INTO marketplace_agent_versions(
        id, agent_id, version, name, title, description, avatar_seed, avatar_hue, skills_json, routines_json, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', '[]', 'approved', ?)`,
    )
    .run("agent-version-1", "agent-1", 1, "Agent", "Title", "Description", "seed", null, 1);
  database
    .prepare("UPDATE marketplace_agents SET approved_version_id = ? WHERE id = ?")
    .run("agent-version-1", "agent-1");
}

function count(database: DatabaseSync, table: string): number {
  return Number(database.prepare(`SELECT count(*) AS count FROM ${table}`).get()?.count ?? 0);
}
