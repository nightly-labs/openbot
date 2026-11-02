// Uses the threads of an agent from a joined computer and from the web app, in this worktree's
// `bun run dev:test-client` stack. The app of this worktree is the host; the test client joins it; the
// web app at `/app` of the local Auth API reaches it through Signal and WebRTC. It changes the data of
// the host profile and starts real provider turns, so the prompts are short. Pass an agent of the host
// whose provider is signed in, and the Auth API address that the stack log prints:
// `bun scripts/web-client-threads-e2e.ts --allow-mutations --agent=<agent id> --auth-api=http://localhost:<port>
//  [--email=openbot-dev-host@example.com] [--browser-executable=<path>]`
//
// 1. The test client starts a thread on the host, renames it, archives and restores it. The host shows
//    each change.
// 2. The web app signs in as the host owner with the development code, opens the thread from the
//    thread list, and sends a message in its tab. The host has the message.
// 3. The web app deletes the thread from its tab menu. After the Undo time the host and the test client
//    no longer list it.
// Writes .openbot-build/web-client-threads-e2e/report.json and screenshots.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { AgentTask, AgentTasksSnapshot, ConversationSnapshot } from "@openbot/contracts/ipc";
import { AGENT_THREADS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-threads-v1";
import { translateFor } from "@openbot/i18n";
import { createOpenBotLogger } from "@openbot/logging";
import { chromium, type Page } from "playwright-core";
import { argument, connectChannelE2e, SHORT_PROMPT, waitFor, writeReport } from "./channel-e2e-support";
import { assertMutationAllowed, connectToDevApp } from "./dev-automation/cdp-client";
import { readDevInstanceRecords } from "./dev-automation/instance-registry";

const OUT = resolve(import.meta.dirname, "../.openbot-build/web-client-threads-e2e");
mkdirSync(OUT, { recursive: true });
const UI_WAIT_MS = 30_000;
const english = translateFor("en");
const agentArgument = argument("agent");
const authApi = argument("auth-api")?.replace(/\/$/, "");
assert.ok(agentArgument, "Pass --agent=<agent id> of a host agent whose provider is signed in.");
assert.ok(authApi, "Pass --auth-api=<url> from the dev:test-client log.");
const agentId: string = agentArgument;
const email = argument("email") ?? "openbot-dev-host@example.com";
const browserExecutable = argument("browser-executable");
const run = crypto.randomUUID().slice(0, 6);
const title = `Web thread ${run}`;
const webText = `Reply with the single word done. Do not use tools. Web ${run}.`;

interface Report {
  agentId: string;
  serverId?: string;
  taskId?: string;
  client?: { startedOnHost: boolean; renamedOnHost: boolean; archivedOnHost: boolean; restoredOnHost: boolean };
  web?: { signedIn: boolean; tabSelected: boolean; messageOnHost: boolean };
  webDelete?: { goneOnHost: boolean; goneOnClient: boolean };
  pageErrors: string[];
  screenshots: string[];
  passed: boolean;
}

const report: Report = { agentId, pageErrors: [], screenshots: [], passed: false };
const host = await connectChannelE2e("web-client-threads-e2e");
const clientRecords = readDevInstanceRecords().filter(
  (record) => record.service === "test-client" && resolve(record.projectRoot) === resolve(process.cwd()),
);
assert.equal(clientRecords.length, 1, "Start `bun run dev:test-client` for this worktree first.");
const clientRecord = clientRecords[0];
assert.ok(clientRecord);
assertMutationAllowed({
  command: "web-client-threads-e2e",
  allowMutations: process.argv.includes("--allow-mutations"),
  instanceNamed: true,
  target: clientRecord.instanceId,
});
const client = await connectToDevApp(clientRecord.remoteDebuggingPort, createOpenBotLogger("web-client-threads-e2e"), {
  expectedRendererPort: clientRecord.rendererPort,
  ownerPid: clientRecord.pid,
});
const browser = await chromium.launch(
  browserExecutable ? { executablePath: browserExecutable } : { channel: "chrome" },
);
const web = await browser.newPage({ viewport: { width: 1280, height: 800 } });
for (const page of [host.page, client.page, web])
  page.on("pageerror", (error) => report.pageErrors.push(error.stack ?? error.message));
let taskId: string | null = null;
let deleted = false;

const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function hostTasks(): Promise<AgentTasksSnapshot> {
  return host.page.evaluate((id) => window.openbot.agent.listTasks(id), agentId);
}

async function hostTask(): Promise<AgentTask | undefined> {
  return (await hostTasks()).tasks.find((task) => task.id === taskId);
}

async function shot(page: Page, label: string): Promise<void> {
  const path = resolve(OUT, `${label}.png`);
  await page.screenshot({ path });
  report.screenshots.push(path);
}

try {
  // 1. The test client works on the host's threads through the Team API.
  const servers = await client.page.evaluate(() => window.openbot.servers.list());
  const server = servers.find(
    (item) => item.kind === "remote" && item.compatibility?.capabilities.includes(AGENT_THREADS_CAPABILITY) === true,
  );
  assert.ok(server, `No joined server advertises ${AGENT_THREADS_CAPABILITY}. Start the host from this worktree.`);
  const serverId = server.id;
  report.serverId = serverId;

  const task = await client.page.evaluate(
    ({ id, text, server }) =>
      window.openbot.agent.startTask({ agentId: id, text, clientMessageId: crypto.randomUUID() }, server),
    { id: agentId, text: SHORT_PROMPT, server: serverId },
  );
  taskId = task.id;
  report.taskId = task.id;
  await waitFor(host.page, "the host runs the thread", hostTask, (current) => current?.state === "idle");
  const input = { agentId, taskId: task.id };
  await client.page.evaluate(({ value, server }) => window.openbot.agent.renameTask(value, server), {
    value: { ...input, title },
    server: serverId,
  });
  await waitFor(host.page, "the host has the new title", hostTask, (current) => current?.title === title);
  await client.page.evaluate(({ value, server }) => window.openbot.agent.closeTask(value, server), {
    value: input,
    server: serverId,
  });
  await waitFor(host.page, "the host archives the thread", hostTask, (current) => current?.state === "closed");
  await client.page.evaluate(({ value, server }) => window.openbot.agent.reopenTask(value, server), {
    value: input,
    server: serverId,
  });
  await waitFor(host.page, "the host restores the thread", hostTask, (current) => current?.state === "idle");
  report.client = { startedOnHost: true, renamedOnHost: true, archivedOnHost: true, restoredOnHost: true };

  // 2. The web app signs in as the owner and uses the thread.
  await web.goto(`${authApi}/app`);
  await web.getByRole("textbox", { name: english("account.login.email") }).fill(email);
  await web.getByRole("button", { name: english("account.login.sendCode") }).click();
  const codeLine = web.getByText(/^Development code: /);
  await codeLine.waitFor({ timeout: UI_WAIT_MS });
  const code = (await codeLine.textContent())?.replace(/^Development code: /, "").replace(/[^A-Za-z0-9]/g, "");
  assert.ok(code && code.length === 8, "The page shows no development code.");
  await web.keyboard.type(code);
  const agentName = await host.page.evaluate(async (id) => {
    const found = (await window.openbot.agent.listAgents()).find((candidate) => candidate.id === id);
    if (!found) throw new Error(`Unknown agent: ${id}`);
    return found.name;
  }, agentId);
  const agentButton = web
    .getByRole("navigation", { name: english("sidebar.nav.label") })
    .getByRole("button", { name: new RegExp(`^${literal(agentName)}[,.]`) })
    .first();
  await agentButton.waitFor({ timeout: UI_WAIT_MS * 2 });
  await agentButton.click();
  await web.getByRole("button", { name: english("conversation.threads.all"), exact: true }).click();
  await web
    .getByRole("menuitem", { name: new RegExp(literal(title)) })
    .first()
    .click();
  const tab = web
    .getByRole("tablist", { name: english("conversation.threads.open") })
    .getByRole("tab", { name: new RegExp(`^${literal(title)}`) });
  await tab.waitFor({ timeout: UI_WAIT_MS });
  const tabSelected = (await tab.getAttribute("aria-selected")) === "true";
  const composer = web.getByRole("textbox", {
    name: english("conversation.threads.view.placeholder", { name: agentName, title }),
  });
  await composer.fill(webText);
  await composer.press("Enter");
  await waitFor(
    host.page,
    "the host has the web message",
    (): Promise<ConversationSnapshot> => host.page.evaluate((value) => window.openbot.agent.readTask(value), input),
    (snapshot) => snapshot.messages.some((message) => message.text.includes(webText)),
  );
  await waitFor(host.page, "the web turn ends", hostTask, (current) => current?.state === "idle");
  report.web = { signedIn: true, tabSelected, messageOnHost: true };
  await shot(web, "2-web-thread");
  assert.ok(tabSelected, "The web app does not select the thread's tab.");

  // 3. The web app deletes the thread.
  await tab.click({ button: "right" });
  const menu = web.getByRole("menu", { name: english("conversation.threads.actions") });
  await menu.waitFor({ timeout: UI_WAIT_MS });
  await menu.getByRole("menuitem", { name: english("common.delete"), exact: true }).click();
  await web
    .getByText(english("conversation.threads.deleteUndo.title", { title }), { exact: true })
    .waitFor({ timeout: UI_WAIT_MS });
  await waitFor(host.page, "the host deletes the thread", hostTask, (current) => current === undefined);
  deleted = true;
  const clientList = await client.page.evaluate(({ id, server }) => window.openbot.agent.listTasks(id, server), {
    id: agentId,
    server: serverId,
  });
  report.webDelete = { goneOnHost: true, goneOnClient: !clientList.tasks.some((entry) => entry.id === task.id) };
  assert.ok(report.webDelete.goneOnClient, "The test client still lists the deleted thread.");
  report.passed = true;
} catch (error) {
  await shot(web, "failure-web").catch(() => undefined);
  await shot(client.page, "failure-client").catch(() => undefined);
  throw error;
} finally {
  if (taskId && !deleted) {
    const id = taskId;
    await host.page.evaluate((value) => window.openbot.agent.stopTask(value), { agentId, taskId: id }).catch(() => {});
    await waitFor(host.page, "the cleanup stop", hostTask, (current) => current?.state !== "running").catch(() => {});
    await host.page
      .evaluate((value) => window.openbot.agent.deleteTask(value), { agentId, taskId: id })
      .catch(() => {});
  }
  writeReport("web-client-threads-e2e", report);
  await browser.close();
  await client.close();
  await host.close();
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.passed) process.exitCode = 1;
