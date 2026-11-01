// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migrateOpenBotDatabase } from "./openbot-database-schema";

// Failure modes: migration 13 leaves a workspace root at `OpenBot/Bots` while it renames the leaf, misses the
// Windows or the JSON-escaped form of a path, changes a path that only looks like the root (`Botsy`, a user's own
// `Projects/OpenBot/Bots`), or keeps a partial rewrite after a failure.
const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function databaseAt(version: number): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  db.exec(`CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
    CREATE TEMP TRIGGER stop_at_version BEFORE INSERT ON schema_migrations WHEN new.version > ${version}
    BEGIN SELECT RAISE(ABORT, 'fixture stop'); END;`);
  expect(() => migrateOpenBotDatabase(db)).toThrow(`migration to version ${version + 1} failed`);
  db.exec("DROP TRIGGER stop_at_version");
  return db;
}

const posixUuid = "1b4e28ba-2fa1-41d2-883f-0016d3cca427";
const windowsUuid = "6fa459ea-ee8a-4ca4-894e-db77e160355e";
const posixWorkspace = `/Users/user/OpenBot/Bots/bot-${posixUuid}`;
const windowsWorkspace = `C:\\Users\\user\\OpenBot\\Bots\\bot-${windowsUuid}`;

// A message that quotes each kind of path. Only the first two are under a root that this database stored.
const quotedPaths = [
  `${posixWorkspace}/notes.md`,
  `${windowsWorkspace}\\plan.md`,
  "/Users/user/OpenBot/Botsy/keep.md",
  "/Users/user/Projects/OpenBot/Bots/repo/README.md",
];

function seed(db: DatabaseSync): void {
  const agent = db.prepare(
    `INSERT INTO projection_agents (agent_id, thread_id, model, updated_at, sort_order, agent_json, last_event_sequence)
     VALUES (?, ?, 'gpt-5', NULL, ?, ?, 1)`,
  );
  agent.run(`bot-${posixUuid}`, null, 0, JSON.stringify({ id: `bot-${posixUuid}`, workspacePath: posixWorkspace }));
  agent.run(
    `bot-${windowsUuid}`,
    null,
    1,
    JSON.stringify({ id: `bot-${windowsUuid}`, workspacePath: windowsWorkspace }),
  );
  // An id that the app did not generate keeps its spelling.
  agent.run(
    "chief",
    "openbot-thread-chief",
    2,
    JSON.stringify({ id: "chief", workspacePath: "/Users/user/OpenBot/Bots/chief" }),
  );
  db.exec(`INSERT INTO projection_threads
      (thread_id, agent_id, title, active_turn_id, created_at, updated_at, last_event_sequence)
    VALUES ('openbot-thread-chief', 'chief', 'Chief', NULL, '2026-03-01T09:00:00.000Z', '2026-03-01T09:00:00.000Z', 1)`);
  db.prepare(
    `INSERT INTO projection_thread_messages (thread_id, message_id, turn_id, author, status, item_type, created_at,
       ordinal, message_json, last_event_sequence)
     VALUES ('openbot-thread-chief', 'message-1', NULL, 'user', 'completed', NULL, '2026-03-01T09:00:00.000Z', 0, ?, 1)`,
  ).run(JSON.stringify({ id: "message-1", text: quotedPaths.join("\n") }));
  // A raw column, which holds the Windows separator once.
  db.prepare(
    `INSERT INTO projection_attachments
       (attachment_id, owner_kind, owner_id, name, path, metadata_json, created_at, last_event_sequence)
     VALUES ('file-1', 'draft', ?, 'plan.md', ?, '{}', '2026-03-01T09:00:00.000Z', 1)`,
  ).run(`bot-${windowsUuid}`, `${windowsWorkspace}\\plan.md`);
  db.prepare(
    `INSERT INTO file_deletion_outbox (id, path, reason, created_at, attempts, last_error)
     VALUES ('outbox-1', ?, 'attachment-deleted', '2026-03-01T09:00:00.000Z', 0, NULL)`,
  ).run(`${posixWorkspace}/old.md`);
}

function contents(db: DatabaseSync) {
  return {
    agents: db.prepare("SELECT agent_id, agent_json FROM projection_agents ORDER BY sort_order").all(),
    messages: db.prepare("SELECT message_json FROM projection_thread_messages").all(),
    attachments: db.prepare("SELECT owner_id, path FROM projection_attachments").all(),
    outbox: db.prepare("SELECT path FROM file_deletion_outbox").all(),
  };
}

function workspacePaths(db: DatabaseSync) {
  return db
    .prepare(
      "SELECT agent_id, json_extract(agent_json, '$.workspacePath') AS path FROM projection_agents ORDER BY sort_order",
    )
    .all();
}

describe("agent workspace root migration", () => {
  it("moves each stored root from OpenBot/Bots to OpenBot/Agents once, in every form", () => {
    const db = databaseAt(12);
    seed(db);
    migrateOpenBotDatabase(db);

    const posixAgent = `agent-${posixUuid}`;
    const windowsAgent = `agent-${windowsUuid}`;
    expect(workspacePaths(db)).toEqual([
      { agent_id: posixAgent, path: `/Users/user/OpenBot/Agents/${posixAgent}` },
      { agent_id: windowsAgent, path: `C:\\Users\\user\\OpenBot\\Agents\\${windowsAgent}` },
      // The root is a text substitution over the whole database, so it also moves an agent that keeps its id.
      // `AgentStore` then moves that directory at start-up.
      { agent_id: "chief", path: "/Users/user/OpenBot/Agents/chief" },
    ]);
    const message = db
      .prepare("SELECT json_extract(message_json, '$.text') AS text FROM projection_thread_messages")
      .get();
    expect(String(message?.text).split("\n")).toEqual([
      `/Users/user/OpenBot/Agents/${posixAgent}/notes.md`,
      `C:\\Users\\user\\OpenBot\\Agents\\${windowsAgent}\\plan.md`,
      "/Users/user/OpenBot/Botsy/keep.md",
      "/Users/user/Projects/OpenBot/Bots/repo/README.md",
    ]);
    expect(contents(db).attachments).toEqual([
      { owner_id: windowsAgent, path: `C:\\Users\\user\\OpenBot\\Agents\\${windowsAgent}\\plan.md` },
    ]);
    expect(contents(db).outbox).toEqual([{ path: `/Users/user/OpenBot/Agents/${posixAgent}/old.md` }]);
    expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 49 });
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  });

  it("rolls back every rewritten path after a failure, then retries", () => {
    const db = databaseAt(12);
    seed(db);
    const before = contents(db);
    db.exec(`CREATE TEMP TRIGGER fail_marker BEFORE INSERT ON schema_migrations WHEN new.version = 13
      BEGIN SELECT RAISE(ABORT, 'late failure'); END;`);
    expect(() => migrateOpenBotDatabase(db)).toThrow("migration to version 13 failed");
    expect(contents(db)).toEqual(before);
    expect(db.prepare("SELECT version FROM schema_migrations WHERE version = 13").all()).toEqual([]);
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });

    db.exec("DROP TRIGGER fail_marker");
    migrateOpenBotDatabase(db);
    expect(workspacePaths(db)).toEqual([
      { agent_id: `agent-${posixUuid}`, path: `/Users/user/OpenBot/Agents/agent-${posixUuid}` },
      { agent_id: `agent-${windowsUuid}`, path: `C:\\Users\\user\\OpenBot\\Agents\\agent-${windowsUuid}` },
      { agent_id: "chief", path: "/Users/user/OpenBot/Agents/chief" },
    ]);
  });
});
