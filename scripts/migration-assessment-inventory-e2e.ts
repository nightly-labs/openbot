// Generated source profile only. No application, provider, credential store or filesystem scan.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { AgentSummary } from "@openbot/contracts/ipc";
import {
  decodeMigrationAssessmentInventory,
  MIGRATION_ASSESSMENT_CATEGORIES,
} from "@openbot/contracts/ipc-migration-assessment";
import { Effect, Result } from "effect";
import { AgentRoutineStore } from "../src/backend/agent-routine-store";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { readMigrationAssessmentInventory } from "../src/main/migration-assessment-inventory";
import {
  MIGRATION_ASSESSMENT_EXPECTED_SCHEMA,
  MIGRATION_ASSESSMENT_TABLES,
} from "../src/main/migration-assessment-registry";

const root = resolve(import.meta.dirname, "../.openbot-build/migration-assessment-inventory-e2e");
const groups: Array<{ name: string; passed: boolean }> = [];
const now = "2026-01-01T12:00:00.000Z";
let base = "";
let database: OpenBotDatabase | null = null;

function db(): OpenBotDatabase {
  assert.ok(database);
  return database;
}
function agent(
  id: string,
  provider: AgentSummary["provider"] = "codex",
  access: AgentSummary["access"] = "full",
): AgentSummary {
  return {
    id,
    name: "PRIVATE_FIXTURE_AGENT",
    title: "Synthetic",
    description: "PRIVATE_FIXTURE_DESCRIPTION",
    notifications: false,
    provider,
    access,
    model: "synthetic-model",
    reasoningEffort: "medium",
    threadId: `thread-${id}`,
    workspacePath: join(base, "managed", "Agents", id),
    preview: "",
    updatedAt: now,
    avatarSeed: id,
    avatarHue: null,
    avatarUrl: null,
  };
}
function read() {
  return Effect.runPromise(
    readMigrationAssessmentInventory({
      connection: () => db().connection,
      userDataRoot: join(base, "profile"),
      managedRoot: join(base, "managed"),
      sourcePlatform: "darwin",
    }),
  );
}
async function check(name: string, run: () => Promise<void>) {
  try {
    await run();
    groups.push({ name, passed: true });
  } catch (error) {
    if (error instanceof Error) process.stderr.write(`${error.message}\n`);
    groups.push({ name, passed: false });
  }
  process.stdout.write(`${groups.at(-1)?.passed ? "pass" : "FAIL"} ${name}\n`);
}
async function hash(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}
async function durableHashes() {
  return {
    main: await hash(join(base, "profile", "openbot.db")),
    wal: await hash(join(base, "profile", "openbot.db-wal")),
  };
}

try {
  await mkdir(root, { recursive: true });
  base = await mkdtemp(join(root, "generated-"));
  database = new OpenBotDatabase(join(base, "profile"));
  await Effect.runPromise(database.initialize());
  const sourceAgent = agent("assessment-agent");
  db().replaceAgents("assessment-seed", [sourceAgent, agent("confined-agent", "grok", "workspace")], "agents.updated");
  const attachment = {
    id: "attachment-one",
    name: "PRIVATE_FIXTURE_ATTACHMENT",
    size: 7,
    kind: "file" as const,
    mimeType: "text/plain",
    previewKind: "text" as const,
    previewUrl: null,
  };
  db().persistConversationAndMailbox(
    {
      agentId: sourceAgent.id,
      threadId: sourceAgent.threadId,
      activeTurnId: null,
      revision: 0,
      messages: [
        {
          id: "message-one",
          author: "user",
          text: "PRIVATE_FIXTURE_MESSAGE",
          status: "completed",
          createdAt: now,
          attachments: [attachment],
        },
      ],
    },
    "conversation.saved",
    {},
    {
      messages: [],
      deliveries: [],
      drafts: [],
      pausedAgentIds: [],
      idempotency: {},
      reactions: [],
      generatedAttachments: [
        { ...attachment, path: join(base, "managed", "Shared", "Transfers", "missing-file"), sha256: "0".repeat(64) },
      ],
    },
    "mailbox.updated",
  );
  new AgentRoutineStore(db()).create(
    {
      agentId: sourceAgent.id,
      name: "PRIVATE_FIXTURE_ROUTINE",
      instruction: "Never run",
      active: true,
      timezone: "Etc/UTC",
      schedule: { kind: "daily", time: "13:00" },
    },
    new Date(now),
  );
  assert.ok(sourceAgent.threadId);
  db().bindProviderSession({
    threadId: sourceAgent.threadId,
    provider: "codex",
    externalSessionId: "PRIVATE_FIXTURE_SESSION",
    model: "synthetic-model",
    effort: "medium",
  });

  await check("latest generated schema has one static owner for each of79tables", async () => {
    const names = db()
      .connection.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name")
      .all()
      .map((row) => row.name);
    const registered = Object.values(MIGRATION_ASSESSMENT_TABLES).flat().sort();
    assert.equal(new Set(registered).size, 79);
    assert.deepEqual(registered, names);
    assert.equal(
      db().connection.prepare("SELECT max(version) AS v FROM schema_migrations").get()?.v,
      MIGRATION_ASSESSMENT_EXPECTED_SCHEMA,
    );
  });
  await check("actual facade data reports29categories and uninspected file and credential owners", async () => {
    const before = await durableHashes();
    const inventory = await read();
    assert.deepEqual(decodeMigrationAssessmentInventory(inventory), inventory);
    assert.deepEqual(
      inventory.categories.map((row) => row.category),
      [...MIGRATION_ASSESSMENT_CATEGORIES],
    );
    assert.equal(inventory.schema.recognized, true);
    assert.equal(inventory.categories.filter((row) => row.coverage === "metadata-counted").length, 18);
    assert.equal(inventory.categories.filter((row) => row.coverage === "not-inspected").length, 11);
    assert.equal(inventory.categories.find((row) => row.category === "agents")?.rowCount, 2);
    assert.equal(inventory.categories.find((row) => row.category === "attachments")?.rowCount, 2);
    assert.deepEqual(inventory.credentials, {
      coverage: "not-inspected",
      reauthentication: "unresolved",
      deviceBound: "unknown",
    });
    assert.deepEqual(await durableHashes(), before);
    for (const secret of [base, "PRIVATE_FIXTURE", "missing-file", "attachment-one", "assessment-agent"])
      assert.ok(!JSON.stringify(inventory).includes(secret));
  });
  await check("stored schedule and provider intent is read without starting work", async () => {
    const before = await durableHashes();
    const inventory = await read();
    assert.equal(inventory.liveState.activeRoutines, 1);
    assert.equal(inventory.liveState.providerSessions, 1);
    assert.equal(inventory.liveState.confinedProcessAgents, 1);
    assert.equal(inventory.liveState.workflowRuns, 0);
    assert.equal(inventory.liveState.countKind, "exact");
    assert.equal(db().connection.prepare("SELECT count(*) AS n FROM projection_routine_runs").get()?.n, 0);
    assert.deepEqual(await durableHashes(), before);
  });
  await check("named path references classify lexical prefix traps and retain empty summaries", async () => {
    const changed = {
      ...sourceAgent,
      additionalFolders: [
        join(base, "managed-other", "external"),
        "../relative",
        "file:///PRIVATE_FIXTURE",
        join(base, "profile", "config"),
      ],
      excludedFolders: ["C:\\PRIVATE_FIXTURE\\foreign", "\u0000invalid"],
    };
    db().replaceAgents("assessment-paths", [changed, agent("confined-agent", "grok", "workspace")], "agents.updated");
    db()
      .connection.prepare(
        `INSERT INTO projection_mcp_servers VALUES (?, ?, 'stdio', 0, '', '[]', '{}', '[]', '', '', '{}', 0, ?, ?)`,
      )
      .run("mcp-one", "PRIVATE_FIXTURE_MCP", now, now);
    const inventory = await read();
    assert.deepEqual(inventory.paths, {
      managed: 4,
      userData: 1,
      external: 1,
      relative: 2,
      uri: 1,
      invalid: 1,
      defaults: 1,
      summaryReferences: 1,
      truncated: false,
      coverage: "metadata-extracted",
      containment: "lexical-only",
      symlinks: "not-inspected",
    });
  });
  await check("malformed or future provider intent remains unknown instead of reporting zero", async () => {
    const row = db()
      .connection.prepare("SELECT agent_json AS data FROM projection_agents WHERE agent_id=?")
      .get(sourceAgent.id);
    assert.ok(row && typeof row.data === "string");
    db()
      .connection.prepare(
        "UPDATE projection_agents SET agent_json=json_set(agent_json, '$.provider', 'future-provider') WHERE agent_id=?",
      )
      .run(sourceAgent.id);
    const inventory = await read();
    assert.equal(inventory.liveState.countKind, "unknown");
    for (const [key, value] of Object.entries(inventory.liveState)) if (key !== "countKind") assert.equal(value, null);
    db().connection.prepare("UPDATE projection_agents SET agent_json=? WHERE agent_id=?").run(row.data, sourceAgent.id);
    db()
      .connection.prepare(
        "UPDATE projection_agents SET agent_json=json_set(agent_json, '$.access', 'future-access') WHERE agent_id=?",
      )
      .run(sourceAgent.id);
    assert.equal((await read()).liveState.countKind, "unknown");
    db().connection.prepare("UPDATE projection_agents SET agent_json=? WHERE agent_id=?").run(row.data, sourceAgent.id);
  });
  await check("oversized named JSON metadata is unknown without exporting its content", async () => {
    const row = db()
      .connection.prepare("SELECT agent_json AS data FROM projection_agents WHERE agent_id=?")
      .get(sourceAgent.id);
    assert.ok(row && typeof row.data === "string");
    db()
      .connection.prepare(
        "UPDATE projection_agents SET agent_json=json_set(agent_json, '$.description', ?) WHERE agent_id=?",
      )
      .run("PRIVATE_FIXTURE_CONTENT".repeat(13000), sourceAgent.id);
    const inventory = await read();
    assert.equal(inventory.liveState.countKind, "unknown");
    assert.ok(inventory.paths.invalid > 0);
    assert.ok(!JSON.stringify(inventory).includes("PRIVATE_FIXTURE_CONTENT"));
    db().connection.prepare("UPDATE projection_agents SET agent_json=? WHERE agent_id=?").run(row.data, sourceAgent.id);
  });
  await check("Windows path spelling uses declared source platform and component boundaries", async () => {
    const windows = {
      ...sourceAgent,
      workspacePath: "C:\\Managed\\Agents\\one",
      additionalFolders: [
        "C:\\Managed-other\\outside",
        "C:\\Profile\\inside",
        "C:\\Managed\\..\\outside",
        "file:///C:/PRIVATE_FIXTURE",
        "relative",
      ],
    };
    db().replaceAgents("assessment-windows", [windows], "agents.updated");
    const inventory = await Effect.runPromise(
      readMigrationAssessmentInventory({
        connection: () => db().connection,
        userDataRoot: "C:\\Profile",
        managedRoot: "C:\\Managed",
        sourcePlatform: "win32",
      }),
    );
    assert.equal(inventory.paths.userData, 1);
    assert.equal(inventory.paths.external, 4);
    assert.equal(inventory.paths.uri, 1);
    assert.equal(inventory.paths.managed, 1);
    db().replaceAgents("assessment-reset-windows", [sourceAgent], "agents.updated");
  });
  await check("each table has a row budget and clipped live intent is a lower bound", async () => {
    db().connection.exec(`WITH RECURSIVE numbers(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM numbers WHERE x<10001)
      INSERT INTO agent_waits(wait_id,agent_id,request_delivery_id,request_text,note,created_at)
      SELECT 'wait-'||x,'assessment-agent','delivery-'||x,'PRIVATE_FIXTURE_REQUEST','PRIVATE_FIXTURE_NOTE','${now}' FROM numbers`);
    const inventory = await read();
    assert.equal(inventory.categories.find((row) => row.category === "mailbox-queues")?.countKind, "at-least");
    assert.equal(inventory.liveState.waits, 10000);
    assert.equal(inventory.liveState.countKind, "at-least");
    db().connection.exec("DELETE FROM agent_waits");
  });
  await check("path reference budget is explicit while source files stay unopened", async () => {
    const many = Array.from({ length: 70 }, (_, index) => ({
      ...agent(`many-${index}`),
      additionalFolders: Array.from({ length: 32 }, (__, i) => join(base, "managed", `a-${index}-${i}`)),
      excludedFolders: Array.from({ length: 32 }, (__, i) => join(base, "managed", `x-${index}-${i}`)),
    }));
    db().replaceAgents("assessment-many-paths", many, "agents.updated");
    const inventory = await read();
    assert.equal(inventory.paths.truncated, true);
    assert.equal(inventory.paths.managed, 4096);
    db().replaceAgents("assessment-reset-paths", [sourceAgent], "agents.updated");
  });
  await check("future schema versions and oversized unknown names leave categories unverified", async () => {
    db().connection.exec("UPDATE schema_migrations SET version=50 WHERE version=49");
    const future = await read();
    assert.equal(future.schema.recognized, false);
    assert.equal(future.schema.observedVersion, 50);
    assert.ok(future.categories.every((row) => row.rowCount === null));
    db().connection.exec("UPDATE schema_migrations SET version=49 WHERE version=50");
    const longName = `PRIVATE_FIXTURE_${"x".repeat(130)}`;
    db().connection.exec(`CREATE TABLE ${longName}(value TEXT)`);
    const long = await read();
    assert.equal(long.schema.recognized, false);
    assert.equal(long.schema.unmappedTables, 1);
    assert.ok(!JSON.stringify(long).includes(longName));
    db().connection.exec(`DROP TABLE ${longName}`);
  });
  await check("unknown and missing schema owners refuse metadata coverage without touching bytes", async () => {
    db().connection.exec("CREATE TABLE PRIVATE_FIXTURE_UNMAPPED(value TEXT)");
    const before = await durableHashes();
    const unknown = await read();
    assert.equal(unknown.schema.recognized, false);
    assert.equal(unknown.schema.unmappedTables, 1);
    assert.equal(unknown.categories.filter((row) => row.coverage === "unrecognized-schema").length, 18);
    assert.equal(unknown.paths.coverage, "not-inspected");
    assert.equal(unknown.liveState.countKind, "unknown");
    assert.deepEqual(await durableHashes(), before);
    db().connection.exec("DROP TABLE PRIVATE_FIXTURE_UNMAPPED; DROP TABLE file_deletion_outbox");
    const missing = await read();
    assert.equal(missing.schema.recognized, false);
    assert.equal(missing.paths.coverage, "not-inspected");
    assert.ok(missing.categories.every((row) => row.rowCount === null));
  });
  await check("adapter failures expose fixed codes without source data", async () => {
    const result = await Effect.runPromise(
      Effect.result(
        readMigrationAssessmentInventory({
          connection: () => {
            throw new Error("PRIVATE_FIXTURE_SECRET");
          },
          userDataRoot: join(base, "profile"),
          managedRoot: join(base, "managed"),
          sourcePlatform: "darwin",
        }),
      ),
    );
    assert.ok(Result.isFailure(result));
    assert.deepEqual(result.failure.toJSON(), { _tag: "MigrationAssessmentInventoryFailure", code: "unavailable" });
  });
} finally {
  database?.close();
  database = null;
  await mkdir(root, { recursive: true });
  await writeFile(
    join(root, "report.json"),
    `${JSON.stringify(
      {
        syntheticOnly: true,
        groups,
        limits: [
          "metadata-only",
          "lexical-paths-only",
          "no-secret-or-file-reads",
          "no-process-quiescence-proof",
          "no-hard-SQLite-timeout",
        ],
      },
      null,
      2,
    )}\n`,
  );
  if (base) await rm(base, { recursive: true, force: true });
}
if (groups.some((group) => !group.passed)) process.exitCode = 1;
