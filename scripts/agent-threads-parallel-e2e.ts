// Runs an approval in the agent's own chat and one in a side thread at the same time, in this worktree's
// running dev app, through the real UI, preload bridge, agent service and provider. It changes the data
// of the profile, so start the app with `bun run dev` (never `--shared`), and pass an agent whose
// provider is signed in and runs turns at the same time:
// `bun scripts/agent-threads-parallel-e2e.ts --allow-mutations --agent=<agent id>`.
//
// The agent gets Workspace only access, so a write outside its workspace asks the user. The agent's own
// chat asks first, then the side thread asks. Checks: each approval has its own thread; the agent is in
// "Needs you"; the side thread's tab shows its approval, and Deny there leaves no file; after that the
// agent is still in "Needs you" and its own chat still shows its approval; Deny there leaves no file and
// takes the agent out of "Needs you". At the end it deletes the thread and the files and gives the agent
// its access back.
// Writes .openbot-build/agent-threads-parallel-e2e/report.json and screenshots.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { agentProviderDescriptor, isAgentProvider } from "@openbot/contracts/agent-providers";
import { type AgentApproval, type AgentTask, DEFAULT_AGENT_ACCESS } from "@openbot/contracts/ipc";
import { translateFor } from "@openbot/i18n";
import { argument, connectChannelE2e, WAIT_MS, waitFor, writeReport } from "./channel-e2e-support";

declare global {
  interface Window {
    parallelApprovalE2e?: AgentApproval[];
  }
}

const OUT = resolve(import.meta.dirname, "../.openbot-build/agent-threads-parallel-e2e");
mkdirSync(OUT, { recursive: true });
const UI_WAIT_MS = 15_000;
const english = translateFor("en");
const agentArgument = argument("agent");
assert.ok(agentArgument, "Pass --agent=<agent id> of an agent whose provider is signed in.");
const agentId: string = agentArgument;

interface Report {
  agentId: string;
  provider?: string;
  mainApproval?: { threadId: string; ownThread: boolean };
  sideApproval?: { taskId: string; threadId: string; ownThread: boolean };
  bothWaiting?: { inNeedsYou: boolean; sideCardInThreadView: boolean };
  sideDenied?: { cardGone: boolean; fileExists: boolean; stillInNeedsYou: boolean; mainCardShown: boolean };
  mainDenied?: { cardGone: boolean; fileExists: boolean; leftNeedsYou: boolean };
  restored?: { access: string };
  pageErrors: string[];
  passed: boolean;
}

const report: Report = { agentId, pageErrors: [], passed: false };
const session = await connectChannelE2e("agent-threads-parallel-e2e");
const { page } = session;
page.on("pageerror", (error) => report.pageErrors.push(error.stack ?? error.message));
const files: string[] = [];
let taskId: string | null = null;

const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const tab = (title: string) =>
  page
    .getByRole("tablist", { name: english("conversation.threads.open") })
    .getByRole("tab", { name: new RegExp(`^${literal(title)}`) })
    .first();
const approvalCard = () => page.getByRole("region", { name: english("prompt.approval.label"), exact: true });
const needsYou = () => page.getByRole("region", { name: new RegExp(`^${literal(english("sidebar.waiting.title"))}`) });

function writePrompt(): string {
  const file = join(homedir(), `openbot-thread-approval-${randomUUID()}.txt`);
  files.push(file);
  return `Create the file ${file} with the text ok. Run the shell command with escalated permissions so that I get an approval request.`;
}

/** Waits in the page for the first approval of the agent that `accept` takes. */
function waitForApproval(label: string, accept: (approval: AgentApproval) => boolean): Promise<AgentApproval> {
  return waitFor(
    page,
    label,
    () => page.evaluate(() => window.parallelApprovalE2e ?? []),
    (approvals) => approvals.some(accept),
  ).then((approvals) => {
    const found = approvals.find(accept);
    assert.ok(found);
    return found;
  });
}

async function readTask(): Promise<AgentTask | undefined> {
  const snapshot = await page.evaluate((id) => window.openbot.agent.listTasks(id), agentId);
  return snapshot.tasks.find((task) => task.id === taskId);
}

const before = await page.evaluate(async (id) => {
  const found = (await window.openbot.agent.listAgents()).find((candidate) => candidate.id === id);
  if (!found) throw new Error(`Unknown agent: ${id}`);
  return found;
}, agentId);
report.provider = before.provider;
const provider = before.provider;
assert.ok(isAgentProvider(provider), `The agent ${agentId} has a provider that this build does not know.`);
assert.ok(
  agentProviderDescriptor(provider).concurrentTurns,
  `${before.provider} runs one turn at a time. Choose an agent on another provider.`,
);
const originalAccess = before.access ?? DEFAULT_AGENT_ACCESS;
const agentInNeedsYou = () =>
  needsYou()
    .getByRole("button", { name: new RegExp(`^${literal(before.name)}[,.]`) })
    .count()
    .then((count) => count > 0);

try {
  await page.bringToFront();
  const whatsNew = page.getByRole("dialog", { name: english("update.whatsNew.title") });
  if (await whatsNew.isVisible()) {
    await whatsNew.getByRole("button", { name: english("update.whatsNew.done") }).click();
    await whatsNew.waitFor({ state: "detached", timeout: UI_WAIT_MS });
  }
  await page.evaluate((id) => window.openbot.agent.updateAgent({ agentId: id, access: "workspace" }), agentId);
  await page.evaluate(() => {
    window.parallelApprovalE2e = [];
    window.openbot.agent.onEvent((event) => {
      if (event.type === "approval") window.parallelApprovalE2e?.push(event.approval);
    });
  });
  await page
    .getByRole("navigation", { name: english("sidebar.nav.label") })
    .getByRole("button", { name: new RegExp(`^${literal(before.name)}[,.]`) })
    .first()
    .click();
  await page
    .getByRole("button", { name: english("conversation.threads.new"), exact: true })
    .first()
    .waitFor({ timeout: UI_WAIT_MS });

  // 1. The agent's own chat asks first.
  const mainThreadId = await page.evaluate(
    async ({ id, text }) => {
      await window.openbot.agent.sendMessage({ agentId: id, text, clientMessageId: crypto.randomUUID() });
      return (await window.openbot.agent.readConversation(id)).threadId;
    },
    { id: agentId, text: writePrompt() },
  );
  assert.ok(mainThreadId, "The agent's own chat has no thread.");
  const mainApproval = await waitForApproval(
    "the approval of the agent's own chat",
    (approval) => approval.agentId === agentId,
  );
  report.mainApproval = { threadId: mainApproval.threadId, ownThread: mainApproval.threadId === mainThreadId };
  assert.ok(report.mainApproval.ownThread, "The first approval is not of the agent's own chat.");

  // 2. Then the side thread asks.
  const task = await page.evaluate(
    (input) => window.openbot.agent.startTask({ ...input, clientMessageId: crypto.randomUUID() }),
    { agentId, text: writePrompt() },
  );
  taskId = task.id;
  const sideApproval = await waitForApproval(
    "the approval of the side thread",
    (approval) => approval.agentId === agentId && approval.threadId !== mainThreadId,
  );
  report.sideApproval = {
    taskId: task.id,
    threadId: sideApproval.threadId,
    ownThread: sideApproval.threadId === task.threadId,
  };
  assert.ok(report.sideApproval.ownThread, "The second approval is not of the side thread.");

  // 3. Both wait: the agent is in "Needs you", and the side thread's tab shows its approval.
  await waitFor(page, "the agent shows in Needs you", agentInNeedsYou, Boolean, UI_WAIT_MS);
  const current = await readTask();
  assert.ok(current);
  // A thread that the bridge starts has no tab yet; the thread list opens one.
  await page.getByRole("button", { name: english("conversation.threads.all"), exact: true }).click();
  await page
    .getByRole("menuitem", { name: new RegExp(literal(current.title.slice(0, 40))) })
    .first()
    .click();
  await tab(current.title).waitFor({ timeout: UI_WAIT_MS });
  const threadView = page.getByRole("region", {
    name: english("conversation.threads.view.label", { title: current.title }),
  });
  const sideCard = threadView.getByRole("region", { name: english("prompt.approval.label"), exact: true });
  await sideCard.waitFor({ timeout: WAIT_MS });
  report.bothWaiting = { inNeedsYou: true, sideCardInThreadView: true };
  await page.screenshot({ path: resolve(OUT, "3-both-waiting.png") });

  // 4. Deny in the side thread. The agent's own chat still waits.
  await sideCard.getByRole("button", { name: english("prompt.approval.deny"), exact: true }).click();
  await sideCard.waitFor({ state: "detached", timeout: WAIT_MS });
  await waitFor(page, "the side turn ends", readTask, (latest) => latest?.state !== "running");
  const stillInNeedsYou = await agentInNeedsYou();
  await tab(before.name).click();
  await threadView.waitFor({ state: "detached", timeout: UI_WAIT_MS });
  const mainCard = approvalCard().first();
  const mainCardShown = await mainCard
    .waitFor({ timeout: UI_WAIT_MS })
    .then(() => true)
    .catch(() => false);
  report.sideDenied = {
    cardGone: true,
    fileExists: existsSync(files[1] ?? ""),
    stillInNeedsYou,
    mainCardShown,
  };
  await page.screenshot({ path: resolve(OUT, "4-side-denied.png") });
  assert.equal(report.sideDenied.fileExists, false, "Deny in the side thread still wrote the file.");
  assert.ok(stillInNeedsYou, "The answer in the side thread took the agent out of Needs you.");
  assert.ok(mainCardShown, "The agent's own chat lost its approval.");

  // 5. Deny in the agent's own chat.
  await mainCard.getByRole("button", { name: english("prompt.approval.deny"), exact: true }).click();
  await mainCard.waitFor({ state: "detached", timeout: WAIT_MS });
  const left = await waitFor(page, "the agent leaves Needs you", agentInNeedsYou, (shown) => !shown, UI_WAIT_MS)
    .then(() => true)
    .catch(() => false);
  report.mainDenied = { cardGone: true, fileExists: existsSync(files[0] ?? ""), leftNeedsYou: left };
  assert.equal(report.mainDenied.fileExists, false, "Deny in the agent's own chat still wrote the file.");
  assert.ok(left, "The agent stays in Needs you with no approval.");
  report.passed = true;
} finally {
  if (taskId) {
    const id = taskId;
    await page
      .evaluate((input) => window.openbot.agent.stopTask(input), { agentId, taskId: id })
      .catch(() => undefined);
    await waitFor(page, "the cleanup stop", readTask, (latest) => latest?.state !== "running").catch(() => undefined);
    await page
      .evaluate((input) => window.openbot.agent.deleteTask(input), { agentId, taskId: id })
      .catch(() => undefined);
  }
  for (const file of files) rmSync(file, { force: true });
  const restored = await page.evaluate(({ id, access }) => window.openbot.agent.updateAgent({ agentId: id, access }), {
    id: agentId,
    access: originalAccess,
  });
  report.restored = { access: restored.access ?? DEFAULT_AGENT_ACCESS };
  writeReport("agent-threads-parallel-e2e", report);
  await session.close();
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.passed) process.exitCode = 1;
