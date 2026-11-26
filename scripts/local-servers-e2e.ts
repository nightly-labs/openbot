import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { LOCAL_SERVER_LIMIT, type OpenBotDesktopApi, type ServerSummary } from "@openbot/contracts/ipc";
import { en } from "@openbot/i18n";
import { createOpenBotLogger } from "@openbot/logging";
import type { Page } from "playwright-core";
import { assertMutationAllowed, connectToDevApp } from "./dev-automation/cdp-client";
import { readDevInstanceRecords } from "./dev-automation/instance-registry";

declare global {
  interface Window {
    openbot: OpenBotDesktopApi;
  }
}

const OUT = resolve(import.meta.dirname, "../.openbot-build/local-servers-e2e");
const NAMES = ["E2E studio one", "E2E studio two"] as const;
const START_DEADLINE_MS = 90_000;
const STOPPED_API_URL = "http://127.0.0.1:0";
const SUPERVISOR_RESTARTS = 3;
const MODIFIER = process.platform === "darwin" ? "Meta" : "Control";

interface Child {
  pid: number;
  rssMb: number;
  userData: string;
}

interface Step {
  name: string;
  passed: boolean;
  detail?: unknown;
  error?: string;
}

const report: { passed: boolean; steps: Step[]; unverified: string[] } = {
  passed: false,
  steps: [],
  unverified: [
    "An agent and a chat message in each server: they start a provider CLI, which this check does not run. The check confirms that each server has its own database and agent folder instead.",
    "A restart of the whole app: the script must stay connected to one dev window. The supervisor restart and the start after a crash run the same start path.",
  ],
};

async function step<T>(name: string, run: () => Promise<T>): Promise<T> {
  process.stdout.write(`- ${name}\n`);
  try {
    const value = await run();
    report.steps.push({ name, passed: true, detail: value });
    return value;
  } catch (error) {
    report.steps.push({ name, passed: false, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

function children(): Child[] {
  const lines = execFileSync("ps", ["-axww", "-o", "pid=,rss=,command="], { encoding: "utf8" }).split("\n");
  return lines.flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    const userData = match?.[3] ? /--user-data-dir=(.*?\/local-servers\/[^\s/]+)/.exec(match[3])?.[1] : undefined;
    if (!match?.[3] || !userData || /\s--type=/.test(match[3])) return [];
    return [{ pid: Number(match[1]), rssMb: Math.round(Number(match[2]) / 1024), userData }];
  });
}

function childOf(entryId: string): Child | undefined {
  return children().find((child) => basename(child.userData) === entryId);
}

async function servers(page: Page): Promise<ServerSummary[]> {
  return page.evaluate(() => window.openbot.servers.list());
}

async function waitForServer(page: Page, serverId: string, state: ServerSummary["state"]): Promise<void> {
  await page.waitForFunction(
    async ([id, expected]) => (await window.openbot.servers.list()).some((s) => s.id === id && s.state === expected),
    [serverId, state] as const,
    { timeout: START_DEADLINE_MS, polling: 250 },
  );
}

async function waitForLocalServer(page: Page, serverId: string, phase: "stopped" | "started"): Promise<void> {
  const deadline = Date.now() + START_DEADLINE_MS;
  for (;;) {
    const server = (await servers(page)).find((item) => item.id === serverId);
    const stopped = server?.apiUrl === STOPPED_API_URL && server.state === "offline";
    const started = server !== undefined && server.apiUrl !== STOPPED_API_URL && server.state === "online";
    if (phase === "stopped" ? stopped : started) return;
    assert.ok(Date.now() < deadline, `${serverId} was not ${phase} within ${START_DEADLINE_MS} ms.`);
    await new Promise((done) => setTimeout(done, 250));
  }
}

async function waitForActive(page: Page, serverId: string): Promise<void> {
  await page.waitForFunction(
    async (id) => (await window.openbot.servers.list()).some((s) => s.id === id && s.active),
    serverId,
    { timeout: 10_000, polling: 100 },
  );
}

async function waitForChild(entryId: string, previous: number | null): Promise<Child> {
  const deadline = Date.now() + START_DEADLINE_MS;
  for (;;) {
    const child = childOf(entryId);
    if (child && child.pid !== previous) return child;
    assert.ok(Date.now() < deadline, `No child process for ${entryId} within ${START_DEADLINE_MS} ms.`);
    await new Promise((done) => setTimeout(done, 250));
  }
}

async function openCreateLocalServer(page: Page): Promise<void> {
  const item = page.getByRole("menuitem", { name: en["server.local.createTitle"], exact: true });
  const otherOptions = page.getByRole("button", { name: en["server.add.otherOptions"], exact: true });
  const railButton = page.getByRole("button", { name: en["server.rail.add"], exact: true });
  if (await railButton.isVisible()) await railButton.click();
  else {
    const [prefix] = en["server.menu.open"].split("{name}");
    await page.getByRole("button", { name: new RegExp(`^${prefix}`) }).click();
    const addItem = page.getByRole("menuitem", { name: en["server.rail.add"], exact: true });
    await item.or(addItem).first().waitFor();
    if (await addItem.isVisible()) await addItem.click();
  }
  await item.or(otherOptions).first().waitFor();
  if (await otherOptions.isVisible()) await otherOptions.click();
  await item.click();
}

function trashEntries(): string[] | null {
  try {
    return readdirSync(join(homedir(), ".Trash"));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EPERM") return null;
    throw error;
  }
}

function inTrash(entries: readonly string[], path: string): boolean {
  const name = basename(path);
  return entries.some((entry) => entry === name || entry.startsWith(`${name} `));
}

const instances = readDevInstanceRecords().filter(
  (record) => record.service === "app" && resolve(record.projectRoot) === resolve(process.cwd()),
);
assert.equal(instances.length, 1, "Start one dev app for this worktree first.");
const instance = instances[0];
assert.ok(instance);
assertMutationAllowed({
  command: "local-servers-e2e",
  allowMutations: process.argv.includes("--allow-mutations"),
  instanceNamed: true,
  target: instance.instanceId,
});
const logger = createOpenBotLogger("local-servers-e2e");
const session = await connectToDevApp(instance.remoteDebuggingPort, logger, {
  expectedRendererPort: instance.rendererPort,
  ownerPid: instance.pid,
});
const page = session.page;
mkdirSync(OUT, { recursive: true });

const created: { server: ServerSummary; entryId: string; child: Child }[] = [];
const before = await servers(page);
try {
  const local = before.find((server) => server.kind === "local");
  assert.ok(local, "The dev app has no Local server.");

  await step("Create a server from the add menu", async () => {
    const known = new Set(before.map((server) => server.id));
    const childrenBefore = new Set(children().map((child) => child.pid));
    await openCreateLocalServer(page);
    await page.getByLabel(en["server.local.nameLabel"], { exact: true }).fill(NAMES[0]);
    await page.screenshot({ path: resolve(OUT, "create-dialog.png") });
    await page.getByRole("button", { name: en["server.local.create"], exact: true }).click();
    await page.getByRole("heading", { name: en["server.local.createTitle"] }).waitFor({
      state: "hidden",
      timeout: START_DEADLINE_MS,
    });
    const server = (await servers(page)).find((item) => !known.has(item.id));
    assert.ok(server, "The new server is not in the server list.");
    assert.equal(server.thisComputer, true);
    assert.equal(server.name, NAMES[0]);
    await waitForActive(page, server.id);
    const child = children().find((item) => !childrenBefore.has(item.pid));
    assert.ok(child, "No child process started for the new server.");
    created.push({ server, entryId: basename(child.userData), child });
    await page.screenshot({ path: resolve(OUT, "first-server.png") });
    return { serverId: server.id, pid: child.pid, rssMb: child.rssMb };
  });

  await step("Create a second server", async () => {
    const childrenBefore = new Set(children().map((child) => child.pid));
    const server = await page.evaluate((name) => window.openbot.localServers.create(name), NAMES[1]);
    assert.equal(server.thisComputer, true);
    const child = children().find((item) => !childrenBefore.has(item.pid));
    assert.ok(child, "No child process started for the second server.");
    created.push({ server, entryId: basename(child.userData), child });
    return { serverId: server.id, pid: child.pid, rssMb: child.rssMb };
  });

  await step("Each server has its own database and agent folder", async () => {
    const [first, second] = created;
    assert.ok(first && second);
    assert.notEqual(first.child.userData, second.child.userData);
    for (const { entryId, child } of created) {
      assert.ok(existsSync(join(child.userData, "openbot.db")), `${child.userData} has no openbot.db.`);
      assert.ok(existsSync(join(homedir(), "OpenBot", "Servers", entryId)), `No agent folder for ${entryId}.`);
    }
    return created.map(({ child }) => child.userData);
  });

  await step("Cmd+1..9 switches between Local and both servers", async () => {
    const order = await servers(page);
    const ordered = [...order.filter((s) => s.kind === "local"), ...order.filter((s) => s.kind === "remote")];
    const targets = [local.id, ...created.map(({ server }) => server.id)];
    const pressed: { key: string; serverId: string }[] = [];
    for (const serverId of targets) {
      const position = ordered.findIndex((server) => server.id === serverId) + 1;
      assert.ok(position >= 1 && position <= 9, `${serverId} is not in the first nine rail places.`);
      const key = `${MODIFIER}+${position}`;
      await page.keyboard.press(key);
      await waitForActive(page, serverId);
      pressed.push({ key, serverId });
    }
    await page.screenshot({ path: resolve(OUT, "switched.png") });
    return pressed;
  });

  await step("A child that stops is started again", async () => {
    const [first] = created;
    assert.ok(first);
    const stopped = first.child.pid;
    process.kill(stopped, "SIGKILL");
    await waitForLocalServer(page, first.server.id, "stopped");
    const next = await waitForChild(first.entryId, stopped);
    await waitForLocalServer(page, first.server.id, "started");
    first.child = next;
    return { stoppedPid: stopped, newPid: next.pid };
  });

  await step("Retry starts a server that stopped too often", async () => {
    const [first] = created;
    assert.ok(first);
    const stoppedPids: number[] = [];
    for (let stop = 2; stop <= SUPERVISOR_RESTARTS; stop += 1) {
      stoppedPids.push(first.child.pid);
      process.kill(first.child.pid, "SIGKILL");
      await waitForLocalServer(page, first.server.id, "stopped");
      first.child = await waitForChild(first.entryId, first.child.pid);
      await waitForLocalServer(page, first.server.id, "started");
    }
    const last = first.child.pid;
    stoppedPids.push(last);
    process.kill(last, "SIGKILL");
    await waitForLocalServer(page, first.server.id, "stopped");
    const summary = await page.evaluate((id) => window.openbot.servers.retryConnection(id), first.server.id);
    assert.equal(summary.state, "online", "Retry did not start the stopped server.");
    const next = await waitForChild(first.entryId, last);
    first.child = next;
    return { stoppedPids, newPid: next.pid };
  });

  await step("Restart server starts a new child", async () => {
    const [, second] = created;
    assert.ok(second);
    const previous = second.child.pid;
    await page.evaluate((id) => window.openbot.localServers.restart(id), second.server.id);
    const next = await waitForChild(second.entryId, previous);
    await waitForServer(page, second.server.id, "online");
    second.child = next;
    return { previousPid: previous, newPid: next.pid };
  });

  report.steps.push({
    name: "Memory of each child",
    passed: true,
    detail: created.map(({ server, entryId }) => ({ serverId: server.id, ...childOf(entryId) })),
  });

  await step(`A server past ${LOCAL_SERVER_LIMIT} is refused`, async () => {
    const existing = (await servers(page)).filter((server) => server.thisComputer).length;
    for (let index = existing; index < LOCAL_SERVER_LIMIT; index += 1) {
      const childrenBefore = new Set(children().map((child) => child.pid));
      const server = await page.evaluate((name) => window.openbot.localServers.create(name), `E2E limit ${index + 1}`);
      const child = children().find((item) => !childrenBefore.has(item.pid));
      assert.ok(child, `No child process started for ${server.name}.`);
      created.push({ server, entryId: basename(child.userData), child });
    }
    const running = children().length;
    const refused = await page
      .evaluate(() => window.openbot.localServers.create("E2E over the limit"))
      .then(
        () => null,
        (error: unknown) => (error instanceof Error ? error.message : String(error)),
      );
    assert.ok(refused, `The app created server ${LOCAL_SERVER_LIMIT + 1}.`);
    assert.equal(children().length, running, "A refused server started a child process.");
    await openCreateLocalServer(page);
    const notice = en["server.local.limitReached"].replace("{limit}", String(LOCAL_SERVER_LIMIT));
    await page.getByRole("status").filter({ hasText: notice }).waitFor();
    assert.equal(
      await page.getByRole("button", { name: en["server.local.create"], exact: true }).isDisabled(),
      true,
      "Create is enabled at the limit.",
    );
    await page.screenshot({ path: resolve(OUT, "limit-dialog.png") });
    await page.getByRole("button", { name: en["common.cancel"], exact: true }).click();
    await page.getByRole("heading", { name: en["server.local.createTitle"] }).waitFor({ state: "hidden" });
    return { servers: LOCAL_SERVER_LIMIT, children: running, refused };
  });

  await step("Delete moves each server to the Trash", async () => {
    const results = [];
    for (const { server, entryId, child } of created.splice(0)) {
      await page.evaluate((id) => window.openbot.localServers.delete(id), server.id);
      assert.equal(childOf(entryId), undefined, `The child of ${server.id} still runs.`);
      assert.equal(
        (await servers(page)).some((item) => item.id === server.id),
        false,
      );
      const agentRoot = join(homedir(), "OpenBot", "Servers", entryId);
      assert.equal(existsSync(child.userData), false, `${child.userData} is still in place.`);
      assert.equal(existsSync(agentRoot), false, `${agentRoot} is still in place.`);
      const trash = trashEntries();
      results.push({
        serverId: server.id,
        userDataInTrash: trash && inTrash(trash, child.userData),
        agentRootInTrash: trash && inTrash(trash, agentRoot),
      });
    }
    if (results.some((result) => result.userDataInTrash === null))
      report.unverified.push(
        "The folders of a deleted server are in the Trash: macOS did not let this terminal read the Trash. The check confirms that they left their places.",
      );
    else
      assert.ok(
        results.every((result) => result.userDataInTrash && result.agentRootInTrash),
        "A deleted folder is not in the Trash.",
      );
    return results;
  });

  report.passed = true;
} finally {
  const known = new Set(before.map((server) => server.id));
  const left = (await servers(page).catch(() => [])).filter((server) => server.thisComputer && !known.has(server.id));
  for (const server of left)
    await page.evaluate((id) => window.openbot.localServers.delete(id), server.id).catch(() => undefined);
  writeFileSync(resolve(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await session.close();
}
logger.info(
  `Created, switched, restarted and deleted servers on this computer, and checked the limit. Wrote ${resolve(OUT, "report.json")}.`,
);
