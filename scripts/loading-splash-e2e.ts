// Checks the startup splash of a desktop client whose server is a slow remote host.
//
// Start this worktree's stack with
// `OPENBOT_DEV_CLIENT_TRANSPORT=webrtc OPENBOT_DEV_RTT_MS=600 bun run dev:test-client`, then run
// `bun scripts/loading-splash-e2e.ts --allow-mutations [--runs=3] [--label=<name>]`.
//
// The script selects the dev host as the test client's server, then checks two things:
// - `cover`: the window reloads, which always plays the splash, and grows to the screen size while
//   the crew fall, as when the user turns on full screen. The pit must still cover the whole window.
//   `before` and `after` give the share of the window that the pit covers.
// - `rains`: each run restarts only the test client (`bun run dev:restart-client`), so main connects
//   again over the slow link, and records each loading screen and each server state until the
//   workspace shows. The screens that continue one pile share its start, so a start that plays once
//   gives 1 rain. A run whose splash ended before the attach is `missed` and starts again.
// `--pause-host=<seconds>` stops the dev host's main process for that time after each restart, as a
// server that answers late. The client then reports a failed connection and retries.
// `--pause-host-online=<seconds>` stops the dev host for that time when the client starts to load the
// workspace over the online link. The first reads then fail at their deadline, and the client tries again.
// - `account`: the account service stops, main loads the account again (`auth.retry()`), and the
//   window reloads while the account state is `loading`, as at a start with a slow link to the
//   account service. The service continues after `--account-wait=<seconds>` (default 6). The start
//   must also give 1 rain.
// Writes .openbot-build/loading-splash/<label>/report.json and a screenshot of the grown window.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createOpenBotLogger } from "@openbot/logging";
import type { CDPSession, Page } from "playwright-core";
import { argument, WAIT_MS } from "./channel-e2e-support";
import { type AutomationSession, assertMutationAllowed, connectToDevApp } from "./dev-automation/cdp-client";
import { type DevInstanceRecord, readDevInstanceRecords } from "./dev-automation/instance-registry";

const NAME = "loading-splash";
const ROOT = resolve(import.meta.dirname, "..");
const POLL_MS = 100;
const runs = Number(argument("runs") ?? "3");
assert.ok(Number.isInteger(runs) && runs >= 0, "--runs takes a whole number, 0 or more.");
const label = argument("label") ?? "current";
const pauseHostS = Number(argument("pause-host") ?? "0");
assert.ok(Number.isFinite(pauseHostS) && pauseHostS >= 0, "--pause-host takes a number of seconds.");
const pauseOnlineS = Number(argument("pause-host-online") ?? "0");
assert.ok(Number.isFinite(pauseOnlineS) && pauseOnlineS >= 0, "--pause-host-online takes a number of seconds.");
const accountWaitS = Number(argument("account-wait") ?? "6");
assert.ok(Number.isFinite(accountWaitS) && accountWaitS > 0, "--account-wait takes a number of seconds.");
assert.match(label, /^\w[\w.-]*$/, "--label takes a folder name, not a path.");
const OUT = resolve(ROOT, ".openbot-build", NAME, label);
const logger = createOpenBotLogger(NAME);

interface SplashLog {
  /** Each pile screen when it showed: ms after the page start, the age of its pile when it mounted, and its parents. */
  screens: { at: number; pileAge: number; where: string; goneAt?: number }[];
  /** The start of each crew that fell, from the document timeline, in ms. */
  starts: number[];
  /** Each change of the remote server's state, as main reports it. */
  states: { at: number; state: string; issue: string | null }[];
  /** Each change of the account state, as main reports it. */
  auth: { at: number; status: string }[];
  /** When the recorder started, in ms after the page start. */
  attachedAt: number;
  /** The app had rendered and showed no pile when the recorder started: the start splash had ended. */
  splashEndedAtAttach: boolean;
}

interface Cover {
  window: { width: number; height: number };
  /** The share of the window that the pit covers, from 0 to 1. */
  share: number;
}

interface RunReport {
  rains: number;
  /** The start splash rained before the attach, so the recorder did not see it. */
  unseenSplash: boolean;
  attachedAt: number;
  screens: SplashLog["screens"];
  states: SplashLog["states"];
  auth: SplashLog["auth"];
  workspaceReadyMs: number | null;
}

// Runs in the page. It must be a string: the page has no access to this module.
const RECORDER = `(() => {
  if (window.__splashLog) return;
  const log = {
    screens: [],
    starts: [],
    states: [],
    auth: [],
    attachedAt: Math.round(performance.now()),
    splashEndedAtAttach:
      (document.getElementById("root")?.childElementCount ?? 0) > 0 && document.querySelector(".app-loading") === null,
  };
  window.__splashLog = log;
  const seen = new WeakSet();
  const shown = [];
  const scan = () => {
    for (const entry of shown) {
      if (entry.screen.isConnected || entry.log.goneAt !== undefined) continue;
      entry.log.goneAt = Math.round(performance.now());
    }
    for (const screen of document.querySelectorAll('.app-loading[data-scene="pile"]')) {
      if (seen.has(screen)) continue;
      seen.add(screen);
      const age = Number.parseFloat(screen.style.getPropertyValue("--app-loading-at")) || 0;
      const where = [];
      for (let node = screen.parentElement; node && where.length < 3; node = node.parentElement)
        where.push(node.className || node.tagName.toLowerCase());
      const entry = { at: Math.round(performance.now()), pileAge: Math.round(age * 1000), where: where.join(" < ") };
      log.screens.push(entry);
      shown.push({ screen, log: entry });
    }
    for (const plush of document.querySelectorAll(".app-loading-plush")) {
      for (const animation of plush.getAnimations()) {
        // The intro holds its last pose for an hour; the hop is shorter.
        const duration = Number(animation.effect?.getTiming().duration);
        if (!(duration > 3_000_000) || animation.startTime === null) continue;
        const start = Math.round(Number(animation.startTime));
        if (!log.starts.includes(start)) log.starts.push(start);
      }
    }
  };
  let reading = false;
  const readState = async () => {
    if (reading) return;
    reading = true;
    try {
      const remote = (await window.openbot.servers.list()).find((server) => server.kind === "remote");
      const last = log.states[log.states.length - 1];
      const state = remote?.state ?? "none";
      const issue = remote?.issue?.code ?? null;
      if (!last || last.state !== state || last.issue !== issue)
        log.states.push({ at: Math.round(performance.now()), state, issue });
      const status = (await window.openbot.auth.getState()).status;
      if (log.auth[log.auth.length - 1]?.status !== status) log.auth.push({ at: Math.round(performance.now()), status });
    } finally {
      reading = false;
    }
  };
  setInterval(() => void readState().catch(() => undefined), ${POLL_MS});
  scan();
  new MutationObserver(scan).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-phase"] });
  setInterval(scan, ${POLL_MS});
})()`;

// The share of the frame that the pit covers. Read in the page.
const COVER = `(() => {
  const frame = document.querySelector(".app-loading-pit-frame");
  const pit = document.querySelector(".app-loading-pit");
  if (!frame || !pit) return null;
  const f = frame.getBoundingClientRect();
  const p = pit.getBoundingClientRect();
  const width = Math.max(0, Math.min(f.right, p.right) - Math.max(f.left, p.left));
  const height = Math.max(0, Math.min(f.bottom, p.bottom) - Math.max(f.top, p.top));
  return { window: { width: innerWidth, height: innerHeight }, share: (width * height) / (f.width * f.height) };
})()`;

function testClient(): DevInstanceRecord {
  const instances = readDevInstanceRecords().filter(
    (record) => record.service === "test-client" && resolve(record.projectRoot) === ROOT,
  );
  assert.equal(
    instances.length,
    1,
    "Start `OPENBOT_DEV_CLIENT_TRANSPORT=webrtc OPENBOT_DEV_RTT_MS=600 bun run dev:test-client` in this worktree first.",
  );
  const [instance] = instances;
  assert.ok(instance);
  return instance;
}

async function poll<T>(what: string, read: () => Promise<T | null>): Promise<T> {
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    const value = await read().catch((error: unknown) => {
      logger.debug(`${what}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    });
    if (value !== null) return value;
    if (Date.now() > deadline) throw new Error(`Timed out: ${what}.`);
    await new Promise((done) => setTimeout(done, POLL_MS));
  }
}

/** The Electron main process of this worktree's dev host. Its record names the electron-vite process. */
function hostMainPid(): number {
  const hosts = readDevInstanceRecords().filter(
    (record) => record.service === "app" && resolve(record.projectRoot) === ROOT,
  );
  assert.equal(hosts.length, 1, "Start the dev host of this worktree with `bun run dev:test-client`.");
  const [host] = hosts;
  assert.ok(host);
  let children: string[] = [];
  try {
    children = execFileSync("pgrep", ["-P", String(host.pid)], { encoding: "utf8" })
      .split("\n")
      .filter(Boolean);
  } catch {
    // `pgrep` exits with 1 when the process has no children.
  }
  const main = children.find((pid) =>
    execFileSync("ps", ["-o", "command=", "-p", pid], { encoding: "utf8" }).includes("/MacOS/Electron "),
  );
  assert.ok(main, "The dev host has no Electron main process.");
  return Number(main);
}

/** The process group of this worktree's account service. Its supervisor starts each service in its own group. */
function accountServiceGroup(): number {
  const output = execFileSync("bun", ["scripts/dev-stack.ts", "status"], { cwd: ROOT, encoding: "utf8" });
  const status: {
    stacks: { projectRoot: string; processes: { name: string; pid: number; state: string }[] }[];
  } = JSON.parse(output.slice(output.indexOf("{")));
  const api = status.stacks
    .filter((stack) => resolve(stack.projectRoot) === ROOT)
    .flatMap((stack) => stack.processes)
    .find((entry) => entry.name === "api" && entry.state === "live");
  assert.ok(api, "This worktree's stack has no account service.");
  return api.pid;
}

// Ctrl-C ends the script through `exit`, so that each stopped process continues.
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => process.exit(130));

/**
 * Stops a process (a positive id) or a process group (a negative id) for `seconds`. It does not answer
 * in this time, and then continues where it stopped.
 */
function pause(name: string, target: number, seconds: number): () => void {
  let paused = true;
  const resume = () => {
    if (!paused) return;
    paused = false;
    clearTimeout(timer);
    process.off("exit", resume);
    process.kill(target, "SIGCONT");
    logger.info(`${name} continues (${target}).`);
  };
  process.kill(target, "SIGSTOP");
  process.on("exit", resume);
  logger.info(`${name} stops for ${seconds} s (${target}).`);
  const timer = setTimeout(resume, seconds * 1000);
  return resume;
}

function connect(instance: DevInstanceRecord): Promise<AutomationSession> {
  return connectToDevApp(instance.remoteDebuggingPort, logger, {
    expectedRendererPort: instance.rendererPort,
    ownerPid: instance.pid,
  });
}

/** Makes the dev host the active server, so a restart loads it. */
async function selectRemoteServer(instance: DevInstanceRecord): Promise<void> {
  const session = await connect(instance);
  try {
    const selected = await session.page.evaluate(`(async () => {
      const servers = await window.openbot.servers.list();
      const remote = servers.find((server) => server.kind === "remote");
      if (!remote) return null;
      if (!remote.active) await window.openbot.servers.select(remote.id);
      return remote.name;
    })()`);
    assert.ok(selected, "The test client has no remote server. Restart the test client after the host registers.");
    logger.info(`server: ${String(selected)}`);
  } finally {
    await session.close();
  }
}

/** Waits until the window shows the workspace, and no loading screen covers it any more. */
async function waitForWorkspace(page: Page, what: string): Promise<void> {
  // A hidden dev window gets no animation frames, so the page checks the state at an interval.
  await page
    .waitForFunction(
      // A function, not a string: the window's CSP refuses `eval`.
      () =>
        performance.getEntriesByName("openbot:remote-workspace-ready").length > 0 &&
        document.querySelector(".app-loading") === null,
      undefined,
      { polling: POLL_MS, timeout: WAIT_MS },
    )
    .catch((error: unknown) => {
      throw new Error(`Timed out: ${what}.`, { cause: error });
    });
}

async function measureCover(page: Page): Promise<Cover> {
  return poll("the crew pit shows", () => page.evaluate<Cover | null>(COVER));
}

/** Grows the window to the size of the screen, as full screen does, while the crew fall. */
async function growWindow(page: Page, cdp: CDPSession): Promise<{ before: Cover; after: Cover }> {
  const before = await measureCover(page);
  const screen = await page.evaluate<{ width: number; height: number }>(
    "({ width: screen.width, height: screen.height })",
  );
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: screen.width,
    height: screen.height,
    deviceScaleFactor: 0,
    mobile: false,
  });
  // Two frames: a resize observer runs in the first, and its style change shows in the second.
  await page.evaluate("new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))");
  const after = await measureCover(page);
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: resolve(OUT, "full-screen.png") });
  await cdp.send("Emulation.clearDeviceMetricsOverride");
  return { before, after };
}

/** Reloads the window, which always plays the splash, and grows the window while the crew fall. */
async function checkCover(instance: DevInstanceRecord): Promise<{ before: Cover; after: Cover }> {
  const session = await connect(instance);
  try {
    const page = session.page;
    await page.reload({ waitUntil: "commit" });
    const cdp = await page.context().newCDPSession(page);
    const cover = await growWindow(page, cdp);
    logger.info("cover", JSON.stringify(cover));
    return cover;
  } finally {
    await session.close();
  }
}

/** Null when the window showed no loading screen after the attach: the splash ended before it. */
async function run(previous: DevInstanceRecord): Promise<RunReport | null> {
  const restart = spawn("bun", ["scripts/dev-stack.ts", "restart-client"], { cwd: ROOT, stdio: "inherit" });
  const restarted = new Promise<void>((done, fail) => {
    restart.once("error", fail);
    restart.once("exit", (code) => (code === 0 ? done() : fail(new Error(`restart-client exited with ${code}.`))));
  });
  // A failure before the wait below must not leave this rejection unhandled. The wait still gets it.
  restarted.catch(() => undefined);
  const resumes: (() => void)[] = [];
  try {
    const instance = await poll("the test client starts again", async () => {
      const next = testClient();
      return next.pid !== previous.pid ? next : null;
    });
    if (pauseHostS > 0) resumes.push(pause("The dev host", hostMainPid(), pauseHostS));
    const report = await recordStart(instance, resumes);
    await restarted;
    return report;
  } finally {
    for (const resume of resumes) resume();
  }
}

/** Null when the recorder saw no loading screen. */
async function readReport(page: Page): Promise<RunReport | null> {
  const log = await page.evaluate<SplashLog>("window.__splashLog");
  if (log.screens.length === 0) return null;
  // The start splash rained before the attach. A pile seen later is a new rain.
  const unseenSplash = log.splashEndedAtAttach;
  const ready = await page.evaluate<number | null>(
    `performance.getEntriesByName("openbot:remote-workspace-ready")[0]?.startTime ?? null`,
  );
  return {
    rains: log.starts.length + (unseenSplash ? 1 : 0),
    unseenSplash,
    attachedAt: log.attachedAt,
    screens: log.screens,
    states: log.states,
    auth: log.auth,
    workspaceReadyMs: ready === null ? null : Math.round(ready),
  };
}

/**
 * Reloads the window while main loads the account and the account service does not answer. The
 * recorder starts with the new page, so it sees every rain.
 */
async function checkAccountWait(instance: DevInstanceRecord): Promise<RunReport> {
  const session = await connect(instance);
  let resume: (() => void) | undefined;
  try {
    const page = session.page;
    await page.addInitScript(RECORDER);
    resume = pause("The account service", -accountServiceGroup(), accountWaitS);
    await page.evaluate("void window.openbot.auth.retry().catch(() => undefined)");
    await poll("main loads the account", async () =>
      (await page.evaluate("window.openbot.auth.getState().then((state) => state.status)")) === "loading" ? true : null,
    );
    await page.reload({ waitUntil: "commit" });
    await waitForWorkspace(page, "the workspace shows after the account loads");
    const report = await readReport(page);
    assert.ok(report, "The reloaded window showed no loading screen.");
    logger.info("account", JSON.stringify(report));
    return report;
  } finally {
    resume?.();
    await session.close();
  }
}

async function recordStart(instance: DevInstanceRecord, resumes: (() => void)[]): Promise<RunReport | null> {
  const session = await poll("the new window takes a CDP connection", () => connect(instance));
  try {
    const page = session.page;
    await page.evaluate(RECORDER);
    if (pauseOnlineS > 0) {
      // The renderer marks the start of each workspace load. The first one waits for the online link.
      await page.evaluate(`new Promise((done) => {
        const observer = new PerformanceObserver((list) => {
          if (!list.getEntriesByName("openbot:remote-workspace-load").length) return;
          observer.disconnect();
          done(true);
        });
        observer.observe({ type: "mark", buffered: true });
      })`);
      resumes.push(pause("The dev host", hostMainPid(), pauseOnlineS));
    }
    await waitForWorkspace(page, "the workspace shows");
    return await readReport(page);
  } finally {
    await session.close();
  }
}

const instance = testClient();
assertMutationAllowed({
  command: "loading-splash restarts",
  allowMutations: process.argv.includes("--allow-mutations"),
  instanceNamed: true,
  target: instance.instanceId,
});
await selectRemoteServer(instance);
const cover = await checkCover(instance);
const account = await checkAccountWait(instance);
const reports: RunReport[] = [];
let missed = 0;
let current = instance;
while (reports.length < runs) {
  const report = await run(current);
  current = testClient();
  if (report) {
    reports.push(report);
    logger.info(`run ${reports.length}/${runs}`, JSON.stringify(report));
  } else {
    missed += 1;
    logger.info("The splash ended before the attach. The run starts again.");
    assert.ok(missed <= runs * 2, "Too many runs ended before the attach.");
  }
}
mkdirSync(OUT, { recursive: true });
const failures = [
  ...(account.rains === 1 ? [] : [`account: ${account.rains} rains`]),
  ...reports.flatMap((report, index) => (report.rains === 1 ? [] : [`run ${index + 1}: ${report.rains} rains`])),
  ...(cover.after.share < 0.999 ? [`the pit covers ${(cover.after.share * 100).toFixed(1)}% of the grown window`] : []),
];
writeFileSync(
  resolve(OUT, "report.json"),
  `${JSON.stringify({ label, pauseHostS, pauseOnlineS, accountWaitS, cover, account, runs: reports, missed, failures }, null, 2)}\n`,
);
logger.info(`report: ${resolve(OUT, "report.json")}`);
assert.deepEqual(failures, [], failures.join("; "));
