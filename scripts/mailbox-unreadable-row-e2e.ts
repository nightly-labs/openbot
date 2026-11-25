import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { databaseRow, requiredNumberColumn, requiredStringColumn } from "../src/backend/database/database-rows";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { OpenBotDatabase } from "../src/backend/openbot-database";

const OUT = resolve(import.meta.dirname, "../.openbot-build/mailbox-unreadable-row-e2e");
const AGENT_ID = "agent-unreadable-row";
const root = await mkdtemp(join(tmpdir(), "openbot-mailbox-unreadable-row-"));
const userData = join(root, "user-data");
const sharedRoot = join(root, "shared");

interface Report {
  passed: boolean;
  badMessageId: string | null;
  checks: Array<{ name: string; passed: boolean; detail?: unknown }>;
  error: string | null;
}

const report: Report = { passed: false, badMessageId: null, checks: [], error: null };
const check = (name: string, passed: boolean, detail?: unknown) => {
  report.checks.push({ name, passed, ...(detail === undefined ? {} : { detail }) });
  if (!passed) throw new Error(`Check failed: ${name}`);
};

async function openMailbox(): Promise<{ database: OpenBotDatabase; mailbox: MailboxStore }> {
  const database = new OpenBotDatabase(userData);
  const mailbox = new MailboxStore(userData, sharedRoot, database);
  await runCauseEffect(mailbox.initialize());
  return { database, mailbox };
}

async function enqueue(mailbox: MailboxStore, text: string): Promise<string> {
  const receipt = await runCauseEffect(
    mailbox.enqueue({ sender: { kind: "user" }, recipientAgentIds: [AGENT_ID], text }),
  );
  return receipt.messageId;
}

function storedMessageJson(database: OpenBotDatabase, messageId: string): string | null {
  const row = databaseRow(
    database.connection
      .prepare("SELECT message_json FROM projection_mailbox_messages WHERE message_id = ?")
      .get(messageId),
  );
  return row ? requiredStringColumn(row, "message_json") : null;
}

function storedDeliveryCount(database: OpenBotDatabase, messageId: string): number {
  const row = databaseRow(
    database.connection
      .prepare("SELECT COUNT(*) AS count FROM projection_deliveries WHERE message_id = ?")
      .get(messageId),
  );
  return row ? requiredNumberColumn(row, "count") : 0;
}

function queuedTexts(mailbox: MailboxStore): string[] {
  return mailbox
    .listQueue(AGENT_ID)
    .deliveries.map((delivery) => delivery.text)
    .sort();
}

try {
  mkdirSync(OUT, { recursive: true });
  const first = await openMailbox();
  const badMessageId = await enqueue(first.mailbox, "Unreadable message");
  await enqueue(first.mailbox, "Readable message");
  report.badMessageId = badMessageId;
  const badJson = JSON.stringify({
    ...JSON.parse(storedMessageJson(first.database, badMessageId) ?? "{}"),
    expectsReply: true,
  });
  first.database.connection
    .prepare("UPDATE projection_mailbox_messages SET message_json = ? WHERE message_id = ?")
    .run(badJson, badMessageId);
  first.database.close();

  const second = await openMailbox();
  check("the mailbox opens with one unreadable message row", true);
  check("the readable message stays queued", queuedTexts(second.mailbox).join("|") === "Readable message", {
    queued: queuedTexts(second.mailbox),
  });
  check("the unreadable message row stays on disk", storedMessageJson(second.database, badMessageId) === badJson);
  check(
    "the delivery of the unreadable message stays on disk",
    storedDeliveryCount(second.database, badMessageId) === 1,
  );

  await enqueue(second.mailbox, "New message");
  check("a new message is queued", queuedTexts(second.mailbox).join("|") === "New message|Readable message", {
    queued: queuedTexts(second.mailbox),
  });
  check("the unreadable row stays on disk after a write", storedMessageJson(second.database, badMessageId) === badJson);
  second.database.close();

  const third = await openMailbox();
  check("the mailbox opens again", queuedTexts(third.mailbox).join("|") === "New message|Readable message", {
    queued: queuedTexts(third.mailbox),
  });
  check(
    "the unreadable row stays on disk after a restart",
    storedMessageJson(third.database, badMessageId) === badJson,
  );
  third.database.close();
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
} finally {
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.passed) process.exitCode = 1;
