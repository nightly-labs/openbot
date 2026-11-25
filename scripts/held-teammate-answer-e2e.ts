import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { OpenBotDatabase } from "../src/backend/openbot-database";

const OUT = resolve(import.meta.dirname, "../.openbot-build/held-teammate-answer-e2e");
const FAST_TEAMMATE = "teammate-fast";
const STUCK_TEAMMATE = "teammate-stuck";

interface Report {
  checks: string[];
  passed: boolean;
}

const report: Report = { checks: [], passed: false };

async function nextMillisecond(): Promise<void> {
  const start = new Date().toISOString();
  while (new Date().toISOString() === start) await new Promise((done) => setImmediate(done));
}

async function deliveryOf(
  mailbox: MailboxStore,
  input: Parameters<MailboxStore["enqueue"]>[0],
  recipientAgentId: string,
): Promise<{ messageId: string; deliveryId: string }> {
  await nextMillisecond();
  const receipt = await runCauseEffect(mailbox.enqueue(input));
  const delivery = receipt.deliveries.find((candidate) => candidate.recipientAgentId === recipientAgentId);
  assert.ok(delivery, `The message has a delivery to ${recipientAgentId}.`);
  return { messageId: receipt.messageId, deliveryId: delivery.id };
}

async function runTurn(mailbox: MailboxStore, deliveryId: string, turnId: string): Promise<void> {
  await runCauseEffect(mailbox.markStarting(deliveryId));
  await runCauseEffect(mailbox.markRunning(deliveryId, turnId));
}

async function endTurn(mailbox: MailboxStore, deliveryId: string): Promise<void> {
  await runCauseEffect(mailbox.markTerminal(deliveryId, "completed"));
}

async function askTwoTeammates(mailbox: MailboxStore, agentId: string): Promise<string> {
  const first = await deliveryOf(
    mailbox,
    { sender: { kind: "user" }, recipientAgentIds: [agentId], text: "Ask both" },
    agentId,
  );
  await runTurn(mailbox, first.deliveryId, `${agentId}-turn-1`);
  const request = await deliveryOf(
    mailbox,
    {
      sender: { kind: "agent", agentId },
      recipientAgentIds: [FAST_TEAMMATE, STUCK_TEAMMATE],
      text: "Check this",
      idempotencyKey: `${agentId}:${agentId}-turn-1:request`,
    },
    STUCK_TEAMMATE,
  );
  await runTurn(mailbox, request.deliveryId, `${STUCK_TEAMMATE}-${agentId}`);
  await endTurn(mailbox, first.deliveryId);
  return request.messageId;
}

async function answerFromFastTeammate(mailbox: MailboxStore, agentId: string, requestId: string): Promise<string> {
  const answer = await deliveryOf(
    mailbox,
    {
      sender: { kind: "agent", agentId: FAST_TEAMMATE },
      recipientAgentIds: [agentId],
      text: "Done",
      replyToMessageId: requestId,
      expectsReply: false,
    },
    agentId,
  );
  return answer.deliveryId;
}

async function checkHeldWithoutLaterTurn(mailbox: MailboxStore): Promise<void> {
  const agentId = "agent-no-later-turn";
  const requestId = await askTwoTeammates(mailbox, agentId);
  await answerFromFastTeammate(mailbox, agentId, requestId);
  assert.equal(mailbox.nextQueued(agentId), null, "The answer waits while the other teammate works.");
  report.checks.push("No later turn: the answer of one teammate waits while the other teammate works");
}

async function checkReleasedAfterTurnThatStartedBeforeAnswer(mailbox: MailboxStore): Promise<void> {
  const agentId = "agent-later-turn";
  const requestId = await askTwoTeammates(mailbox, agentId);
  const later = await deliveryOf(
    mailbox,
    { sender: { kind: "user" }, recipientAgentIds: [agentId], text: "Something else" },
    agentId,
  );
  await runTurn(mailbox, later.deliveryId, `${agentId}-turn-2`);
  const answerId = await answerFromFastTeammate(mailbox, agentId, requestId);
  assert.equal(mailbox.nextQueued(agentId), null, "The answer waits while the later turn runs.");
  await endTurn(mailbox, later.deliveryId);
  assert.equal(
    mailbox.nextQueued(agentId)?.delivery.id,
    answerId,
    "The answer starts after a later turn that started before the answer came in.",
  );
  report.checks.push("Later turn started before the answer: the answer starts when that turn ends");
}

async function checkReleasedAfterTurnThatEndedBeforeAnswer(mailbox: MailboxStore): Promise<void> {
  const agentId = "agent-ended-turn";
  const requestId = await askTwoTeammates(mailbox, agentId);
  const later = await deliveryOf(
    mailbox,
    { sender: { kind: "user" }, recipientAgentIds: [agentId], text: "Something else" },
    agentId,
  );
  await runTurn(mailbox, later.deliveryId, `${agentId}-turn-2`);
  await endTurn(mailbox, later.deliveryId);
  const answerId = await answerFromFastTeammate(mailbox, agentId, requestId);
  assert.equal(
    mailbox.nextQueued(agentId)?.delivery.id,
    answerId,
    "The answer starts when the agent already had a later turn.",
  );
  report.checks.push("Later turn ended before the answer: the answer starts at once");
}

const root = await mkdtemp(join(tmpdir(), "openbot-held-teammate-answer-"));
const path = join(root, "profile");
const database = new OpenBotDatabase(path);
try {
  const mailbox = new MailboxStore(path, join(root, "shared"), database);
  await runCauseEffect(mailbox.initialize());
  await checkHeldWithoutLaterTurn(mailbox);
  await checkReleasedAfterTurnThatStartedBeforeAnswer(mailbox);
  await checkReleasedAfterTurnThatEndedBeforeAnswer(mailbox);
  report.passed = true;
} finally {
  database.close();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
}
process.stdout.write(
  `${report.passed ? "PASS" : "FAIL"}: ${report.checks.length} checks. Report: ${join(OUT, "report.json")}\n`,
);
if (!report.passed) process.exitCode = 1;
