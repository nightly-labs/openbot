// This entry runs only inside the restricted generated-fixture container.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { join, relative } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { isAgentSummary } from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { ConversationQueries } from "../../src/backend/database/conversation-queries";
import { databaseRow, requiredNumberColumn, requiredStringColumn } from "../../src/backend/database/database-rows";
import { registerSearchSqlFunctions } from "../../src/backend/database/search-sql-functions";

function stringField(value: unknown, key: string): string {
  assert.ok(isDynamicRecord(value));
  const field = value[key];
  assert.equal(typeof field, "string");
  assert.ok(typeof field === "string");
  return field;
}

function checkedRecord(value: unknown) {
  assert.ok(isDynamicRecord(value));
  return value;
}
function readFixture(): void {
  assert.equal(process.argv.length, 2);
  const config = checkedRecord(JSON.parse(readFileSync("/fixture/config.json", "utf8")));
  assert.equal(config.format, "openbot-synthetic-read-acceptance");
  const ids = config.ids;
  const agentId = stringField(ids, "agentId");
  const threadId = stringField(ids, "threadId");
  const databasePath = "/fixture/tree/userdata/openbot.db";
  assert.equal(existsSync(`${databasePath}-wal`), false);
  assert.equal(existsSync(`${databasePath}-shm`), false);
  // Only a closed, checked, read-only-mounted fixture may use immutable mode.
  const db = new DatabaseSync(`file:${databasePath}?mode=ro&immutable=1`, { readOnly: true, allowExtension: false });
  try {
    db.exec("PRAGMA query_only = ON; PRAGMA trusted_schema = OFF");
    assert.deepEqual(
      db
        .prepare("PRAGMA integrity_check")
        .all()
        .map((row) => row.integrity_check),
      ["ok"],
    );
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    assert.equal(db.prepare("PRAGMA query_only").get()?.query_only, 1);
    registerSearchSqlFunctions(db);
    const core = {
      get connection() {
        return db;
      },
    };
    const queries = new ConversationQueries({ core });
    const roster = databaseRow(db.prepare("SELECT agent_json FROM projection_agents WHERE agent_id = ?").get(agentId));
    assert.ok(roster);
    const agent = JSON.parse(requiredStringColumn(roster, "agent_json"));
    assert.ok(isAgentSummary(agent));
    assert.equal(agent.id, agentId);
    assert.equal(agent.threadId, threadId);
    const snapshot = queries.readConversation(agentId, threadId);
    const firstId = stringField(ids, "userMessageId");
    const lastId = stringField(ids, "lastAssistantMessageId");
    const firstAssistantId = stringField(ids, "assistantMessageId");
    const messageIds = ["userMessageId", "assistantMessageId", "lastUserMessageId", "lastAssistantMessageId"].map(
      (key) => stringField(ids, key),
    );
    assert.deepEqual(
      snapshot.messages.map((message) => message.id),
      messageIds,
    );
    assert.ok(snapshot.revision > 0);
    assert.equal(snapshot.activeTurnId, null);
    assert.equal(queries.readConversationRevision(agentId, threadId), snapshot.revision);
    assert.equal(queries.readActiveTurnId(agentId, threadId), null);
    assert.equal(queries.readRunningTurnIds().size, 0);
    assert.equal(queries.readConversationRuntime(agentId, threadId).latestMessage?.id, messageIds[3]);
    assert.deepEqual(
      queries
        .readTurnAssistantMessages(agentId, stringField(ids, "firstTurnId"))
        .map((message) => message.id),
      [messageIds[1]],
    );
    assert.deepEqual(
      queries.readConversationMessages(agentId, threadId, [firstId, lastId]).map((message) => message.id),
      [firstId, lastId],
    );
    assert.equal(queries.readConversationRecoveryMessages(agentId, threadId, null).length, 0);
    const latest = queries.readConversationPage(agentId, threadId, { type: "latest" }, 2);
    assert.deepEqual(
      latest.messages.map((message) => message.id),
      messageIds.slice(2),
    );
    assert.equal(latest.pageInfo.hasOlder, true);
    assert.ok(latest.pageInfo.olderCursor);
    const older = queries.readConversationPage(
      agentId,
      threadId,
      { type: "before", cursor: latest.pageInfo.olderCursor },
      2,
    );
    assert.deepEqual(
      older.messages.map((message) => message.id),
      messageIds.slice(0, 2),
    );
    assert.equal(older.pageInfo.hasOlder, false);
    assert.equal(queries.supportedConversationCursor(threadId, firstAssistantId), messageIds[1]);
    const search = queries.searchConversationMessages("synthetic café", agentId, undefined, 1);
    assert.equal(search.total, 2);
    assert.equal(search.results[0]?.message.id, messageIds[1]);
    assert.ok(search.nextCursor);
    assert.equal(
      queries.searchConversationMessages("synthetic café", agentId, search.nextCursor, 1).results[0]?.message.id,
      messageIds[0],
    );
    const files = queries.searchConversationFiles("SYNTHETIC-CAFÉ");
    assert.equal(files.results.length, 1);
    assert.equal(files.results[0]?.attachment.id, stringField(ids, "attachmentId"));
    assert.equal(files.results[0]?.messageId, messageIds[1]);

    // Fixed inventory reads complement, and do not substitute for, the real controller above.
    const session = databaseRow(
      db.prepare("SELECT id, state, resume_cursor FROM projection_provider_sessions WHERE thread_id = ?").get(threadId),
    );
    assert.ok(session);
    assert.equal(requiredStringColumn(session, "id"), stringField(ids, "providerSessionId"));
    assert.equal(requiredStringColumn(session, "state"), "inactive");
    assert.equal(requiredStringColumn(session, "resume_cursor"), stringField(ids, "resumeCursor"));
    const history = databaseRow(
      db
        .prepare("SELECT state, cursor_json FROM provider_history_imports WHERE session_id = ?")
        .get(stringField(ids, "providerSessionId")),
    );
    assert.ok(history);
    assert.equal(requiredStringColumn(history, "state"), "complete");
    assert.equal(
      stringField(JSON.parse(requiredStringColumn(history, "cursor_json")), "cursor"),
      stringField(ids, "resumeCursor"),
    );
    const attachment = databaseRow(
      db
        .prepare("SELECT path FROM projection_attachments WHERE attachment_id = ?")
        .get(stringField(ids, "attachmentId")),
    );
    assert.ok(attachment);
    const storedRoot = stringField(config, "storedRoot");
    const storedPath = requiredStringColumn(attachment, "path");
    assert.equal(storedPath, stringField(config, "storedAttachmentPath"));
    assert.ok(storedPath.startsWith(`${storedRoot}/`));
    const mapped = relative(storedRoot, storedPath);
    assert.ok(!mapped.startsWith("..") && !mapped.startsWith("/"));
    assert.equal(
      createHash("sha256")
        .update(readFileSync(join("/fixture/tree", mapped)))
        .digest("hex"),
      stringField(config, "attachmentSha256"),
    );
    assert.equal(snapshot.messages[1]?.attachments?.[0]?.id, stringField(ids, "attachmentId"));
    const count = (sql: string) => {
      const row = databaseRow(db.prepare(sql).get());
      assert.ok(row);
      return requiredNumberColumn(row, "count");
    };
    assert.equal(count("SELECT COUNT(*) AS count FROM projection_routine_runs"), 0);
    assert.equal(count("SELECT COUNT(*) AS count FROM projection_agent_routines WHERE active = 1"), 1);
    assert.equal(count("SELECT COUNT(*) AS count FROM projection_agent_routines WHERE active = 0"), 1);
    assert.equal(
      db
        .prepare("SELECT active FROM projection_agent_routines WHERE routine_id = ?")
        .get(stringField(ids, "activeRoutineId"))?.active,
      1,
    );
    assert.equal(
      db
        .prepare("SELECT active FROM projection_agent_routines WHERE routine_id = ?")
        .get(stringField(ids, "pausedRoutineId"))?.active,
      0,
    );
    assert.ok(count("SELECT COUNT(*) AS count FROM orchestration_events") > 0);
    assert.ok(count("SELECT COUNT(*) AS count FROM orchestration_command_receipts") > 0);
    assert.throws(() => db.exec("CREATE TABLE forbidden_write (id TEXT)"), /readonly|read.only/i);
    assert.throws(() => writeFileSync("/fixture/tree/forbidden-write", "synthetic", { flag: "wx" }), /EROFS|EACCES/);
    const externalInterfaces = Object.values(networkInterfaces())
      .flat()
      .filter((entry) => entry && !entry.internal);
    assert.equal(externalInterfaces.length, 0);
    // Machine-readable: fixed synthetic acceptance facts only, with no paths or stored values.
    process.stdout.write(
      `${JSON.stringify({
        scope: "actual-conversation-read-controller",
        messages: 4,
        attachments: 1,
        routineRuns: 0,
        databaseWriteDenied: true,
        fixtureWriteDenied: true,
        externalInterfaces: 0,
        actualReadControllerExecuted: true,
        fullAppStartupTested: false,
        realCredentialsVerified: false,
        duplicateExecutionProven: false,
        fullMigrationComplete: false,
      })}\n`,
    );
  } finally {
    db.close();
  }
}

try {
  readFixture();
} catch {
  // Machine-readable: refuse without printing stored values or private exception details.
  process.stderr.write("SYNTHETIC_READ_ACCEPTANCE_REFUSED\n");
  process.exitCode = 78;
}
