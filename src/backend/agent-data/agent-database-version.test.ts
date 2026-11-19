import { type ChildProcess, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { DatabaseSync } from "node:sqlite";
import { Effect } from "effect";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  AGENT_DATABASE_METADATA_TABLE,
  AGENT_DATABASE_SCHEMA_VERSION,
  type AgentDatabaseHostMessage,
  type AgentDatabaseHostProcess,
} from "./agent-database-protocol";
import { AgentDatabaseSupervisor } from "./agent-database-supervisor";
import { AgentTables } from "./agent-tables";

const HOST = resolve(import.meta.dirname, "agent-database-host.ts");
const NEWER = "A newer version of OpenBot made the shared tables file";

let root = "";
const children: ChildProcess[] = [];
const opened: AgentTables[] = [];

function stdioHost(): AgentDatabaseHostProcess {
  const child = spawn(
    process.platform === "win32" ? "node.exe" : "node",
    ["--disable-warning=ExperimentalWarning", HOST],
    {
      stdio: ["pipe", "pipe", "inherit"],
    },
  );
  children.push(child);
  const listeners: ((message: AgentDatabaseHostMessage) => void)[] = [];
  createInterface({ input: child.stdout }).on("line", (line) => {
    const message: AgentDatabaseHostMessage = JSON.parse(line);
    for (const listener of listeners) listener(message);
  });
  return {
    send: (request) => child.stdin.write(`${JSON.stringify(request)}\n`),
    onMessage: (listener) => listeners.push(listener),
    onExit: (listener) => child.once("exit", (code) => listener(code)),
    kill: () => child.kill("SIGKILL"),
  };
}

async function releasedFile(name: string, userVersion: number): Promise<{ sharedRoot: string; path: string }> {
  const sharedRoot = join(root, name);
  await mkdir(join(sharedRoot, "Data"), { recursive: true });
  const path = join(sharedRoot, "Data", "agent-data.db");
  const database = new DatabaseSync(path);
  database.exec(
    `CREATE TABLE ${AGENT_DATABASE_METADATA_TABLE} (table_name TEXT PRIMARY KEY, owner_agent_id TEXT NOT NULL, created_at TEXT NOT NULL)`,
  );
  database.exec("CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL)");
  database.exec("INSERT INTO notes (body) VALUES ('first'), ('second')");
  database.exec(`INSERT INTO ${AGENT_DATABASE_METADATA_TABLE} VALUES ('notes', 'agent-a', '2026-10-01T00:00:00.000Z')`);
  if (userVersion !== 0) database.exec(`PRAGMA user_version = ${userVersion}`);
  database.close();
  return { sharedRoot, path };
}

function tables(sharedRoot: string): AgentTables {
  const agentTables = new AgentTables({
    sharedRoot,
    supervisor: new AgentDatabaseSupervisor({ spawnHost: stdioHost }),
  });
  opened.push(agentTables);
  return agentTables;
}

function inspect(path: string): { userVersion: number; notes: string[] } {
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    const version = database.prepare("PRAGMA user_version").get();
    const notes = database.prepare("SELECT body FROM notes ORDER BY id").all();
    return { userVersion: Number(version?.user_version), notes: notes.map((row) => String(row.body)) };
  } finally {
    database.close();
  }
}

async function digest(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

async function stopHosts(): Promise<void> {
  for (const agentTables of opened.splice(0)) agentTables.dispose();
  await Promise.all(
    children
      .splice(0)
      .filter((child) => child.exitCode === null && child.signalCode === null)
      .map((child) => new Promise((done) => child.once("exit", done))),
  );
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "openbot-agent-database-version-"));
});

afterEach(stopHosts);

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("agent database schema version", () => {
  it("opens a released file with no version, keeps its rows and owner, and records version 1", async () => {
    const { sharedRoot, path } = await releasedFile("released", 0);
    const agentTables = tables(sharedRoot);

    const listed = await Effect.runPromise(agentTables.list());
    expect(
      listed.ok && listed.value.map(({ name, ownerAgentId, rowCount }) => ({ name, ownerAgentId, rowCount })),
    ).toEqual([{ name: "notes", ownerAgentId: "agent-a", rowCount: 2 }]);
    const written = await Effect.runPromise(
      agentTables.execute("agent-b", "INSERT INTO notes (body) VALUES (?)", ["third"]),
    );
    expect(written.ok).toBe(true);

    await stopHosts();
    expect(inspect(path)).toEqual({ userVersion: AGENT_DATABASE_SCHEMA_VERSION, notes: ["first", "second", "third"] });
  });

  it("refuses every read and write of a file from a newer release and leaves it unchanged", async () => {
    const { sharedRoot, path } = await releasedFile("newer", AGENT_DATABASE_SCHEMA_VERSION + 1);
    const before = await digest(path);
    const agentTables = tables(sharedRoot);

    const listed = await Effect.runPromise(agentTables.list());
    const queried = await Effect.runPromise(agentTables.query("SELECT body FROM notes", []));
    const inserted = await Effect.runPromise(
      agentTables.execute("agent-b", "INSERT INTO notes (body) VALUES ('lost')", []),
    );
    const dropped = await Effect.runPromise(agentTables.execute("agent-a", "DROP TABLE notes", []));
    for (const outcome of [listed, queried, inserted, dropped]) {
      expect(outcome.ok).toBe(false);
      expect(outcome.ok ? "" : outcome.message).toContain(NEWER);
    }

    await stopHosts();
    expect(await digest(path)).toBe(before);
    expect(inspect(path)).toEqual({ userVersion: AGENT_DATABASE_SCHEMA_VERSION + 1, notes: ["first", "second"] });
  });
});
