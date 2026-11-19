import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ConversationPage, OpenBotDesktopApi, QueueDeliveryStatus } from "@openbot/contracts/ipc";
import { createOpenBotLogger } from "@openbot/logging";
import { assertMutationAllowed, connectToDevApp } from "./dev-automation/cdp-client";
import { readDevInstanceRecords } from "./dev-automation/instance-registry";

declare global {
  interface Window {
    openbot: OpenBotDesktopApi;
  }
}

const OUT = resolve(import.meta.dirname, "../.openbot-build/mailbox-reconcile-e2e");
const argument = (name: string) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(`--${name}=`.length);
const agentArgument = argument("agent");
assert.ok(agentArgument, "Pass --agent=<agent id>.");
const agentId: string = agentArgument;

const PROMPT = "Reply with the single word ready. Do not use tools.";
const READS = 5;
const WAIT_MS = 120_000;
const FINAL = new Set<QueueDeliveryStatus>(["completed", "failed", "interrupted", "cancelled"]);

interface Report {
  agentId: string;
  deliveryId?: string;
  deliveryStatus?: QueueDeliveryStatus;
  revisions?: number[];
  passed: boolean;
}

const report: Report = { agentId, passed: false };

const instances = readDevInstanceRecords().filter(
  (record) => record.service === "app" && resolve(record.projectRoot) === resolve(process.cwd()),
);
assert.equal(instances.length, 1, "Start one dev app for this worktree first.");
const instance = instances[0];
assert.ok(instance);
assertMutationAllowed({
  command: "mailbox-reconcile-e2e",
  allowMutations: process.argv.includes("--allow-mutations"),
  instanceNamed: true,
  target: instance.instanceId,
});
const session = await connectToDevApp(instance.remoteDebuggingPort, createOpenBotLogger("mailbox-reconcile-e2e"), {
  expectedRendererPort: instance.rendererPort,
  ownerPid: instance.pid,
});
const page = session.page;

function readPage(): Promise<ConversationPage> {
  return page.evaluate((id) => window.openbot.agent.readConversationPage({ agentId: id, limit: 100 }), agentId);
}

try {
  const receipt = await page.evaluate(
    ({ id, text }) => window.openbot.agent.sendMessage({ agentId: id, text, clientMessageId: crypto.randomUUID() }),
    { id: agentId, text: PROMPT },
  );
  const deliveryId = receipt.deliveries.find((delivery) => delivery.recipientAgentId === agentId)?.id;
  assert.ok(deliveryId, "The message has no delivery to the agent.");
  report.deliveryId = deliveryId;

  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    const current = await readPage();
    const sent = current.messages.find((message) => message.id === deliveryId);
    if (sent?.delivery && FINAL.has(sent.delivery.status) && sent.turnId && current.activeTurnId === null) {
      report.deliveryStatus = sent.delivery.status;
      break;
    }
    if (Date.now() > deadline) throw new Error(`Timed out: the turn of ${deliveryId} does not end.`);
    await page.waitForTimeout(250);
  }

  const revisions: number[] = [];
  for (let index = 0; index < READS; index++) revisions.push((await readPage()).revision);
  report.revisions = revisions;
  assert.deepEqual(
    revisions,
    revisions.map(() => revisions[0]),
    `A page read with no change wrote an event: revisions ${revisions.join(", ")}.`,
  );
  report.passed = true;
} finally {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(resolve(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await session.close();
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.passed) process.exitCode = 1;
