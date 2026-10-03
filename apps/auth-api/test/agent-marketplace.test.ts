import { describe, expect, it } from "vitest";
import { AgentMarketplace } from "../src/server/agent-marketplace";
import { runApiEffect } from "../src/server/effect-runtime";
import { migratedDatabase, sqliteD1 } from "./sqlite-d1";

// The catalog index in migration 0011 is featured, then updated_at, then id. Only all three name a
// row. Agent "a" and agent "d" share an updated_at across the featured flag, so a cursor that keeps
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

function catalogMarketplace(): AgentMarketplace {
  const database = migratedDatabase();
  database
    .prepare("INSERT INTO users(id, identity_key, email, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run("user-1", "identity-1", "owner@example.com", "Owner", 1, 1);
  const insertAgent = database.prepare(
    "INSERT INTO marketplace_agents(id, owner_user_id, installs, featured, created_at, updated_at) VALUES (?, ?, 0, ?, ?, ?)",
  );
  const insertVersion = database.prepare(
    `INSERT INTO marketplace_agent_versions(
      id, agent_id, version, name, title, description, avatar_seed, skills_json, routines_json, status, created_at, category
    ) VALUES (?, ?, 1, ?, ?, ?, 'seed', '[]', '[]', 'approved', ?, 'productivity')`,
  );
  const approve = database.prepare("UPDATE marketplace_agents SET approved_version_id = ? WHERE id = ?");
  for (const row of CATALOG) {
    insertAgent.run(row.id, "user-1", row.featured, row.updatedAt, row.updatedAt);
    insertVersion.run(`version-${row.id}`, row.id, row.id, row.id, row.id, row.updatedAt);
    approve.run(`version-${row.id}`, row.id);
  }
  return new AgentMarketplace({ DB: sqliteD1(database), SKILLS: unusedBucket() });
}

async function walkCatalog(marketplace: AgentMarketplace, legacy: boolean): Promise<string[]> {
  const seen: string[] = [];
  let cursor: string | undefined;
  for (let request = 0; request < 10; request += 1) {
    const result = await runApiEffect(marketplace.list({ limit: 2, ...(cursor ? { cursor } : {}) }));
    seen.push(...result.agents.map((agent) => agent.id));
    const last = result.agents.at(-1);
    if (!result.nextCursor || !last) return seen;
    // A client from before cursor v1 sent the updated_at of its last row. Every later request
    // echoes the cursor the server returned.
    cursor = legacy && request === 0 ? String(Date.parse(last.updatedAt)) : result.nextCursor;
  }
  throw new Error("The catalog walk did not end");
}

describe("agent marketplace catalog paging", () => {
  it("pages every agent in catalog order with the cursor the server returns", async () => {
    expect(await walkCatalog(catalogMarketplace(), false)).toEqual(CATALOG_ORDER);
  });

  it("still delivers every agent when a client holds a cursor from before cursor v1", async () => {
    // The v0 cursor cannot narrow the query, so the first page comes again. That page hands out a
    // v1 cursor, and the rest of the catalog follows it. No agent may go missing.
    const walked = await walkCatalog(catalogMarketplace(), true);
    expect([...new Set(walked)].sort()).toEqual(CATALOG_ORDER);
  });
});
