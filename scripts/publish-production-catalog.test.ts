import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { createPublicationSql, type Publication, parsePublicationArguments } from "./publish-production-catalog";

describe("production catalog publication", () => {
  it("keeps local publication separate from explicit production writes", () => {
    expect(parsePublicationArguments([])).toEqual({ apply: false, target: "production" });
    expect(parsePublicationArguments(["--local", "--apply"])).toEqual({ apply: true, target: "local" });
    expect(parsePublicationArguments(["--apply", "--confirm-production"])).toEqual({
      apply: true,
      target: "production",
    });
    for (const args of [
      ["--apply"],
      ["--confirm-production"],
      ["--local", "--apply", "--confirm-production"],
      ["--remote"],
    ]) {
      expect(() => parsePublicationArguments(args)).toThrow();
    }
  });
  it("creates approved marketplace records owned by OpenBot without resetting marketplace counters", () => {
    const publication: Publication = {
      catalogVersion: "v1",
      skills: [
        {
          featured: true,
          id: "openbot-curated-skill-example",
          versionId: "openbot-curated-version-example-v1-deadbeefdeadbeef",
          slug: "example",
          name: "Example",
          description: "An example skill.",
          category: "productivity",
          version: 1,
          bundle: "skills/example.zip",
          bundleSha256: "a".repeat(64),
          files: ["LICENSE.txt", "NOTICE.txt", "SKILL.md"],
        },
      ],
      agents: [
        {
          featured: true,
          category: "research",
          id: "openbot-curated-agent-example",
          versionId: "openbot-curated-agent-version-example-v1-deadbeefdeadbeef",
          name: "Example Agent",
          title: "Example",
          description: "An example agent.",
          avatarSeed: "openbot-curated-agent-example",
          avatarHue: 120,
          version: 1,
          skills: [],
          routines: [],
        },
      ],
    };

    const sql = createPublicationSql(publication, 1234);
    const newer: Publication = {
      ...publication,
      catalogVersion: "v2",
      skills: publication.skills.map((skill) => ({ ...skill, version: 2, versionId: `${skill.versionId}-v2` })),
      agents: publication.agents.map((agent) => ({ ...agent, version: 2, versionId: `${agent.versionId}-v2` })),
    };

    expect(sql).toContain("'openbot-production-catalog'");
    expect(sql).toContain("'OpenBot Team'");
    expect(sql.match(/'approved'/gu)).toHaveLength(2);
    expect(sql).toContain("ON CONFLICT(id) DO NOTHING");
    expect(sql).not.toMatch(/DO UPDATE SET[^;]*(?:installs|featured)/u);
    expect(sql).toContain(
      "skills/openbot-curated-skill-example/versions/openbot-curated-version-example-v1-deadbeefdeadbeef.zip",
    );

    const verification = spawnSync("/usr/bin/sqlite3", [":memory:"], {
      encoding: "utf8",
      input: `${schema}\n${sql}\nCREATE TEMP TABLE initial AS SELECT (SELECT featured FROM marketplace_skills) AS skill_featured, (SELECT featured FROM marketplace_agents) AS agent_featured;\nUPDATE marketplace_skills SET installs = 8, featured = 0;\nUPDATE marketplace_agents SET installs = 5, featured = 0;\n${createPublicationSql(newer, 4567)}\n${createPublicationSql(publication, 5678)}\n.mode json\nSELECT (SELECT name FROM users WHERE id = 'openbot-production-catalog') AS owner, (SELECT installs FROM marketplace_skills) AS skill_installs, (SELECT featured FROM marketplace_skills) AS skill_featured, (SELECT installs FROM marketplace_agents) AS agent_installs, (SELECT featured FROM marketplace_agents) AS agent_featured, (SELECT status FROM marketplace_skill_versions) AS skill_status, (SELECT status FROM marketplace_agent_versions) AS agent_status, (SELECT category FROM marketplace_agent_versions) AS category, (SELECT skill_featured FROM initial) AS initial_skill_featured, (SELECT agent_featured FROM initial) AS initial_agent_featured, (SELECT count(*) FROM marketplace_skill_versions) AS skill_versions, (SELECT version FROM marketplace_skill_versions WHERE id = (SELECT approved_version_id FROM marketplace_skills)) AS approved_skill_version, (SELECT version FROM marketplace_agent_versions WHERE id = (SELECT approved_version_id FROM marketplace_agents)) AS approved_agent_version;\n`,
    });
    expect(verification.status).toBe(0);
    expect(JSON.parse(verification.stdout)).toEqual([
      {
        owner: "OpenBot Team",
        skill_installs: 8,
        skill_featured: 0,
        agent_installs: 5,
        agent_featured: 0,
        skill_status: "approved",
        agent_status: "approved",
        category: "research",
        initial_skill_featured: 1,
        initial_agent_featured: 1,
        skill_versions: 2,
        approved_skill_version: 2,
        approved_agent_version: 2,
      },
    ]);
  });
});

const schema = `
CREATE TABLE users (
  id TEXT PRIMARY KEY, identity_key TEXT NOT NULL UNIQUE, email TEXT NOT NULL UNIQUE, name TEXT,
  avatar_url TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE marketplace_skills (
  id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, owner_user_id TEXT NOT NULL REFERENCES users(id),
  approved_version_id TEXT, installs INTEGER NOT NULL DEFAULT 0, featured INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE marketplace_skill_versions (
  id TEXT PRIMARY KEY, skill_id TEXT NOT NULL REFERENCES marketplace_skills(id), version INTEGER NOT NULL,
  name TEXT NOT NULL, description TEXT NOT NULL, category TEXT NOT NULL, status TEXT NOT NULL,
  rejection_note TEXT, bundle_key TEXT NOT NULL UNIQUE, bundle_sha256 TEXT NOT NULL,
  files_json TEXT NOT NULL CHECK(json_valid(files_json)), icon_key TEXT, created_at INTEGER NOT NULL,
  reviewed_at INTEGER, UNIQUE(skill_id, version)
);
CREATE TABLE marketplace_agents (
  id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL REFERENCES users(id), approved_version_id TEXT,
  installs INTEGER NOT NULL DEFAULT 0, featured INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE marketplace_agent_versions (
  id TEXT PRIMARY KEY, agent_id TEXT NOT NULL REFERENCES marketplace_agents(id), version INTEGER NOT NULL,
  name TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL, avatar_seed TEXT NOT NULL,
  avatar_hue INTEGER, avatar_key TEXT, skills_json TEXT NOT NULL CHECK(json_valid(skills_json)),
  routines_json TEXT NOT NULL CHECK(json_valid(routines_json)), category TEXT NOT NULL DEFAULT 'other', status TEXT NOT NULL, rejection_note TEXT,
  created_at INTEGER NOT NULL, reviewed_at INTEGER, UNIQUE(agent_id, version)
);
`;
