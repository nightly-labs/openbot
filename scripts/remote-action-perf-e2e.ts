import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { translateFor } from "@openbot/i18n";
import { createOpenBotLogger } from "@openbot/logging";
import type { RemoteRequestRecord } from "@openbot/team-client/sync-profile";
import { type Browser, chromium, type ElementHandle, type Locator, type Page } from "playwright-core";
import { argument, WAIT_MS } from "./channel-e2e-support";
import { type Spread, spread } from "./dev-automation/bench-stats";
import {
  addNetworkLatency,
  delay,
  instrumentRemotePeer,
  literal,
  readSyncSink,
  signInDevHost,
} from "./remote-perf-support";

declare global {
  interface Window {
    __actionStart?: number | null;
  }
}

const NAME = "remote-action-perf";
const ROOT = resolve(import.meta.dirname, "..");
const READY_MARK = "openbot:remote-workspace-ready";
const QUIET_MS = 700;
const english = translateFor("en");
const logger = createOpenBotLogger(NAME);

const runs = Number(argument("runs") ?? "5");
assert.ok(Number.isInteger(runs) && runs >= 1, "--runs takes a whole number, 1 or more.");
const label = argument("label") ?? "baseline";
assert.match(label, /^\w[\w.-]*$/, "--label takes a folder name, not a path.");
const OUT = resolve(ROOT, ".openbot-build", NAME, label);
const api = (argument("api") ?? "http://localhost:3100").replace(/\/$/, "");
const latencyMs = Number(argument("latency") ?? "200");
assert.ok(Number.isInteger(latencyMs) && latencyMs >= 0, "--latency takes a whole number of milliseconds.");
const comparePath = argument("compare");
const browserExecutable = argument("browser-executable");
const only = argument("actions")?.split(",");
const chatAgent = argument("chat-agent") ?? "Chief";
const sidebarAgent = argument("sidebar-agent") ?? "Research";
const channelName = argument("channel") ?? "Launch room";
const routineName = argument("routine") ?? "Morning launch brief";
const reactionEmoji = "👍";
const hostCdp = argument("host-cdp");
const sessionPath = argument("session");
const renamedChannel = `${channelName} renamed`;

type Visible =
  | { kind: "appear" | "disappear"; css: string | string[]; within?: string }
  | { kind: "checked"; handle: ElementHandle<Element>; checked: boolean }
  | null;

type HostAction = () => Promise<number>;

interface Step {
  name: string;
  prepare(page: Page): Promise<Locator | HostAction>;
  visible(page: Page): Promise<Visible>;
}

interface Sample {
  step: string;
  visibleMs: number | null;
  settledMs: number;
  requests: number;
  depth: number;
  routes: string[];
}

interface StepSummary {
  visibleMs: Spread | null;
  settledMs: Spread | null;
  requests: Spread | null;
  depth: Spread | null;
  routes: string[];
}

interface Report {
  label: string;
  createdAt: string;
  commit: string;
  runs: number;
  latencyMs: number;
  steps: Record<string, StepSummary>;
  samples: Sample[];
}

const startsWith = (text: string) => new RegExp(`^${literal(text)}`);
const attr = (value: string) => JSON.stringify(value);
const unreadPrefix = english("sidebar.unread.label", { count: 2 }).split("2")[0] ?? "";
const pinnedLabel = (agent: string) => english("sidebar.pinned.agent", { name: agent });
const removeReaction = english("chat.row.removeReaction", { emoji: reactionEmoji });
const composerLabel = (agent: string) => english("composer.placeholder.message", { name: agent });

function sidebarRow(page: Page, agent: string): Locator {
  return page.getByRole("button", { name: startsWith(`${agent},`) }).first();
}

async function openAgentMenu(page: Page, agent: string): Promise<void> {
  await sidebarRow(page, agent).click({ button: "right" });
  await page.getByRole("menu", { name: english("sidebar.agentMenu.label") }).waitFor({ timeout: WAIT_MS });
}

function menuItem(page: Page, text: string): Locator {
  return page.getByRole("menuitem", { name: text, exact: true });
}

async function isUnread(page: Page, agent: string): Promise<boolean> {
  return page.evaluate(
    ({ prefix, agent }) =>
      [...document.querySelectorAll(`[aria-label^="${prefix}"]`)].some((group) =>
        group.querySelector(`[aria-label^="${agent},"]`),
      ),
    { prefix: unreadPrefix, agent },
  );
}

function reactionTarget(page: Page): Locator {
  return page.locator("[data-action-perf-target]");
}

async function markReactionTarget(page: Page): Promise<void> {
  if ((await reactionTarget(page).count()) > 0) return;
  const article = page.locator('main [role="article"][data-author="user"]').last();
  await article.waitFor({ timeout: WAIT_MS });
  await article.evaluate((element) => element.setAttribute("data-action-perf-target", ""));
}

async function openChat(page: Page, agent: string): Promise<void> {
  await sidebarRow(page, agent).click();
  await page.getByRole("textbox", { name: composerLabel(agent) }).waitFor({ timeout: WAIT_MS });
}

async function routineSwitch(page: Page): Promise<Locator> {
  const control = page.getByRole("switch", { name: routineName, exact: true });
  if (await control.isVisible().catch(() => false)) return control;
  await openChat(page, chatAgent);
  const routines = page.getByRole("button", { name: startsWith(english("agentSettings.links.routines")) });
  if (!(await routines.isVisible().catch(() => false)))
    await page.getByRole("button", { name: english("conversation.header.settings") }).click();
  await routines.click();
  await control.waitFor({ timeout: WAIT_MS });
  return control;
}

async function checkedState(control: Locator): Promise<{ handle: ElementHandle<Element>; checked: boolean }> {
  const handle = await control.elementHandle();
  assert.ok(handle, "The routine switch has no element.");
  const checked = await handle.evaluate(
    (element) =>
      element.getAttribute("aria-checked") === "true" || (element instanceof HTMLInputElement && element.checked),
  );
  return { handle, checked };
}

const routineToggle = (state: { before: boolean | null }): Step => ({
  name: "routine-toggle",
  async prepare(page) {
    const control = await routineSwitch(page);
    state.before = (await checkedState(control)).checked;
    return control.locator("..");
  },
  async visible(page) {
    const { handle } = await checkedState(page.getByRole("switch", { name: routineName, exact: true }));
    return { kind: "checked", handle, checked: !state.before };
  },
});

const HOST_RENAME = `async ({ from, to }) => {
  const agent = window.openbot.agent;
  const channel = (await agent.listChannels()).find((item) => item.name === from);
  if (!channel) throw new Error("The host has no channel with this name.");
  const { title, instructions, members, leadAgentId, isolated, browser, icon } = channel;
  const started = performance.timeOrigin + performance.now();
  await agent.channelCommand({
    type: "save",
    operationId: crypto.randomUUID(),
    channelId: channel.id,
    update: true,
    draft: { name: to, title, instructions, members, leadAgentId, isolated, browser, icon },
  });
  return started;
}`;

let hostPage: Page | null = null;

async function hostRenderer(): Promise<Page> {
  if (hostPage) return hostPage;
  assert.ok(hostCdp, "--host-cdp takes the remote debugging port of the host app.");
  const host = await chromium.connectOverCDP(`http://127.0.0.1:${hostCdp}`);
  for (const context of host.contexts())
    for (const candidate of context.pages()) {
      const bridged = await candidate
        .evaluate("typeof window.openbot?.agent?.channelCommand === 'function'")
        .catch(() => false);
      if (bridged === true) {
        hostPage = candidate;
        return candidate;
      }
    }
  throw new Error("The host app has no window with the OpenBot bridge.");
}

function renameOnHost(from: string, to: string): HostAction {
  return async () => {
    const host = await hostRenderer();
    return Number(await host.evaluate(`(${HOST_RENAME})(${JSON.stringify({ from, to })})`));
  };
}

function channelRow(name: string): string {
  return `[aria-label^=${attr(`${name},`)}]`;
}

function steps(): Step[][] {
  const routineState: { before: boolean | null } = { before: null };
  const pairs: Record<string, Step[]> = {
    reaction: [
      {
        name: "reaction-add",
        async prepare(page) {
          await openChat(page, chatAgent);
          await settleNetwork(page, Date.now());
          await markReactionTarget(page);
          const target = reactionTarget(page);
          const existing = target.getByRole("button", { name: removeReaction, exact: true });
          if (await existing.isVisible().catch(() => false)) {
            await existing.click();
            await existing.waitFor({ state: "detached", timeout: WAIT_MS });
          }
          await target.hover();
          await target
            .getByRole("toolbar")
            .getByRole("button", { name: english("chat.actions.addReaction"), exact: true })
            .click();
          return page.getByRole("menuitemradio", { name: english("chat.actions.react", { emoji: reactionEmoji }) });
        },
        async visible() {
          return { kind: "appear", within: "[data-action-perf-target]", css: `[aria-label=${attr(removeReaction)}]` };
        },
      },
      {
        name: "reaction-remove",
        async prepare(page) {
          return reactionTarget(page).getByRole("button", { name: removeReaction, exact: true });
        },
        async visible() {
          return {
            kind: "disappear",
            within: "[data-action-perf-target]",
            css: `[aria-label=${attr(removeReaction)}]`,
          };
        },
      },
    ],
    pin: [
      {
        name: "agent-pin",
        async prepare(page) {
          await openAgentMenu(page, sidebarAgent);
          return menuItem(page, english("sidebar.pin"));
        },
        async visible() {
          return { kind: "appear", css: `[aria-label^=${attr(pinnedLabel(sidebarAgent))}]` };
        },
      },
      {
        name: "agent-unpin",
        async prepare(page) {
          await page.getByRole("button", { name: startsWith(pinnedLabel(sidebarAgent)) }).click({ button: "right" });
          return menuItem(page, english("sidebar.unpin"));
        },
        async visible() {
          return { kind: "disappear", css: `[aria-label^=${attr(pinnedLabel(sidebarAgent))}]` };
        },
      },
    ],
    unread: [
      {
        name: "agent-mark-unread",
        async prepare(page) {
          if (await isUnread(page, sidebarAgent)) {
            await openAgentMenu(page, sidebarAgent);
            await menuItem(page, english("sidebar.agentMenu.markRead")).click();
            await page.waitForFunction(isUnreadInPage, { prefix: unreadPrefix, agent: sidebarAgent, want: false });
            await settleNetwork(page, Date.now());
          }
          await openAgentMenu(page, sidebarAgent);
          return menuItem(page, english("sidebar.agentMenu.markUnread"));
        },
        async visible() {
          return {
            kind: "appear",
            within: `[aria-label^=${attr(unreadPrefix)}]`,
            css: `[aria-label^=${attr(`${sidebarAgent},`)}]`,
          };
        },
      },
      {
        name: "agent-mark-read",
        async prepare(page) {
          await openAgentMenu(page, sidebarAgent);
          return menuItem(page, english("sidebar.agentMenu.markRead"));
        },
        async visible() {
          return {
            kind: "disappear",
            within: `[aria-label^=${attr(unreadPrefix)}]`,
            css: `[aria-label^=${attr(`${sidebarAgent},`)}]`,
          };
        },
      },
    ],
    mute: [
      {
        name: "agent-mute",
        async prepare(page) {
          await openAgentMenu(page, sidebarAgent);
          const unmute = menuItem(page, english("sidebar.agentMenu.unmute"));
          if (await unmute.isVisible().catch(() => false)) {
            await unmute.click();
            await settleNetwork(page, Date.now());
            await openAgentMenu(page, sidebarAgent);
          }
          return menuItem(page, english("sidebar.agentMenu.mute"));
        },
        async visible() {
          return null;
        },
      },
      {
        name: "agent-unmute",
        async prepare(page) {
          await openAgentMenu(page, sidebarAgent);
          return menuItem(page, english("sidebar.agentMenu.unmute"));
        },
        async visible() {
          return null;
        },
      },
    ],
    routine: [routineToggle(routineState), routineToggle(routineState)],
    channel: [
      {
        name: "channel-open",
        async prepare(page) {
          await openChat(page, chatAgent);
          return page.getByRole("button", { name: startsWith(`${channelName},`) }).first();
        },
        async visible() {
          return {
            kind: "appear",
            within: "main",
            css: [`[aria-label=${attr(english("channel.settings.title"))}]`, "article"],
          };
        },
      },
      {
        name: "chat-open",
        async prepare(page) {
          return sidebarRow(page, chatAgent);
        },
        async visible() {
          return {
            kind: "appear",
            within: "main",
            css: [`[aria-label=${attr(composerLabel(chatAgent))}]`, "article"],
          };
        },
      },
    ],
    "host-rename": [
      {
        name: "channel-host-rename",
        async prepare(page) {
          if (await page.locator(channelRow(renamedChannel)).count()) {
            await renameOnHost(renamedChannel, channelName)();
            await page.locator(channelRow(channelName)).first().waitFor({ timeout: WAIT_MS });
          }
          return renameOnHost(channelName, renamedChannel);
        },
        async visible() {
          return { kind: "appear", css: channelRow(renamedChannel) };
        },
      },
      {
        name: "channel-host-rename-back",
        async prepare() {
          return renameOnHost(renamedChannel, channelName);
        },
        async visible() {
          return { kind: "appear", css: channelRow(channelName) };
        },
      },
    ],
  };
  return Object.entries(pairs)
    .filter(([key]) => !only || only.includes(key))
    .map(([, pair]) => pair);
}

function isUnreadInPage({ prefix, agent, want }: { prefix: string; agent: string; want: boolean }): boolean {
  const unread = [...document.querySelectorAll(`[aria-label^="${prefix}"]`)].some((group) =>
    group.querySelector(`[aria-label^="${agent},"]`),
  );
  return unread === want;
}

async function arm(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.__actionStart = null;
    document.addEventListener(
      "pointerdown",
      () => {
        window.__actionStart = performance.timeOrigin + performance.now();
      },
      { capture: true, once: true },
    );
  });
}

async function startedAt(page: Page): Promise<number> {
  const start = await page.evaluate(() => window.__actionStart ?? null);
  assert.ok(start !== null, "The action click sent no pointerdown.");
  return start;
}

async function visibleAt(page: Page, visible: Visible): Promise<number | null> {
  if (visible === null) return null;
  if (visible.kind === "checked") {
    const result = await page.waitForFunction(
      ({ element, checked }) => {
        const now =
          element.getAttribute("aria-checked") === "true" || (element instanceof HTMLInputElement && element.checked);
        return now === checked ? performance.timeOrigin + performance.now() : false;
      },
      { element: visible.handle, checked: visible.checked },
      { polling: "raf", timeout: WAIT_MS },
    );
    return Number(await result.jsonValue());
  }
  const result = await page.waitForFunction(
    ({ kind, css, within }) => {
      const roots = within ? [...document.querySelectorAll(within)] : [document];
      const required = Array.isArray(css) ? css : [css];
      const found = roots.some((root) => required.every((selector) => root.querySelector(selector) !== null));
      return found === (kind === "appear") ? performance.timeOrigin + performance.now() : false;
    },
    { kind: visible.kind, css: visible.css, within: visible.within },
    { polling: "raf", timeout: WAIT_MS },
  );
  return Number(await result.jsonValue());
}

async function settleNetwork(page: Page, from: number): Promise<RemoteRequestRecord[]> {
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    const sink = await readSyncSink(page);
    const mine = sink.records.filter((record) => record.endedAt >= from);
    const lastEnd = Math.max(from, ...mine.map((record) => record.endedAt));
    const now = await page.evaluate(() => performance.timeOrigin + performance.now());
    if (sink.open === 0 && now - lastEnd >= QUIET_MS) return sink.records.filter((record) => record.startedAt >= from);
    if (Date.now() > deadline) throw new Error("The network did not become quiet.");
    await delay(100);
  }
}

function criticalDepth(requests: readonly RemoteRequestRecord[]): number {
  const sorted = [...requests].sort((left, right) => left.endedAt - right.endedAt);
  const depth: number[] = [];
  for (const [index, record] of sorted.entries()) {
    let before = 0;
    for (let other = 0; other < index; other += 1) {
      const previous = sorted[other];
      if (previous && previous.endedAt <= record.startedAt) before = Math.max(before, depth[other] ?? 0);
    }
    depth.push(before + 1);
  }
  return Math.max(0, ...depth);
}

async function measureStep(page: Page, step: Step): Promise<Sample> {
  const action = await step.prepare(page);
  if (typeof action !== "function") await action.waitFor({ timeout: WAIT_MS });
  await settleNetwork(page, await page.evaluate(() => performance.timeOrigin + performance.now()));
  const visible = await step.visible(page);
  let start: number;
  if (typeof action === "function") start = await action();
  else {
    await arm(page);
    await action.click();
    start = await startedAt(page);
  }
  const shown = await visibleAt(page, visible);
  const requests = await settleNetwork(page, start - 5);
  const lastEnd = Math.max(shown ?? start, ...requests.map((record) => record.endedAt));
  return {
    step: step.name,
    visibleMs: shown === null ? null : Math.round(shown - start),
    settledMs: Math.round(lastEnd - start),
    requests: requests.length,
    depth: criticalDepth(requests),
    routes: requests.map((record) => `${record.method} ${record.route}`),
  };
}

function summarize(samples: readonly Sample[]): Record<string, StepSummary> {
  const byStep = new Map<string, Sample[]>();
  for (const sample of samples) byStep.set(sample.step, [...(byStep.get(sample.step) ?? []), sample]);
  return Object.fromEntries(
    [...byStep.entries()].map(([step, list]) => {
      const visible = list.flatMap((sample) => (sample.visibleMs === null ? [] : [sample.visibleMs]));
      const routes = new Map<string, number>();
      for (const sample of list) for (const route of sample.routes) routes.set(route, (routes.get(route) ?? 0) + 1);
      return [
        step,
        {
          visibleMs: spread(visible),
          settledMs: spread(list.map((sample) => sample.settledMs)),
          requests: spread(list.map((sample) => sample.requests)),
          depth: spread(list.map((sample) => sample.depth)),
          routes: [...routes.entries()]
            .sort((left, right) => right[1] - left[1])
            .map(([route, count]) => `${route} ×${Math.round((count / list.length) * 10) / 10}`),
        },
      ];
    }),
  );
}

const cell = (value: Spread | null | undefined, unit = "") =>
  value ? `${value.median}${unit} (${value.min}–${value.max})` : "—";
const median = (value: Spread | null | undefined) => value?.median ?? null;

function table(report: Report): string {
  const rows = Object.entries(report.steps).map(
    ([step, summary]) =>
      `| ${step} | ${cell(summary.visibleMs, " ms")} | ${cell(summary.settledMs, " ms")} | ${cell(summary.requests)} | ${cell(summary.depth)} | ${summary.routes.join(", ")} |`,
  );
  return [
    `# ${NAME}: ${report.label}`,
    "",
    `Commit ${report.commit}, ${report.runs} runs, ${report.latencyMs} ms round trip.`,
    "",
    "| Action | Visible change | Network quiet | Requests | Serial round trips | Routes |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows,
  ].join("\n");
}

function comparison(before: Report, after: Report): string {
  const change = (left: number | null, right: number | null, unit: string) => {
    if (left === null || right === null) return "—";
    const percent = left === 0 ? 0 : Math.round(((right - left) / left) * 100);
    return `${left}${unit} → ${right}${unit} (${percent > 0 ? "+" : ""}${percent}%)`;
  };
  const rows = Object.keys(after.steps).map((step) => {
    const left = before.steps[step];
    const right = after.steps[step];
    return `| ${step} | ${change(median(left?.visibleMs), median(right?.visibleMs), " ms")} | ${change(median(left?.settledMs), median(right?.settledMs), " ms")} | ${change(median(left?.requests), median(right?.requests), "")} | ${change(median(left?.depth), median(right?.depth), "")} |`;
  });
  return [
    `# ${NAME}: ${before.label} → ${after.label}`,
    "",
    `${before.latencyMs} ms → ${after.latencyMs} ms round trip. Medians of ${before.runs} → ${after.runs} runs.`,
    "",
    "| Action | Visible change | Network quiet | Requests | Serial round trips |",
    "| --- | --- | --- | --- | --- |",
    ...rows,
  ].join("\n");
}

function commit(): string {
  const head = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  const dirty = execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: ROOT, encoding: "utf8" });
  return dirty.trim() ? `${head}+changes` : head;
}

async function signedInState(browser: Browser): Promise<string> {
  if (sessionPath && existsSync(resolve(ROOT, sessionPath))) return resolve(ROOT, sessionPath);
  const signInContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const signInPage = await signInContext.newPage();
  await signInDevHost(signInPage, api, OUT);
  await signInPage.waitForFunction((mark) => performance.getEntriesByName(mark).length > 0, READY_MARK, {
    timeout: WAIT_MS,
  });
  const path = resolve(ROOT, sessionPath ?? `${OUT}/session.json`);
  await signInContext.storageState({ path });
  await signInContext.close();
  return path;
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch(
    browserExecutable ? { executablePath: browserExecutable } : { channel: "chrome" },
  );
  const samples: Sample[] = [];
  try {
    const storageState = await signedInState(browser);
    const context = await browser.newContext({ storageState, viewport: { width: 1280, height: 900 } });
    await instrumentRemotePeer(context, latencyMs);
    if (latencyMs > 0) await addNetworkLatency(context, latencyMs);
    const page = await context.newPage();
    await page.goto(`${api}/app`);
    await page.waitForFunction((mark) => performance.getEntriesByName(mark).length > 0, READY_MARK, {
      timeout: WAIT_MS,
    });
    await settleNetwork(page, 0);
    const unpin = page.getByRole("button", { name: startsWith(pinnedLabel(sidebarAgent)) });
    if (await unpin.isVisible().catch(() => false)) {
      await unpin.click({ button: "right" });
      await menuItem(page, english("sidebar.unpin")).click();
      await unpin.waitFor({ state: "detached", timeout: WAIT_MS });
      await settleNetwork(page, Date.now());
    }
    for (const pair of steps()) {
      for (let run = 0; run < runs; run += 1) {
        for (const step of pair) {
          try {
            const sample = await measureStep(page, step);
            samples.push(sample);
            logger.info(
              `${step.name} #${run + 1}: visible ${sample.visibleMs ?? "—"} ms, quiet ${sample.settledMs} ms, ${sample.requests} requests, depth ${sample.depth}`,
            );
          } catch (error) {
            await page.screenshot({ path: resolve(OUT, `${step.name}-failure.png`) }).catch(() => undefined);
            throw error;
          }
          await page.keyboard.press("Escape");
        }
      }
    }
    await context.close();
  } finally {
    await browser.close();
  }
  const report: Report = {
    label,
    createdAt: new Date().toISOString(),
    commit: commit(),
    runs,
    latencyMs,
    steps: summarize(samples),
    samples,
  };
  writeFileSync(resolve(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  const summary = [table(report)];
  if (comparePath) {
    const before: Report = JSON.parse(readFileSync(resolve(ROOT, comparePath), "utf8"));
    summary.push("", comparison(before, report));
  }
  writeFileSync(resolve(OUT, "summary.md"), `${summary.join("\n")}\n`);
  logger.info(summary.join("\n"));
  logger.info(`Report: ${resolve(OUT, "report.json")}`);
}

await main();
process.exit(0);
