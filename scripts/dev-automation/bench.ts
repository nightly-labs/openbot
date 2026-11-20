import { lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { type Browser, chromium, type Page } from "playwright-core";
import { developmentInstanceIdForWorktree, developmentUserDataName } from "../../src/main/development-profile";
import { resolveDevelopmentAppDataRoot } from "../development-state-paths";
import { readScriptArguments } from "../script-arguments";
import { cleanupSeedOwnedTransfers, seedDevelopmentState } from "../seed-dev-state";
import { ensureBenchAuthApi, signInBenchAccount } from "./bench-auth";
import { checkBudget, parseBudget } from "./bench-budget";
import { type BenchApp, launchBenchApp } from "./bench-launch";
import { assertBenchBuild, PROBES_ENVIRONMENT, startProbes } from "./bench-probes";
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
import { readStartupMarks, startRenderRecording } from "./render-metrics";
import { ResourceSampler } from "./resource-sampler";

const logger = createOpenBotLogger("dev-bench", (line) => process.stderr.write(`${line}\n`), "info");

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BENCH_ROOT = join(PROJECT_ROOT, ".openbot-build", "dev-automation", "bench");
const READY_TIMEOUT_MS = 90_000;
const CENTRAL_AUTH_FILE = "openbot-central-auth-v1.bin";

const INSTANCE_ID = developmentInstanceIdForWorktree(`${PROJECT_ROOT}#bench`);

const BENCH_AGENT_MODEL = { provider: "claude", model: "claude-sonnet-5", reasoningEffort: "low" } as const;

const CPU_PROFILE_MS = 15 * SECOND;
const TRACE_MS = 5 * SECOND;
const ACT_TRACE_DELAY_MS = 5 * SECOND;
const ACT_TRACE_MS = 8 * SECOND;
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
    } catch {}
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
  await waitFor("the app page", READY_TIMEOUT_MS, async () => {
    const response = await fetch(`http://127.0.0.1:${app.remoteDebuggingPort}/json/list`);
    const targets = response.ok ? await response.json() : null;
    if (!Array.isArray(targets)) return null;
    return targets.some((target) => isDynamicRecord(target) && isString(target.url) && isAppWindowUrl(target.url))
      ? true
      : null;
  });
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${app.remoteDebuggingPort}`);
  if (!(await verifyBrowserOwnership(browser, app.pid))) {
    await browser.close();
    throw new Error(`The browser on :${app.remoteDebuggingPort} is not the bench app this run started.`);
  }
  const page = await waitFor("the app window", READY_TIMEOUT_MS, () => findAppPage(browser));
  const agentCount = await waitFor("the agent list", READY_TIMEOUT_MS, () =>
    page.evaluate<number>("window.openbot.agent.listAgents().then((agents) => agents.length)"),
  );
  await signInBenchAccount(page, logger);
  if (agentCount > 0) {
    await page.locator(".sidebar-agent-item").first().waitFor({ state: "attached", timeout: READY_TIMEOUT_MS });
  }
  return { browser, page };
}

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
    const animations = await page.evaluate<string[]>(RUNNING_ANIMATIONS);
    logger.info(`running animations: ${animations.length === 0 ? "none" : animations.join(", ")}`);
    const tracePath = path.replace(/\.cpuprofile$/u, ".trace.json");
    await browser.startTracing(page, { path: tracePath, categories: TRACE_CATEGORIES });
    await wait(TRACE_MS);
    await browser.stopTracing();
    logger.info(`timeline trace written to ${tracePath}`);
  } finally {
    await session.detach().catch(() => undefined);
  }
}

async function writeActTrace(browser: Browser, page: Page, base: string, actDone: Promise<void>): Promise<void> {
  const started = await Promise.race([wait(ACT_TRACE_DELAY_MS).then(() => true), actDone.then(() => false)]);
  if (!started) return;
  const session = await page.context().newCDPSession(page);
  try {
    await mkdir(dirname(base), { recursive: true });
    await session.send("Profiler.enable");
    await session.send("Profiler.start");
    await browser.startTracing(page, { path: `${base}-act.trace.json`, categories: TRACE_CATEGORIES });
    await Promise.race([wait(ACT_TRACE_MS), actDone]);
    await browser.stopTracing();
    const { profile } = await session.send("Profiler.stop");
    await writeFile(`${base}-act-renderer.cpuprofile`, JSON.stringify(profile));
    logger.info(`act trace and CPU profile written to ${base}-act.trace.json and ${base}-act-renderer.cpuprofile`);
  } finally {
    await session.detach().catch(() => undefined);
  }
}

interface RunOptions {
  label: string;
  authApiUrl: string;
  cpuProfile: boolean;
  frames: boolean;
  callCounts: boolean;
  probes: boolean;
  solidCauses: boolean;
  mainProfile: boolean;
  traceAct: boolean;
}

async function startMainProfile(inspector: InspectorClient): Promise<() => Promise<unknown>> {
  await inspector.send("Profiler.enable");
  await inspector.send("Profiler.start");
  return async () => {
    const result = await inspector.send("Profiler.stop");
    await inspector.send("Profiler.disable").catch(() => undefined);
    return isDynamicRecord(result) ? result.profile : null;
  };
}

async function writeFailureScreenshot(page: Page, path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const written = await page
    .screenshot({ path, timeout: 10 * SECOND })
    .then(() => true)
    .catch(() => false);
  if (written) logger.info(`failure screenshot written to ${path}`);
  const rows = await page
    .evaluate<string[]>(
      `[...document.querySelectorAll(".sidebar-agent-item")].map((row) => row.getAttribute("data-chat-id") ?? "(none)")`,
    )
    .catch(() => []);
  logger.info(`sidebar rows: ${rows.join(", ")}`);
}

async function runOnce(
  scenario: Scenario,
  index: number,
  { label, authApiUrl, cpuProfile, frames, callCounts, probes, solidCauses, mainProfile, traceAct }: RunOptions,
): Promise<RunResult> {
  await prepareProfile(scenario.seed);
  const scenarioEnvironment = scenario.prepare
    ? await scenario.prepare(join(BENCH_ROOT, "scenarios", `${label}-${scenario.id}`))
    : {};
  const spawnedAt = Date.now();
  const app = await launchBenchApp({
    projectRoot: PROJECT_ROOT,
    instanceId: INSTANCE_ID,
    logger,
    environment: {
      ...scenarioEnvironment,
      ...(probes ? PROBES_ENVIRONMENT : {}),
      OPENBOT_AUTH_API_URL: authApiUrl,
    },
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
    const startup = await readStartupMarks(appWindow, inspector);
    const recorded: MetricValues = {};
    const probeRecording = probes ? await startProbes(inspector, connected.browser, logger, { solidCauses }) : null;
    const stopMainProfile = mainProfile && index === 0 && inspector ? await startMainProfile(inspector) : null;
    const stopRenderRecording = await startRenderRecording(appWindow, { frames, callCounts });
    const actStarted = Date.now();
    let finishAct = () => {};
    const actDone = new Promise<void>((resolve) => {
      finishAct = resolve;
    });
    const actTrace =
      traceAct && index === 0
        ? writeActTrace(connected.browser, appWindow, join(BENCH_ROOT, "snapshots", `${label}-${scenario.id}`), actDone)
        : null;
    await scenario
      .act({
        app,
        browser,
        page: appWindow,
        inspector,
        logger,
        evaluate: <T>(expression: string) => appWindow.evaluate<T>(expression),
        wait,
        record: (values) => Object.assign(recorded, values),
      })
      .finally(finishAct);
    await actTrace;
    const actMs = Date.now() - actStarted;
    const renderWork = await stopRenderRecording();
    const mainCpuProfile = stopMainProfile ? await stopMainProfile() : null;
    const probeReport = probeRecording ? await probeRecording.stop(recorded) : null;
    await appWindow.mouse.move(-1, -1);
    const samples = await sampler.stop();
    const settled: MetricValues = {
      ...(await sampler.settled(scenario.settleMs ?? 10 * SECOND)),
      ...recorded,
      ...startup,
      ...renderWork.values,
      ...probeReport?.metrics,
      "time.readyMs": readyMs,
      "time.actMs": actMs,
      "errors.page": pageErrors.length,
      "frames.requestsPerSecond": await appWindow.evaluate<number>(ANIMATION_FRAME_REQUESTS),
    };
    for (const error of pageErrors.slice(0, 3)) logger.warn(`page error: ${error.split("\n", 1)[0]}`);
    const base = join(BENCH_ROOT, "snapshots", `${label}-${scenario.id}`);
    if (renderWork.topCalls && index === 0) {
      await mkdir(dirname(base), { recursive: true });
      await writeFile(`${base}-call-counts.json`, `${JSON.stringify(renderWork.topCalls, null, 2)}\n`);
      for (const call of renderWork.topCalls.slice(0, 10)) logger.info(`calls: ${call.calls}× ${call.function}`);
    }
    if (mainCpuProfile) {
      await mkdir(dirname(base), { recursive: true });
      await writeFile(`${base}-main.cpuprofile`, JSON.stringify(mainCpuProfile));
      logger.info(`main CPU profile written to ${base}-main.cpuprofile`);
    }
    if (probeReport) {
      const probePath = join(BENCH_ROOT, "probes", `${label}-${scenario.id}-${index + 1}-probes.json`);
      await mkdir(dirname(probePath), { recursive: true });
      await writeFile(probePath, `${JSON.stringify(probeReport, null, 2)}\n`);
      logger.info(`probe report written to ${probePath}`);
    }
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
  } catch (error) {
    if (page)
      await writeFailureScreenshot(
        page,
        join(BENCH_ROOT, "snapshots", `${label}-${scenario.id}-${index + 1}-failed.png`),
      );
    throw error;
  } finally {
    await sampler.stop();
    inspector?.close();
    await browser?.close().catch(() => undefined);
    await app.stop();
  }
}

const USAGE = [
  "Usage: bun run dev:bench --scenario=<id|prefix|all> [--runs=<n>] [--label=<name>] [--compare=<report.json>]",
  "                         [--cpu-profile] [--frames] [--call-counts] [--probes] [--solid-causes] [--main-profile]",
  "                         [--trace-act]",
  "                         [--budget=<perf-budgets.json>]",
  "",
  "Scenarios:",
  ...SCENARIOS.map((one) => `- ${one.id}: ${one.description}`),
].join("\n");

const OPTIONS = {
  scenario: { type: "string" },
  runs: { type: "string" },
  label: { type: "string" },
  compare: { type: "string" },
  "cpu-profile": { type: "boolean" },
  frames: { type: "boolean" },
  "call-counts": { type: "boolean" },
  probes: { type: "boolean" },
  "solid-causes": { type: "boolean" },
  "main-profile": { type: "boolean" },
  "trace-act": { type: "boolean" },
  budget: { type: "string" },
} as const;

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
  const parsed = readScriptArguments({ usage: USAGE, options: OPTIONS });
  if (parsed === null) return;
  const selector = parsed.values.scenario;
  if (selector === undefined || selector.trim() === "") {
    throw new Error(`--scenario=<id|prefix|all> is required.\n${USAGE}`);
  }
  const runs = Number(parsed.values.runs ?? "3");
  if (!Number.isInteger(runs) || runs < 1 || runs > 20) throw new Error("--runs must be an integer from 1 to 20.");
  const label = parsed.values.label ?? new Date().toISOString().replaceAll(/[:.]/g, "-");
  if (!/^[\w.-]+$/u.test(label)) throw new Error("--label may hold letters, digits, dot, dash and underscore only.");
  const comparePath = parsed.values.compare;
  const cpuProfile = parsed.values["cpu-profile"] ?? false;
  const frames = parsed.values.frames ?? false;
  const callCounts = parsed.values["call-counts"] ?? false;
  const probes = parsed.values.probes ?? false;
  const mainProfile = parsed.values["main-profile"] ?? false;
  const solidCauses = parsed.values["solid-causes"] ?? false;
  const traceAct = parsed.values["trace-act"] ?? false;
  if (solidCauses && !probes) throw new Error("--solid-causes needs --probes.");
  if (probes) assertBenchBuild(PROJECT_ROOT);
  const budgetPath = parsed.values.budget;
  const budget = budgetPath ? parseBudget(JSON.parse(await readFile(budgetPath, "utf8"))) : null;
  if (budgetPath && !budget) throw new Error(`${budgetPath} is not a perf budget file.`);
  const baseline = comparePath ? parseBenchReport(JSON.parse(await readFile(comparePath, "utf8"))) : null;
  if (comparePath && !baseline) throw new Error(`${comparePath} is not a dev:bench report.`);

  const scenarios: ScenarioReport[] = [];
  const report = (): BenchReport => ({
    label,
    createdAt: new Date().toISOString(),
    build: probes ? "bench bundle (out/, probes on), unpackaged Electron" : "built bundle (out/), unpackaged Electron",
    scenarios,
  });
  await mkdir(BENCH_ROOT, { recursive: true });
  const jsonPath = join(BENCH_ROOT, `${label}.json`);
  const authApi = await ensureBenchAuthApi(PROJECT_ROOT, BENCH_ROOT, logger);
  const failed: string[] = [];
  try {
    for (const scenario of selectScenarios(selector)) {
      const results: RunResult[] = [];
      try {
        for (let index = 0; index < runs; index += 1) {
          logger.info(`${scenario.id}: run ${index + 1} of ${runs}`);
          results.push(
            await runOnce(scenario, index, {
              label,
              authApiUrl: authApi.url,
              cpuProfile,
              frames,
              callCounts,
              probes,
              solidCauses,
              mainProfile,
              traceAct,
            }),
          );
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
  if (budget) {
    const result = checkBudget(budget, report());
    await writeFile(join(BENCH_ROOT, `${label}.budget.md`), `${result.markdown}\n`);
    process.stdout.write(`\n${result.markdown}\n`);
    if (result.failures > 0) process.exitCode = 1;
  }
  if (failed.length > 0) {
    logger.error(`scenarios with no report: ${failed.join(", ")}`);
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  logger.error(toLogValue(error));
  process.exitCode = 1;
});
