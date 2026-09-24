// `bun run dev:bench`: repeatable RAM and CPU scenarios on the built app.
//
// Each run seeds the bench's own profile, starts the built app on it, samples
// the process tree from spawn to exit, drives one scenario over CDP, collects
// garbage, reads the settled state and stops the app. Several runs reduce to a
// median with its spread, and `--compare` prints the deltas against an earlier
// report, which is what a fix PR quotes.
//
// Everything this touches is the bench profile (`OpenBot Dev wt-<hash of
// this worktree>#bench`) and the process group it started. It never reaches a
// dev instance, another worktree, or the developer's own profile.

import { lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { type Browser, chromium, type Page } from "playwright-core";
import { developmentInstanceIdForWorktree, developmentUserDataName } from "../../src/main/development-profile";
import { resolveDevelopmentAppDataRoot } from "../development-state-paths";
import { cleanupSeedOwnedTransfers, seedDevelopmentState } from "../seed-dev-state";
import { ensureBenchAuthApi, signInBenchAccount } from "./bench-auth";
import { type BenchApp, launchBenchApp } from "./bench-launch";
import { SCENARIOS, type Scenario, SECOND, type SeedPlan } from "./bench-scenarios";
import {
  type BenchReport,
  type MetricValues,
  parseBenchReport,
  type RunResult,
  renderComparison,
  renderReport,
  type ScenarioReport,
  seriesStats,
  summarizeRuns,
} from "./bench-stats";
import { verifyBrowserOwnership } from "./cdp-client";
import { InspectorClient } from "./inspector-client";
import { writeHeapSnapshot } from "./memory-profile";
import { ResourceSampler } from "./resource-sampler";

const logger = createOpenBotLogger("dev-bench", (line) => process.stderr.write(`${line}\n`), "info");

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BENCH_ROOT = join(PROJECT_ROOT, ".openbot-build", "dev-automation", "bench");
const READY_TIMEOUT_MS = 90_000;
// The signed-in session, encrypted with the OS keychain. A reseed keeps it, so
// each run opens the workspace the way a returning user does, without a new
// sign-in inside the measured window.
const CENTRAL_AUTH_FILE = "openbot-central-auth-v1.bin";

// The bench profile. Its own instance id, so a bench never seeds over the
// isolated dev profile of this worktree.
const INSTANCE_ID = developmentInstanceIdForWorktree(`${PROJECT_ROOT}#bench`);

// Seeded agents run on Claude: the bench never starts Codex, and a turn
// scenario switches the agent to the provider it measures.
const BENCH_AGENT_MODEL = { provider: "claude", model: "claude-sonnet-5", reasoningEffort: "low" } as const;

// How long `--cpu-profile` records the app window once a scenario has settled.
const CPU_PROFILE_MS = 15 * SECOND;
const TRACE_MS = 5 * SECOND;
const TRACE_CATEGORIES = ["devtools.timeline", "disabled-by-default-devtools.timeline", "blink", "cc", "v8.execute"];

const wait = (milliseconds: number) => new Promise<void>((resolveWait) => setTimeout(resolveWait, milliseconds));

function benchProfilePath(): { appDataRoot: string; profile: string } {
  const appDataRoot = resolveDevelopmentAppDataRoot(process.platform, process.env, homedir());
  const profile = resolve(appDataRoot, developmentUserDataName("app", INSTANCE_ID));
  if (dirname(profile) !== appDataRoot) throw new Error(`Unsafe bench profile path: ${profile}`);
  return { appDataRoot, profile };
}

async function prepareProfile(plan: SeedPlan): Promise<void> {
  const { profile } = benchProfilePath();
  const authPath = join(profile, CENTRAL_AUTH_FILE);
  const session = await readFile(authPath).catch(() => null);
  await replaceProfile(plan);
  if (!session) return;
  await mkdir(profile, { recursive: true, mode: 0o700 });
  await writeFile(authPath, session, { mode: 0o600 });
}

async function replaceProfile(plan: SeedPlan): Promise<void> {
  const { appDataRoot, profile } = benchProfilePath();
  if (plan.kind === "seed") {
    await seedDevelopmentState({
      appDataRoot,
      instanceId: INSTANCE_ID,
      agentModel: BENCH_AGENT_MODEL,
      scale: plan.scale,
    });
    return;
  }
  // The bench's own profile, named from this worktree: nothing else writes it.
  try {
    await lstat(profile);
  } catch {
    return;
  }
  await cleanupSeedOwnedTransfers(profile);
  await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}

async function waitFor<T>(what: string, timeoutMs: number, probe: () => Promise<T | null>): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const value = await probe();
      if (value !== null) return value;
    } catch {
      // Not up yet.
    }
    if (Date.now() > deadline) throw new Error(`Timed out after ${timeoutMs} ms waiting for ${what}.`);
    await wait(250);
  }
}

function isAppWindowUrl(url: string): boolean {
  return url.startsWith("openbot-app://app/index.html") && !url.includes("surface=");
}

async function findAppPage(browser: Browser): Promise<Page | null> {
  for (const page of browser.contexts().flatMap((context) => context.pages())) {
    if (!isAppWindowUrl(page.url())) continue;
    if ((await page.evaluate("typeof window.openbot").catch(() => "")) === "object") return page;
  }
  return null;
}

async function connect(app: BenchApp): Promise<{ browser: Browser; page: Page }> {
  await waitFor("the CDP port", READY_TIMEOUT_MS, async () => {
    const response = await fetch(`http://127.0.0.1:${app.remoteDebuggingPort}/json/version`);
    return response.ok ? true : null;
  });
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${app.remoteDebuggingPort}`);
  if (!(await verifyBrowserOwnership(browser, app.pid))) {
    await browser.close();
    throw new Error(`The browser on :${app.remoteDebuggingPort} is not the bench app this run started.`);
  }
  const page = await waitFor("the app window", READY_TIMEOUT_MS, () => findAppPage(browser));
  // Ready means the backend answers, not only that the window painted.
  const agentCount = await waitFor("the agent list", READY_TIMEOUT_MS, () =>
    page.evaluate<number>("window.openbot.agent.listAgents().then((agents) => agents.length)"),
  );
  await signInBenchAccount(page, logger);
  // The workspace, not the sign-in or connecting screen, is what a run measures.
  if (agentCount > 0) {
    await page.locator("[data-chat-id]").first().waitFor({ state: "attached", timeout: READY_TIMEOUT_MS });
  }
  return { browser, page };
}

/** Counts the running animations in the page by name and element, such as `3× pulse on span.dot`. */
const RUNNING_ANIMATIONS = `(() => {
  const counts = new Map();
  for (const animation of document.getAnimations()) {
    if (animation.playState !== "running") continue;
    const target = animation.effect instanceof KeyframeEffect ? animation.effect.target : null;
    const element = target instanceof Element ? [target.tagName.toLowerCase(), ...target.classList].join(".") : "?";
    const key = (animation.animationName ?? animation.constructor.name) + " on " + element;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].map(([key, count]) => count + "× " + key);
})()`;

/** Counts the `requestAnimationFrame` calls in one second. A loop that asks for a frame each time keeps the
 * renderer drawing at the display rate even when nothing changes on screen. */
const ANIMATION_FRAME_REQUESTS = `new Promise((resolve) => {
  const original = window.requestAnimationFrame;
  let count = 0;
  window.requestAnimationFrame = (callback) => {
    count += 1;
    return original.call(window, callback);
  };
  setTimeout(() => {
    window.requestAnimationFrame = original;
    resolve(count);
  }, 1000);
})`;

/** Records what the app window's JavaScript does while the scenario is otherwise idle. */
async function writeCpuProfile(browser: Browser, page: Page, path: string): Promise<void> {
  const session = await page.context().newCDPSession(page);
  try {
    await session.send("Profiler.enable");
    await session.send("Profiler.start");
    await wait(CPU_PROFILE_MS);
    const { profile } = await session.send("Profiler.stop");
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(profile));
    logger.info(`CPU profile written to ${path}`);
    // Compositor and style work for an animation shows in the profile only as "(program)".
    const animations = await page.evaluate<string[]>(RUNNING_ANIMATIONS);
    logger.info(`running animations: ${animations.length === 0 ? "none" : animations.join(", ")}`);
    // A timeline trace names the native work: style, layout, paint, observers and timers.
    const tracePath = path.replace(/\.cpuprofile$/u, ".trace.json");
    await browser.startTracing(page, { path: tracePath, categories: TRACE_CATEGORIES });
    await wait(TRACE_MS);
    await browser.stopTracing();
    logger.info(`timeline trace written to ${tracePath}`);
  } finally {
    await session.detach().catch(() => undefined);
  }
}

interface RunOptions {
  label: string;
  authApiUrl: string;
  cpuProfile: boolean;
}

async function runOnce(
  scenario: Scenario,
  index: number,
  { label, authApiUrl, cpuProfile }: RunOptions,
): Promise<RunResult> {
  await prepareProfile(scenario.seed);
  const spawnedAt = Date.now();
  const app = await launchBenchApp({
    projectRoot: PROJECT_ROOT,
    instanceId: INSTANCE_ID,
    logger,
    environment: { OPENBOT_AUTH_API_URL: authApiUrl },
    logPath: join(BENCH_ROOT, "logs", `${label}-${scenario.id}-${index + 1}.log`),
  });
  let browser: Browser | null = null;
  let page: Page | null = null;
  let inspector: InspectorClient | null = null;
  const sampler = new ResourceSampler({
    browser: () => browser,
    inspector: () => inspector,
    appPage: () => page,
    rootPid: app.pid,
    logger,
  });
  sampler.start();
  try {
    const connected = await connect(app);
    browser = connected.browser;
    page = connected.page;
    const readyMs = Date.now() - spawnedAt;
    // A render error can leave the window empty, which reads as a large saving. Count errors, so
    // the report shows a broken run.
    const pageErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") pageErrors.push(message.text());
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));
    inspector = await InspectorClient.connect(app.inspectorPort).catch((error: unknown) => {
      logger.warn(`no main-process heap: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    });
    const appWindow = page;
    const recorded: MetricValues = {};
    const actStarted = Date.now();
    await scenario.act({
      app,
      browser,
      page: appWindow,
      inspector,
      logger,
      evaluate: <T>(expression: string) => appWindow.evaluate<T>(expression),
      wait,
      record: (values) => Object.assign(recorded, values),
    });
    const actMs = Date.now() - actStarted;
    // A click leaves the pointer on its target, and a hovered avatar animates until the pointer leaves.
    // A user who waits does not usually keep the pointer on a row, so the settled numbers must not count it.
    await appWindow.mouse.move(-1, -1);
    const samples = await sampler.stop();
    const settled: MetricValues = {
      ...(await sampler.settled(scenario.settleMs ?? 10 * SECOND)),
      ...recorded,
      "time.readyMs": readyMs,
      "time.actMs": actMs,
      "errors.page": pageErrors.length,
      "frames.requestsPerSecond": await appWindow.evaluate<number>(ANIMATION_FRAME_REQUESTS),
    };
    for (const error of pageErrors.slice(0, 3)) logger.warn(`page error: ${error.split("\n", 1)[0]}`);
    const base = join(BENCH_ROOT, "snapshots", `${label}-${scenario.id}`);
    if (cpuProfile && index === 0) await writeCpuProfile(connected.browser, appWindow, `${base}-renderer.cpuprofile`);
    if (scenario.snapshots && index === 0) {
      await inspector?.writeHeapSnapshot(`${base}-main.heapsnapshot`);
      await writeHeapSnapshot(appWindow, `${base}-renderer.heapsnapshot`, logger);
      logger.info(`heap snapshots written under ${join(BENCH_ROOT, "snapshots")}`);
    }
    const first = samples[0];
    const last = samples[samples.length - 1];
    return {
      durationMs: first && last ? last.atMs - first.atMs : 0,
      samples: samples.length,
      series: seriesStats(samples.map((sample) => sample.values)),
      settled,
    };
  } finally {
    await sampler.stop();
    inspector?.close();
    await browser?.close().catch(() => undefined);
    await app.stop();
  }
}

// --- command line ----------------------------------------------------------

function flagValue(name: string): string | null {
  const passed = process.argv.find((argument) => argument.startsWith(`${name}=`));
  return passed === undefined ? null : passed.slice(name.length + 1);
}

function selectScenarios(selector: string): Scenario[] {
  if (selector === "all") return SCENARIOS;
  const wanted = selector.split(",").map((part) => part.trim());
  const selected = SCENARIOS.filter((scenario) =>
    wanted.some((name) => scenario.id === name || scenario.id.startsWith(`${name}-`)),
  );
  if (selected.length === 0) {
    throw new Error(`No scenario matches "${selector}". Known: ${SCENARIOS.map((one) => one.id).join(", ")}.`);
  }
  return selected;
}

async function main(): Promise<void> {
  const selector = flagValue("--scenario");
  if (selector === null || selector.trim() === "") {
    throw new Error(
      `--scenario=<id|prefix|all> is required. Scenarios:\n${SCENARIOS.map((one) => `- ${one.id}: ${one.description}`).join("\n")}`,
    );
  }
  const runs = Number(flagValue("--runs") ?? "3");
  if (!Number.isInteger(runs) || runs < 1 || runs > 20) throw new Error("--runs must be an integer from 1 to 20.");
  const label = flagValue("--label") ?? new Date().toISOString().replaceAll(/[:.]/g, "-");
  if (!/^[\w.-]+$/u.test(label)) throw new Error("--label may hold letters, digits, dot, dash and underscore only.");
  const comparePath = flagValue("--compare");
  const cpuProfile = process.argv.includes("--cpu-profile");
  const baseline = comparePath ? parseBenchReport(JSON.parse(await readFile(comparePath, "utf8"))) : null;
  if (comparePath && !baseline) throw new Error(`${comparePath} is not a dev:bench report.`);

  const scenarios: ScenarioReport[] = [];
  const report = (): BenchReport => ({
    label,
    createdAt: new Date().toISOString(),
    build: "built bundle (out/), unpackaged Electron",
    scenarios,
  });
  await mkdir(BENCH_ROOT, { recursive: true });
  const jsonPath = join(BENCH_ROOT, `${label}.json`);
  const authApi = await ensureBenchAuthApi(PROJECT_ROOT, BENCH_ROOT, logger);
  // A long `all` run continues past a scenario that fails, and names it at the end.
  const failed: string[] = [];
  try {
    for (const scenario of selectScenarios(selector)) {
      const results: RunResult[] = [];
      try {
        for (let index = 0; index < runs; index += 1) {
          logger.info(`${scenario.id}: run ${index + 1} of ${runs}`);
          results.push(await runOnce(scenario, index, { label, authApiUrl: authApi.url, cpuProfile }));
        }
      } catch (error) {
        logger.error(`${scenario.id} failed: ${error instanceof Error ? error.message : String(error)}`);
        failed.push(scenario.id);
        continue;
      }
      scenarios.push({
        scenario: scenario.id,
        description: scenario.description,
        runs: results,
        metrics: summarizeRuns(results),
      });
      // After each scenario, so a long `all` run that fails late keeps what it measured.
      await writeFile(jsonPath, `${JSON.stringify(report(), null, 2)}\n`);
    }
  } finally {
    await authApi.stop();
  }
  const markdown = renderReport(report());
  await writeFile(join(BENCH_ROOT, `${label}.md`), `${markdown}\n`);
  process.stdout.write(`${markdown}\n`);
  if (baseline) {
    const comparison = renderComparison(baseline, report());
    await writeFile(join(BENCH_ROOT, `${label}.compare.md`), `${comparison}\n`);
    process.stdout.write(`\n${comparison}\n`);
  }
  logger.info(`report written to ${jsonPath}`);
  if (failed.length > 0) {
    logger.error(`scenarios with no report: ${failed.join(", ")}`);
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  logger.error(toLogValue(error));
  process.exitCode = 1;
});
