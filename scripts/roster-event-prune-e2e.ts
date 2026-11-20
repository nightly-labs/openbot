import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_REASONING_EFFORTS, type AgentSummary } from "@openbot/contracts/ipc";
import { AgentStore } from "../src/backend/agent-store";
import type { AgentModelChange } from "../src/backend/database/agent-roster";
import { databaseRows, requiredStringColumn } from "../src/backend/database/database-rows";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { OpenBotDatabase } from "../src/backend/openbot-database";

const OUT = resolve(import.meta.dirname, "../.openbot-build/roster-event-prune-e2e");
const LEGACY_WRITES = 50;
const root = await mkdtemp(join(tmpdir(), "openbot-roster-event-prune-"));
const userData = join(root, "user-data");
const home = join(root, "home");

interface RosterEvents {
  total: number;
  audit: number;
  receipts: number;
}

interface Report {
  legacy?: RosterEvents;
  afterWrite?: RosterEvents;
  afterAuditWrite?: RosterEvents;
  afterDelete?: RosterEvents;
  agentsAfterRestart?: number;
  passed: boolean;
}

const report: Report = { passed: false };

async function boot<T>(use: (store: AgentStore, database: OpenBotDatabase) => T | Promise<T>): Promise<T> {
  const database = new OpenBotDatabase(userData);
  const store = new AgentStore(userData, home, database);
  await runCauseEffect(store.initialize());
  try {
    return await use(store, database);
  } finally {
    database.close();
  }
}

function rosterEvents(database: OpenBotDatabase): RosterEvents & { types: string[]; commandIds: string[] } {
  const rows = databaseRows(
    database.connection
      .prepare(
        `SELECT command_id, event_type FROM orchestration_events
         WHERE aggregate_type = 'agents' AND aggregate_id = 'agents' ORDER BY sequence`,
      )
      .all(),
  );
  const types = rows.map((row) => requiredStringColumn(row, "event_type"));
  const commandIds = rows.map((row) => requiredStringColumn(row, "command_id"));
  const receipts = commandIds.filter((commandId) => database.commandResult(commandId) !== undefined).length;
  return {
    total: rows.length,
    audit: types.filter((type) => type === "agent.model-changed").length,
    receipts,
    types,
    commandIds,
  };
}

function summary({ total, audit, receipts }: RosterEvents): RosterEvents {
  return { total, audit, receipts };
}

interface LegacyRosterPayload {
  agents: AgentSummary[];
  modelChange?: AgentModelChange;
}

function appendLegacyRosterEvent(
  database: OpenBotDatabase,
  commandId: string,
  eventType: string,
  payload: LegacyRosterPayload,
) {
  const db = database.connection;
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO orchestration_events
         (event_id, command_id, aggregate_type, aggregate_id, event_type, occurred_at, payload_json)
       VALUES (?, ?, 'agents', 'agents', ?, ?, ?)`,
    )
    .run(randomUUID(), commandId, eventType, new Date().toISOString(), JSON.stringify(payload));
  db.prepare(
    `INSERT INTO orchestration_command_receipts
       (command_id, accepted_at, first_sequence, last_sequence, result_json)
     VALUES (?, ?, ?, ?, 'null')`,
  ).run(commandId, new Date().toISOString(), Number(lastInsertRowid), Number(lastInsertRowid));
}

try {
  const { first, second, legacyCommandIds } = await boot(async (store, database) => {
    const first = await runCauseEffect(
      store.createAgent({ name: "First", description: "", avatarSeed: "seed-1", avatarHue: null }),
    );
    const second = await runCauseEffect(
      store.createAgent({ name: "Second", description: "", avatarSeed: "seed-2", avatarHue: null }),
    );
    const agents = store.list();
    const legacyCommandIds: string[] = [];
    database.connection.exec("BEGIN IMMEDIATE");
    for (let index = 0; index < LEGACY_WRITES; index += 1) {
      const commandId = `agents:agent.updated:${randomUUID()}`;
      legacyCommandIds.push(commandId);
      appendLegacyRosterEvent(database, commandId, "agent.updated", { agents });
    }
    appendLegacyRosterEvent(database, `agents:agent.model-changed:${randomUUID()}`, "agent.model-changed", {
      agents,
      modelChange: {
        initiatingAgentId: second.id,
        targetAgentId: first.id,
        previous: { provider: first.provider, model: first.model, reasoningEffort: first.reasoningEffort },
        next: { provider: first.provider, model: first.model, reasoningEffort: first.reasoningEffort },
      },
    });
    database.connection.exec("COMMIT");
    report.legacy = summary(rosterEvents(database));
    assert.ok(report.legacy.total > LEGACY_WRITES, "The legacy roster events were not added.");
    return { first, second, legacyCommandIds };
  });

  await boot(async (store, database) => {
    await runCauseEffect(store.updateAgent({ agentId: first.id, name: "First renamed" }));
    const afterWrite = rosterEvents(database);
    report.afterWrite = summary(afterWrite);
    assert.deepEqual(afterWrite.types, ["agent.model-changed", "agent.updated"], "Older roster events stayed.");
    assert.equal(afterWrite.receipts, afterWrite.total, "A kept roster event lost its receipt.");
    for (const commandId of legacyCommandIds)
      assert.equal(database.commandResult(commandId), undefined, "A dropped roster event kept its receipt.");
    assert.deepEqual(
      database
        .listAgents()
        .map((agent) => agent.name)
        .sort(),
      ["First renamed", "Second"],
      "The roster projection changed.",
    );
    assert.deepEqual(
      databaseRows(database.latestRosterAgents())
        .map((agent) => requiredStringColumn(agent, "name"))
        .sort(),
      ["First renamed", "Second"],
      "The newest roster event does not hold the roster.",
    );

    const effort = AGENT_REASONING_EFFORTS.find((candidate) => candidate !== first.reasoningEffort);
    assert.ok(effort, "No other reasoning effort exists.");
    await runCauseEffect(store.updateAgent({ agentId: first.id, reasoningEffort: effort }, second.id));
    await runCauseEffect(store.updateAgent({ agentId: second.id, name: "Second renamed" }));
    const afterAuditWrite = rosterEvents(database);
    report.afterAuditWrite = summary(afterAuditWrite);
    assert.deepEqual(
      afterAuditWrite.types,
      ["agent.model-changed", "agent.model-changed", "agent.updated"],
      "A model-change audit entry was dropped.",
    );
    assert.equal(afterAuditWrite.receipts, afterAuditWrite.total, "A kept roster event lost its receipt.");

    await runCauseEffect(store.deleteAgent(second.id));
    const afterDelete = rosterEvents(database);
    report.afterDelete = summary(afterDelete);
    assert.deepEqual(afterDelete.types, ["agents.rebased-after-delete"], "A hard delete kept an older roster event.");
  });

  report.agentsAfterRestart = await boot((store) => store.list().length);
  assert.equal(report.agentsAfterRestart, 1, "A restart did not read the roster.");

  report.passed = true;
} finally {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
}
process.stdout.write(`Roster event prune check passed. Report: ${join(OUT, "report.json")}\n`);
