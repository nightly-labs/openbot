import { readFile, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { CHANNEL_PARALLEL_LIMIT, type DynamicIslandPreference } from "@openbot/contracts/ipc";
import { type DynamicRecord, isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import type { Logger } from "@openbot/logging";
import type { Browser, Page } from "playwright-core";
import { NO_SCALE, parseSeedScale, type SeedScale } from "../seed-dev-scale";
import { type FakeCodexCorpus, writeFakeCodex } from "./bench-fake-codex";
import type { BenchApp } from "./bench-launch";
import type { MetricValues } from "./bench-stats";
import type { InspectorClient } from "./inspector-client";

export const SECOND = 1_000;
export const MINUTE = 60 * SECOND;

export type SeedPlan = { kind: "empty" } | { kind: "seed"; scale: SeedScale };

export interface ScenarioContext {
  app: BenchApp;
  browser: Browser;
  page: Page;
  inspector: InspectorClient | null;
  logger: Logger;
  evaluate: <T = unknown>(expression: string) => Promise<T>;
  wait: (milliseconds: number) => Promise<void>;
  record: (values: MetricValues) => void;
}

export interface Scenario {
  id: string;
  description: string;
  seed: SeedPlan;
  act: (context: ScenarioContext) => Promise<void>;
  settleMs?: number;
  snapshots?: boolean;
  prepare?: (directory: string) => Promise<Record<string, string>>;
}

type BenchProvider = "claude" | "opencode" | "grok" | "codex";

const PREFERRED_MODELS: Record<BenchProvider, string> = {
  claude: "claude-sonnet-5",
  opencode: "opencode-go/muse-spark-1.3-contributor",
  grok: "grok-4.6",
  codex: "gpt-5.5",
};

const LONG_REPLY_PROMPT =
  "Write a detailed Markdown guide of about 1,500 words on building a small HTTP server in Rust with axum. " +
  "Include six fenced code blocks and one table. Answer from memory only. " +
  "Do not use any tools, do not read or write files, and do not run commands.";

const SHORT_REPLY_PROMPT =
  "In about 250 words of Markdown with one short code block, explain one idea from functional programming. " +
  "Answer from memory only. Do not use any tools.";

const TURN_TIMEOUT_MS = 8 * MINUTE;

const SHOWCASE: SeedPlan = { kind: "seed", scale: NO_SCALE };

function scaled(raw: string): SeedPlan {
  return { kind: "seed", scale: parseSeedScale(raw) };
}

function scaleAgent(index: number): string {
  return `scale-${String(index).padStart(3, "0")}`;
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

async function poll(what: string, timeoutMs: number, everyMs: number, probe: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await probe())) {
    if (Date.now() > deadline) throw new Error(`Timed out after ${timeoutMs} ms waiting for ${what}.`);
    await new Promise((resolve) => setTimeout(resolve, everyMs));
  }
}

interface ListedModel {
  provider: string;
  id: string;
  defaultReasoningEffort: string;
  supportedReasoningEfforts: string[];
}

const MODEL_DISCOVERY_TIMEOUT_MS = 2 * MINUTE;

async function useProvider(
  context: ScenarioContext,
  agentIds: string[],
  provider: BenchProvider,
  requiredModel?: string,
): Promise<void> {
  let models: ListedModel[] = [];
  await poll(`${provider} models to be listed`, MODEL_DISCOVERY_TIMEOUT_MS, SECOND, async () => {
    models = await context.evaluate<ListedModel[]>("window.openbot.agent.listModels()");
    return models.some(
      (model) => model.provider === provider && (requiredModel === undefined || model.id === requiredModel),
    );
  }).catch(() => undefined);
  const choice =
    models.find((model) => model.provider === provider && model.id === PREFERRED_MODELS[provider]) ??
    models.find((model) => model.provider === provider);
  if (!choice) throw new Error(`No ${provider} model is listed. Install and sign in to the ${provider} CLI first.`);
  const reasoningEffort = choice.supportedReasoningEfforts.includes("low") ? "low" : choice.defaultReasoningEffort;
  context.logger.info(`${provider}: ${choice.id} (${reasoningEffort}) for ${agentIds.join(", ")}`);
  for (const agentId of agentIds) {
    await context.evaluate(
      `window.openbot.agent.updateAgent(${json({ agentId, provider, model: choice.id, reasoningEffort })}).then(() => null)`,
    );
  }
}

function sidebarRowButton(context: ScenarioContext, name: string) {
  const escaped = name.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return context.page
    .locator(".agent-list")
    .getByRole("button", { name: new RegExp(`^${escaped}([.,]|$)`, "u") })
    .first();
}

async function openAgent(context: ScenarioContext, agentId: string): Promise<void> {
  const byId = context.page.locator(`[data-chat-id="${agentId}"] button`).first();
  if ((await byId.count()) > 0) {
    await byId.click();
  } else {
    const name = await context.evaluate<string>(
      `window.openbot.agent.listAgents().then((agents) => agents.find((agent) => agent.id === ${json(agentId)})?.name ?? "")`,
    );
    if (!name) throw new Error(`No agent ${agentId} in the agent list.`);
    await sidebarRowButton(context, name).click();
  }
  await context.page.locator('main[aria-label="Conversation"] .conversation-scroll').waitFor();
}

async function openChannel(context: ScenarioContext, name: string): Promise<void> {
  await sidebarRowButton(context, name).click();
  await context.page.locator('main[aria-label="Conversation"] .conversation-scroll').waitFor();
}

interface SentDelivery {
  agentId: string;
  id: string;
}

async function turnsEnded(context: ScenarioContext, deliveries: SentDelivery[]): Promise<boolean> {
  return context.evaluate<boolean>(`(async (sent) => {
    for (const { agentId, id } of sent) {
      const queue = await window.openbot.agent.listQueue(agentId);
      const delivery = queue.deliveries.find((one) => one.id === id);
      if (!delivery || ["queued", "starting", "running"].includes(delivery.status)) return false;
      if (delivery.status !== "completed" && delivery.status !== "interrupted") continue;
      const page = await window.openbot.agent.readConversationPage({ agentId, limit: 1 });
      const last = page.messages[page.messages.length - 1];
      if (!last || last.source === "user" || last.status === "streaming") return false;
    }
    return true;
  })(${json(deliveries)})`);
}

interface TurnOutcome {
  completed: boolean;
  characters: number;
}

async function lastReply(context: ScenarioContext, agentId: string): Promise<TurnOutcome> {
  return context.evaluate<TurnOutcome>(`window.openbot.agent
    .readConversationPage({ agentId: ${json(agentId)}, limit: 1 })
    .then((page) => {
      const last = page.messages[page.messages.length - 1];
      const reply = last && last.source !== "user" ? last : null;
      return { completed: reply?.status === "completed", characters: reply?.text.length ?? 0 };
    })`);
}

async function runTurns(context: ScenarioContext, agentIds: string[], text: string): Promise<void> {
  const started = Date.now();
  const sent: SentDelivery[] = [];
  for (const agentId of agentIds) {
    const deliveryIds = await context.evaluate<string[]>(
      `window.openbot.agent.sendMessage(${json({ agentId, text })}).then((receipt) => receipt.deliveries.map((one) => one.id))`,
    );
    for (const id of deliveryIds) sent.push({ agentId, id });
  }
  await poll(`${agentIds.length} turn(s) to finish`, TURN_TIMEOUT_MS, 2 * SECOND, () => turnsEnded(context, sent));
  let failed = 0;
  let characters = 0;
  for (const agentId of agentIds) {
    const outcome = await lastReply(context, agentId);
    if (!outcome.completed) failed += 1;
    characters += outcome.characters;
  }
  if (failed > 0) context.logger.warn(`${failed} of ${agentIds.length} turn(s) did not complete`);
  context.record({ "turns.failed": failed, "turns.characters": characters, "turns.ms": Date.now() - started });
}

const MAIN_WINDOW = `require("electron").BrowserWindow.getAllWindows().find((window) => {
  const url = window.webContents.getURL();
  return url.startsWith("openbot-app://app/index.html") && !url.includes("surface=");
})`;

type MainWindowAction = "close" | "minimize" | "hide" | "show" | "blur";

async function mainWindowCall(context: ScenarioContext, call: MainWindowAction): Promise<void> {
  if (!context.inspector) throw new Error("This scenario needs the main-process inspector.");
  const done = await context.inspector.evaluate(`(() => {
    const window = ${MAIN_WINDOW};
    if (!window) return false;
    window.${call}();
    return true;
  })()`);
  if (done !== true) throw new Error(`No app window to ${call}.`);
}

const CHAT_SCROLL = 'main[aria-label="Conversation"] .conversation-scroll';

async function scrollThroughHistory(context: ScenarioContext) {
  let steps = 0;
  let unchanged = 0;
  let height = -1;
  while (unchanged < 4 && steps < 120) {
    const next = await context.evaluate<number>(`(() => {
      const scroller = document.querySelector(${json(CHAT_SCROLL)});
      if (!scroller) return -1;
      scroller.scrollTop = 0;
      return scroller.scrollHeight;
    })()`);
    unchanged = next === height ? unchanged + 1 : 0;
    height = next;
    steps += 1;
    await context.wait(500);
  }
  await context.evaluate(`(() => {
    const scroller = document.querySelector(${json(CHAT_SCROLL)});
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  })()`);
  await context.wait(2 * SECOND);
  return steps;
}

function articlePage(index: number): string {
  const paragraphs = Array.from(
    { length: 300 },
    (_, paragraph) =>
      `<section><h2>Section ${paragraph + 1}</h2><p>Tab ${index}. ${"Measured text for the bench page. ".repeat(12)}</p><ul><li>One</li><li>Two</li><li>Three</li></ul></section>`,
  ).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Bench tab ${index}</title>
<style>body{font:16px/1.5 system-ui;margin:2rem auto;max-width:48rem}section{border-bottom:1px solid #ddd}</style></head>
<body><h1>Bench tab ${index}</h1><p id="clock"></p>${paragraphs}
<script>setInterval(() => { document.getElementById("clock").textContent = new Date().toISOString(); }, 1000);</script>
</body></html>`;
}

async function startPageServer(): Promise<{ server: Server; origin: string }> {
  const server = createServer((request, response) => {
    const index = Number(new URL(request.url ?? "/", "http://127.0.0.1").searchParams.get("tab") ?? "0");
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(articlePage(index));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("The bench page server has no TCP port.");
  return { server, origin: `http://127.0.0.1:${address.port}` };
}

async function openTabs(context: ScenarioContext, count: number): Promise<void> {
  const { server, origin } = await startPageServer();
  try {
    for (let index = 1; index <= count; index += 1) {
      await context.evaluate(
        `window.openbot.browser.open(${json({ url: `${origin}/?tab=${index}`, focus: false })}).then(() => null)`,
      );
    }
    await poll("the tabs to load", 2 * MINUTE, SECOND, () =>
      context.evaluate<boolean>("window.openbot.browser.listTabs().then((tabs) => tabs.every((tab) => !tab.loading))"),
    );
    context.record({
      "browser.tabs": await context.evaluate<number>("window.openbot.browser.listTabs().then((tabs) => tabs.length)"),
    });
    await context.wait(MINUTE);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function idle(milliseconds: number): Scenario["act"] {
  return async ({ wait }) => wait(milliseconds);
}

function streaming(provider: BenchProvider): Scenario {
  return {
    id: `s5-stream-${provider}`,
    description: `One long streamed reply from ${provider}, chat open`,
    seed: SHOWCASE,
    act: async (context) => {
      await useProvider(context, ["chief"], provider);
      await openAgent(context, "chief");
      await runTurns(context, ["chief"], LONG_REPLY_PROMPT);
      await context.wait(30 * SECOND);
    },
  };
}

function parallel(provider: BenchProvider, count: number): Scenario {
  const agents = Array.from({ length: count }, (_, index) => scaleAgent(index + 1));
  return {
    id: `s6-parallel-${provider}-${count}`,
    description: `${count} agents streaming at once on ${provider}`,
    seed: scaled(`agents:${count},messages:20`),
    act: async (context) => {
      await useProvider(context, agents, provider);
      await openAgent(context, agents[0] ?? "chief");
      await runTurns(context, agents, SHORT_REPLY_PROMPT);
      await context.wait(30 * SECOND);
    },
  };
}

const MAIN_WINDOW_START = `(() => {
  const { monitorEventLoopDelay } = require("node:perf_hooks");
  const histogram = monitorEventLoopDelay({ resolution: 10 });
  histogram.enable();
  globalThis.__openbotBenchWindow = { histogram, cpu: process.cpuUsage(), at: performance.now() };
  return true;
})()`;

const MAIN_WINDOW_STOP = `(() => {
  const reading = globalThis.__openbotBenchWindow;
  delete globalThis.__openbotBenchWindow;
  reading.histogram.disable();
  const cpu = process.cpuUsage(reading.cpu);
  const elapsed = performance.now() - reading.at;
  return {
    cpuPercent: ((cpu.user + cpu.system) / 1000 / elapsed) * 100,
    loopP50Ms: reading.histogram.percentile(50) / 1e6,
    loopP99Ms: reading.histogram.percentile(99) / 1e6,
    loopMaxMs: reading.histogram.max / 1e6,
  };
})()`;

const WINDOW_LAG_START = `(() => {
  const lags = [];
  let last = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    lags.push(Math.max(0, now - last - 50));
    last = now;
  }, 50);
  window.__openbotBenchLag = { timer, lags };
  return true;
})()`;

const WINDOW_LAG_STOP = `(() => {
  const { timer, lags } = window.__openbotBenchLag;
  delete window.__openbotBenchLag;
  clearInterval(timer);
  const sorted = lags.slice().sort((left, right) => left - right);
  const at = (share) => sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))] ?? 0;
  return { p99: at(0.99), max: sorted[sorted.length - 1] ?? 0 };
})()`;

interface MainWindowReading {
  cpuPercent: number;
  loopP50Ms: number;
  loopP99Ms: number;
  loopMaxMs: number;
}

function mainWindowReading(value: unknown): MainWindowReading {
  const number = (key: string): number => {
    const field = isDynamicRecord(value) ? value[key] : undefined;
    if (!isNumber(field)) throw new Error(`The main process did not report ${key}.`);
    return field;
  };
  return {
    cpuPercent: number("cpuPercent"),
    loopP50Ms: number("loopP50Ms"),
    loopP99Ms: number("loopP99Ms"),
    loopMaxMs: number("loopMaxMs"),
  };
}

async function loggedCount(logPath: string, key: string): Promise<number> {
  const text = await readFile(logPath, "utf8").catch(() => "");
  return text.split("\n").filter((line) => line.includes(`"${key}"`)).length;
}

const endedTurns = (logPath: string) => loggedCount(logPath, "turnEnded");

async function unknownCodexMethods(logPath: string): Promise<string[]> {
  const text = await readFile(logPath, "utf8").catch(() => "");
  const methods = new Set<string>();
  for (const line of text.split("\n")) {
    const match = /"unknownMethod":"([^"]+)"/u.exec(line);
    if (match?.[1]) methods.add(match[1]);
  }
  return [...methods];
}

const SCALE_DELTA_MS = 50;
const SCALE_DELTAS = 600;

const SEED_AGENT_COUNT = 4;

function manyAgents(total: number, channelMembers: number): Scenario {
  const count = total - SEED_AGENT_COUNT;
  const agents = Array.from({ length: count }, (_, index) => scaleAgent(index + 1));
  const members = agents.slice(count - channelMembers);
  const recipients = members.slice(0, CHANNEL_PARALLEL_LIMIT);
  const direct = agents.filter((agentId) => !recipients.includes(agentId));
  const streaming = direct.length + recipients.length;
  let directory = "";
  let logPath = "";
  let profiled = false;
  return {
    id: `s14-agents-${total}`,
    description: `${total} agents, ${streaming} of them stream at once on a fake Codex, ${recipients.length} of them in an open channel of ${channelMembers} members and 2,000 messages`,
    seed: scaled(`agents:${count},messages:200,channels:1,channelMessages:2000`),
    prepare: async (scenarioDirectory) => {
      directory = scenarioDirectory;
      const codex = await writeFakeCodex(join(scenarioDirectory, "fake-codex"), {
        deltaMs: SCALE_DELTA_MS,
        deltas: SCALE_DELTAS,
      });
      logPath = codex.logPath;
      return codex.environment;
    },
    act: async (context) => {
      const inspector = context.inspector;
      if (!inspector) throw new Error("This scenario needs the main-process inspector.");
      await useProvider(context, agents, "codex", PREFERRED_MODELS.codex);
      interface ListedChannel {
        id: string;
        name: string;
        title: string;
        instructions: string;
      }
      const channels = await context.evaluate<ListedChannel[]>("window.openbot.agent.listChannels()");
      const channel = channels.find((one) => one.id === "scale-channel-001");
      if (!channel) throw new Error("The scaled seed has no channel scale-channel-001.");
      const save = {
        type: "save",
        operationId: crypto.randomUUID(),
        channelId: channel.id,
        update: true,
        draft: {
          name: channel.name,
          title: channel.title,
          instructions: channel.instructions,
          members: members.map((agentId) => ({ agentId })),
          leadAgentId: members[0],
        },
      };
      await context.evaluate(`window.openbot.agent.channelCommand(${json(save)}).then(() => null)`);
      await openChannel(context, channel.name);
      await context.wait(5 * SECOND);

      const profile = process.env.OPENBOT_BENCH_PROFILE_STREAM === "1" && !profiled;
      profiled ||= profile;
      const rendererSession = await context.page.context().newCDPSession(context.page);
      await rendererSession.send("Performance.enable");
      const rendererMetrics = async (): Promise<Record<string, number>> => {
        const { metrics } = await rendererSession.send("Performance.getMetrics");
        return Object.fromEntries(metrics.map((metric) => [metric.name, metric.value]));
      };
      if (profile) {
        await inspector.send("Profiler.enable");
        await inspector.send("Profiler.setSamplingInterval", { interval: 500 });
        await inspector.send("Profiler.start");
        await rendererSession.send("Profiler.enable");
        await rendererSession.send("Profiler.start");
      }
      const rendererBefore = await rendererMetrics();
      await inspector.evaluate(MAIN_WINDOW_START);
      await context.evaluate(WINDOW_LAG_START);
      const started = Date.now();

      const sent: SentDelivery[] = [];
      for (const agentId of direct) {
        const deliveryIds = await context.evaluate<string[]>(
          `window.openbot.agent.sendMessage(${json({ agentId, text: SHORT_REPLY_PROMPT })}).then((receipt) => receipt.deliveries.map((one) => one.id))`,
        );
        for (const id of deliveryIds) sent.push({ agentId, id });
      }
      for (const agentId of recipients) {
        const command = {
          type: "send",
          operationId: crypto.randomUUID(),
          channelId: channel.id,
          text: SHORT_REPLY_PROMPT,
          recipientAgentId: agentId,
          replyToMessageId: null,
          attachmentDraftIds: [],
        };
        await context.evaluate(`window.openbot.agent.channelCommand(${json(command)}).then(() => null)`);
      }
      const sendMs = Date.now() - started;
      await poll(
        `${streaming} streamed turns to end`,
        SCALE_DELTA_MS * SCALE_DELTAS + 5 * MINUTE,
        SECOND,
        async () => (await endedTurns(logPath)) >= streaming,
      );
      const streamMs = Date.now() - started;
      const lag = await context.evaluate<{ p99: number; max: number }>(WINDOW_LAG_STOP);
      const main = mainWindowReading(await inspector.evaluate(MAIN_WINDOW_STOP));
      const rendererAfter = await rendererMetrics();
      if (profile) {
        const mainProfile = await inspector.send("Profiler.stop");
        const rendererProfile = await rendererSession.send("Profiler.stop");
        await writeFile(
          join(directory, "stream-main.cpuprofile"),
          JSON.stringify(isDynamicRecord(mainProfile) ? mainProfile.profile : null),
        );
        await writeFile(join(directory, "stream-renderer.cpuprofile"), JSON.stringify(rendererProfile.profile));
        context.logger.info(`stream CPU profiles written under ${directory}`);
      }
      await rendererSession.detach().catch(() => undefined);
      const rendererSeconds = (name: string) => (rendererAfter[name] ?? 0) - (rendererBefore[name] ?? 0);

      await poll("the direct turns to settle", 2 * MINUTE, 2 * SECOND, () => turnsEnded(context, sent));
      await poll("the channel tasks to settle", 2 * MINUTE, 2 * SECOND, async () => {
        const active = await context.evaluate<number>(
          `window.openbot.agent.listChannels().then((all) => all.find((one) => one.id === ${json(channel.id)})?.activeTasks ?? 0)`,
        );
        return active === 0;
      });
      const unknown = await unknownCodexMethods(logPath);
      if (unknown.length > 0) context.logger.warn(`fake Codex got unknown requests: ${unknown.join(", ")}`);
      let failed = 0;
      for (const agentId of direct) if (!(await lastReply(context, agentId)).completed) failed += 1;
      if (failed > 0) context.logger.warn(`${failed} of ${direct.length} direct turn(s) did not complete`);
      context.record({
        "stream.ms": streamMs,
        "stream.sendMs": sendMs,
        "stream.turnsEnded": await endedTurns(logPath),
        "stream.directFailed": failed,
        "stream.sideTurns": await loggedCount(logPath, "sideTurnEnded"),
        "stream.main.cpuPercent": main.cpuPercent,
        "stream.main.loopP50Ms": main.loopP50Ms,
        "stream.main.loopP99Ms": main.loopP99Ms,
        "stream.main.loopMaxMs": main.loopMaxMs,
        "stream.window.taskPercent": (rendererSeconds("TaskDuration") * 1000 * 100) / streamMs,
        "stream.window.scriptPercent": (rendererSeconds("ScriptDuration") * 1000 * 100) / streamMs,
        "stream.window.stylePercent": (rendererSeconds("RecalcStyleDuration") * 1000 * 100) / streamMs,
        "stream.window.layoutPercent": (rendererSeconds("LayoutDuration") * 1000 * 100) / streamMs,
        "stream.window.lagP99Ms": lag.p99,
        "stream.window.lagMaxMs": lag.max,
      });
      await context.wait(10 * SECOND);
    },
  };
}

async function fakeLogEntries(logPath: string): Promise<DynamicRecord[]> {
  const text = await readFile(logPath, "utf8").catch(() => "");
  const entries: DynamicRecord[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const entry = JSON.parse(line);
    if (isDynamicRecord(entry)) entries.push(entry);
  }
  return entries;
}

interface FakeTurnEnd {
  status: string;
  characters: number;
  trimmedCharacters: number;
  deltas: number;
  reasoningDeltas: number;
  commandOutputDeltas: number;
  at: number;
}

interface FakeStreamSummary {
  ended: FakeTurnEnd[];
  startedAt: number;
  firstThirdAt: number;
  secondThirdAt: number;
  endedAt: number;
}

function numberField(entry: DynamicRecord, key: string): number {
  const value = entry[key];
  return isNumber(value) ? value : 0;
}

async function fakeStreamSummary(logPath: string): Promise<FakeStreamSummary> {
  const entries = await fakeLogEntries(logPath);
  const ended: FakeTurnEnd[] = [];
  const started: number[] = [];
  const thirds: [number[], number[]] = [[], []];
  for (const entry of entries) {
    if (isString(entry.streamStarted)) started.push(numberField(entry, "at"));
    if (entry.streamThird === 1) thirds[0].push(numberField(entry, "at"));
    if (entry.streamThird === 2) thirds[1].push(numberField(entry, "at"));
    if (!isString(entry.turnEnded)) continue;
    ended.push({
      status: isString(entry.status) ? entry.status : "",
      characters: numberField(entry, "characters"),
      trimmedCharacters: numberField(entry, "trimmedCharacters"),
      deltas: numberField(entry, "deltas"),
      reasoningDeltas: numberField(entry, "reasoningDeltas"),
      commandOutputDeltas: numberField(entry, "commandOutputDeltas"),
      at: numberField(entry, "at"),
    });
  }
  return {
    ended,
    startedAt: started.length > 0 ? Math.min(...started) : 0,
    firstThirdAt: thirds[0].length > 0 ? Math.max(...thirds[0]) : 0,
    secondThirdAt: thirds[1].length > 0 ? Math.max(...thirds[1]) : 0,
    endedAt: ended.length > 0 ? Math.max(...ended.map((turn) => turn.at)) : 0,
  };
}

async function verifyReplies(context: ScenarioContext, agents: string[], ended: FakeTurnEnd[]): Promise<void> {
  const completed = ended.filter((turn) => turn.status === "completed");
  if (completed.length < agents.length) {
    throw new Error(`The fake Codex completed ${completed.length} of ${agents.length} turns.`);
  }
  const accepted = new Set(completed.flatMap((turn) => [turn.characters, turn.trimmedCharacters]));
  const mismatched: string[] = [];
  for (const agentId of agents) {
    const reply = await lastReply(context, agentId);
    if (!reply.completed || !accepted.has(reply.characters)) mismatched.push(`${agentId}=${reply.characters}`);
  }
  if (mismatched.length > 0) {
    throw new Error(
      `The saved reply length is not the fake Codex text length (${[...accepted].join(" or ")}): ${mismatched.join(", ")}.`,
    );
  }
}

const MAIN_CPU_MS = "(() => { const usage = process.cpuUsage(); return (usage.user + usage.system) / 1000; })()";
const THIRD_POLL_MS = 250;

async function mainCpuMs(inspector: InspectorClient): Promise<number> {
  const value = await inspector.evaluate(MAIN_CPU_MS);
  return isNumber(value) ? value : 0;
}

async function trackMainCpuThirds(
  inspector: InspectorClient,
  logPath: string,
  agents: number,
  streaming: () => boolean,
  wait: (milliseconds: number) => Promise<void>,
): Promise<MetricValues> {
  const marks = [await mainCpuMs(inspector)];
  while (streaming() && marks.length < 3) {
    await wait(THIRD_POLL_MS);
    const reached = (await fakeLogEntries(logPath)).filter((entry) => entry.streamThird === marks.length).length;
    if (reached >= agents) marks.push(await mainCpuMs(inspector));
  }
  while (streaming()) await wait(THIRD_POLL_MS);
  marks.push(await mainCpuMs(inspector));
  const [start = 0, first = 0, second = 0, end = 0] = marks;
  if (marks.length < 4 || first - start <= 0) return {};
  return {
    "stream.main.cpuMs.firstThird": Math.round(first - start),
    "stream.main.cpuMs.lastThird": Math.round(end - second),
    "stream.main.slope": Math.round(((end - second) / (first - start)) * 100) / 100,
  };
}

async function waitWhile(context: ScenarioContext, active: () => boolean): Promise<void> {
  while (active()) await context.wait(500);
}

type WindowLag = { p99: number; max: number };

const STREAM_DELTA_MS = 25;
const STREAM_DELTAS = 1_200;
const LONG_STREAM_DELTAS = 6_000;

interface FakeStreamPlan {
  id: string;
  description: string;
  agents: number;
  seed: SeedPlan;
  deltas: number;
  corpus?: FakeCodexCorpus;
  reasoning?: boolean;
  commands?: boolean;
  windowLag?: boolean;
  before?: (context: ScenarioContext, agents: string[]) => Promise<void>;
  during?: (context: ScenarioContext, agents: string[], streaming: () => boolean) => Promise<MetricValues>;
  after?: (context: ScenarioContext, agents: string[]) => Promise<void>;
}

function fakeStream(plan: FakeStreamPlan): Scenario {
  const agents = Array.from({ length: plan.agents }, (_, index) => scaleAgent(index + 1));
  let logPath = "";
  return {
    id: plan.id,
    description: plan.description,
    seed: plan.seed,
    prepare: async (scenarioDirectory) => {
      const codex = await writeFakeCodex(join(scenarioDirectory, "fake-codex"), {
        deltaMs: STREAM_DELTA_MS,
        deltas: plan.deltas,
        corpus: plan.corpus ?? "words",
        reasoning: plan.reasoning ?? false,
        commands: plan.commands ?? false,
      });
      logPath = codex.logPath;
      return codex.environment;
    },
    act: async (context) => {
      const inspector = context.inspector;
      await useProvider(context, agents, "codex", PREFERRED_MODELS.codex);
      await openAgent(context, agents[0] ?? "chief");
      await plan.before?.(context, agents);
      const windowLag = plan.windowLag ?? true;
      if (inspector) await inspector.evaluate(MAIN_WINDOW_START);
      if (windowLag) await context.evaluate(WINDOW_LAG_START);
      const started = Date.now();
      const sent: SentDelivery[] = [];
      for (const agentId of agents) {
        const deliveryIds = await context.evaluate<string[]>(
          `window.openbot.agent.sendMessage(${json({ agentId, text: SHORT_REPLY_PROMPT })}).then((receipt) => receipt.deliveries.map((one) => one.id))`,
        );
        for (const id of deliveryIds) sent.push({ agentId, id });
      }
      const sendMs = Date.now() - started;
      let streaming = true;
      const ended = poll(
        `${agents.length} fake streams to end`,
        STREAM_DELTA_MS * plan.deltas * 3 + 5 * MINUTE,
        SECOND,
        async () => (await endedTurns(logPath)) >= agents.length,
      ).finally(() => {
        streaming = false;
      });
      const [, during, thirds] = await Promise.all([
        ended,
        plan.during?.(context, agents, () => streaming),
        inspector ? trackMainCpuThirds(inspector, logPath, agents.length, () => streaming, context.wait) : {},
      ]);
      const streamMs = Date.now() - started;
      const lag = windowLag ? await context.evaluate<WindowLag>(WINDOW_LAG_STOP) : null;
      const main = inspector ? mainWindowReading(await inspector.evaluate(MAIN_WINDOW_STOP)) : null;
      await plan.after?.(context, agents);
      await poll("the fake turns to settle", 2 * MINUTE, 2 * SECOND, () => turnsEnded(context, sent));
      const unknown = await unknownCodexMethods(logPath);
      if (unknown.length > 0) context.logger.warn(`fake Codex got unknown requests: ${unknown.join(", ")}`);
      const summary = await fakeStreamSummary(logPath);
      await verifyReplies(context, agents, summary.ended);
      const total = (key: "deltas" | "reasoningDeltas" | "commandOutputDeltas") =>
        summary.ended.reduce((sum, turn) => sum + turn[key], 0);
      context.record({
        ...during,
        ...thirds,
        "stream.agents": agents.length,
        "stream.deltas": total("deltas"),
        "stream.reasoningDeltas": total("reasoningDeltas"),
        "stream.commandOutputDeltas": total("commandOutputDeltas"),
        "stream.characters": summary.ended.reduce((sum, turn) => sum + turn.characters, 0),
        "stream.ms": streamMs,
        "stream.sendMs": sendMs,
        "stream.thirdMs.first": summary.firstThirdAt > 0 ? summary.firstThirdAt - summary.startedAt : 0,
        "stream.thirdMs.last": summary.secondThirdAt > 0 ? summary.endedAt - summary.secondThirdAt : 0,
        "stream.sideTurns": await loggedCount(logPath, "sideTurnEnded"),
        ...(main
          ? {
              "stream.main.cpuPercent": main.cpuPercent,
              "stream.main.loopP50Ms": main.loopP50Ms,
              "stream.main.loopP99Ms": main.loopP99Ms,
              "stream.main.loopMaxMs": main.loopMaxMs,
            }
          : {}),
        ...(lag ? { "stream.window.lagP99Ms": lag.p99, "stream.window.lagMaxMs": lag.max } : {}),
      });
      await context.wait(5 * SECOND);
    },
  };
}

function streamAgents(count: number): Scenario {
  return fakeStream({
    id: `s15-stream-${count}`,
    description: `${count} agent(s) stream ${STREAM_DELTAS} deltas each at 40 deltas/s on a fake Codex, first chat open`,
    agents: count,
    seed: scaled(`agents:${count},messages:20`),
    deltas: STREAM_DELTAS,
  });
}

const CHAT_WINDOW_URL = "window=chat";

async function chatWindowPage(context: ScenarioContext, agentId: string): Promise<Page> {
  const agentParameter = `agent=${encodeURIComponent(agentId)}`;
  const find = (): Page | undefined =>
    context.browser
      .contexts()
      .flatMap((browserContext) => browserContext.pages())
      .find((page) => page.url().includes(CHAT_WINDOW_URL) && page.url().includes(agentParameter));
  await poll("the chat window to open", 30 * SECOND, 500, async () => find() !== undefined);
  const page = find();
  if (!page) throw new Error(`No chat window opened for ${agentId}.`);
  await page.locator(".conversation-scroll").first().waitFor();
  return page;
}

const LAST_AGENT_REPLY = `(() => {
  const replies = document.querySelectorAll('.conversation-scroll [data-author="assistant"] .message-content-blocks');
  return replies[replies.length - 1]?.innerText ?? "";
})()`;

function streamChatWindow(): Scenario {
  let chatPage: Page | null = null;
  return fakeStream({
    id: "s15-stream-chat-window",
    description: `5 agents stream ${STREAM_DELTAS} deltas each; the first agent is open in a separate chat window, the main window shows the second agent`,
    agents: 5,
    seed: scaled("agents:5,messages:20"),
    deltas: STREAM_DELTAS,
    before: async (context, agents) => {
      const [first, second] = agents;
      if (!first || !second) throw new Error("This scenario needs 2 agents.");
      await openAgent(context, second);
      await context.evaluate(
        `window.openbot.openChatWindow(${json({ serverId: "local", agentId: first })}).then(() => null)`,
      );
      chatPage = await chatWindowPage(context, first);
    },
    during: async (context, agents, streaming): Promise<MetricValues> => {
      const page = chatPage;
      const [first] = agents;
      if (!page || !first) return {};
      await page.evaluate(WINDOW_LAG_START);
      await waitWhile(context, streaming);
      const lag = await page.evaluate<WindowLag>(WINDOW_LAG_STOP);
      await openAgent(context, first);
      let chatReply = "";
      await poll("the chat window to show the reply that the main window shows", 30 * SECOND, 500, async () => {
        chatReply = await page.evaluate<string>(LAST_AGENT_REPLY);
        const mainReply = await context.evaluate<string>(LAST_AGENT_REPLY);
        return chatReply.length > 0 && chatReply === mainReply;
      });
      return {
        "stream.chatWindow.lagP99Ms": lag.p99,
        "stream.chatWindow.lagMaxMs": lag.max,
        "stream.chatWindow.replyCharacters": chatReply.length,
      };
    },
    after: async () => {
      await chatPage?.close().catch(() => undefined);
      chatPage = null;
    },
  });
}

const COMPOSER_EDITOR = '.composer-input-label [contenteditable="true"]';
const TYPING_TEXT = "Please check the config file and run the tests again. ";

async function typeWhileStreaming(context: ScenarioContext, streaming: () => boolean): Promise<MetricValues> {
  const editor = context.page.locator(COMPOSER_EDITOR).first();
  await editor.click();
  let typed = 0;
  while (streaming()) {
    await editor.pressSequentially(TYPING_TEXT, { delay: 60 });
    typed += TYPING_TEXT.length;
    await context.page.keyboard.press("ControlOrMeta+A");
    await context.page.keyboard.press("Backspace");
  }
  return { "typing.characters": typed };
}

const WHEEL_STEP_PX = 400;
const WHEEL_STEPS_PER_DIRECTION = 10;

async function wheelOver(context: ScenarioContext, selector: string, active: () => boolean, stepLimit: number) {
  const box = await context.page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`No ${selector} to scroll.`);
  await context.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  let steps = 0;
  while (active() && steps < stepLimit) {
    const upward = Math.floor(steps / WHEEL_STEPS_PER_DIRECTION) % 2 === 0;
    await context.page.mouse.wheel(0, upward ? -WHEEL_STEP_PX : WHEEL_STEP_PX);
    steps += 1;
    await context.wait(100);
  }
  return steps;
}

const SIDEBAR_LIST = ".agent-list";
const SIDEBAR_FILTER_BUTTON = ".sidebar-filter-button";
const SIDEBAR_FILTER_ROUNDS = 5;
const SIDEBAR_WHEEL_STEPS = 80;

async function filterSidebar(context: ScenarioContext) {
  await context.page.locator(SIDEBAR_FILTER_BUTTON).first().click();
  const options = context.page.getByRole("menuitemradio");
  await options.first().waitFor();
  let changes = 0;
  for (let round = 0; round < SIDEBAR_FILTER_ROUNDS; round += 1) {
    for (const index of [1, 2, 0]) {
      await options.nth(index).click();
      changes += 1;
      await context.wait(300);
    }
  }
  await context.page.keyboard.press("Escape");
  return changes;
}

const HUNDRED_AGENTS = scaled("agents:96,messages:50,channels:3,channelMessages:200");
const IDLE_HUNDRED_MS = 3 * MINUTE;

function idleHundred(state: "visible" | "closed" | "minimized" | "blurred"): Scenario {
  const action: MainWindowAction | null =
    state === "closed" ? "close" : state === "minimized" ? "minimize" : state === "blurred" ? "blur" : null;
  return {
    id: `s2-idle-${state}-100`,
    description: `100 agents and 3 channels, window ${state}, idle 3 min`,
    seed: HUNDRED_AGENTS,
    act: async (context) => {
      if (action) await mainWindowCall(context, action);
      await context.wait(IDLE_HUNDRED_MS);
    },
  };
}

const SWITCH_COUNT = 20;
const SWITCH_STRIDE = 7;
const SCALED_HUNDRED = 96;

function browserTabs(count: number): Scenario {
  return {
    id: `s10-browser-${count}`,
    description: `${count} browser tab(s) on a local article page, idle 1 min`,
    seed: SHOWCASE,
    act: (context) => openTabs(context, count),
  };
}

export const SCENARIOS: Scenario[] = [
  {
    id: "s0-smoke",
    description: "Harness check: showcase seed, idle 20 s",
    seed: SHOWCASE,
    act: idle(20 * SECOND),
    settleMs: 3 * SECOND,
  },
  {
    id: "s1-cold-empty",
    description: "Cold start on an empty profile, idle 2 min",
    seed: { kind: "empty" },
    act: idle(2 * MINUTE),
  },
  {
    id: "s2-idle-visible",
    description: "Showcase seed, window visible, idle 5 min",
    seed: SHOWCASE,
    act: idle(5 * MINUTE),
  },
  {
    id: "s2-idle-closed",
    description: "Showcase seed, window closed (app keeps running), idle 5 min",
    seed: SHOWCASE,
    act: async (context) => {
      await mainWindowCall(context, "close");
      await context.wait(5 * MINUTE);
    },
  },
  {
    id: "s2-idle-minimized",
    description: "Showcase seed, window minimized, idle 5 min",
    seed: SHOWCASE,
    act: async (context) => {
      await mainWindowCall(context, "minimize");
      await context.wait(5 * MINUTE);
    },
  },
  idleHundred("visible"),
  idleHundred("closed"),
  idleHundred("minimized"),
  idleHundred("blurred"),
  streamAgents(1),
  streamAgents(5),
  streamAgents(20),
  fakeStream({
    id: "s15-stream-long-md",
    description: `One agent streams ${LONG_STREAM_DELTAS} Markdown deltas (headings, a table, 8 code blocks), chat open`,
    agents: 1,
    seed: scaled("agents:1,messages:20"),
    deltas: LONG_STREAM_DELTAS,
    corpus: "markdown",
    reasoning: true,
    commands: true,
  }),
  fakeStream({
    id: "s15-stream-hidden",
    description: `5 agents stream ${STREAM_DELTAS} deltas each while the main window is hidden`,
    agents: 5,
    seed: scaled("agents:5,messages:20"),
    deltas: STREAM_DELTAS,
    windowLag: false,
    before: (context) => mainWindowCall(context, "hide"),
    after: (context) => mainWindowCall(context, "show"),
  }),
  streamChatWindow(),
  fakeStream({
    id: "s15-stream-typing",
    description: `20 agents stream ${STREAM_DELTAS} deltas each while text is typed into the open chat composer`,
    agents: 20,
    seed: scaled("agents:20,messages:200"),
    deltas: STREAM_DELTAS,
    during: (context, _agents, streaming) => typeWhileStreaming(context, streaming),
  }),
  fakeStream({
    id: "s15-stream-scroll",
    description: `20 agents stream ${STREAM_DELTAS} deltas each while the open chat scrolls up and down with the mouse wheel`,
    agents: 20,
    seed: scaled("agents:20,messages:200"),
    deltas: STREAM_DELTAS,
    during: async (context, _agents, streaming) => ({
      "scroll.wheelSteps": await wheelOver(context, CHAT_SCROLL, streaming, Number.POSITIVE_INFINITY),
    }),
  }),
  {
    id: "s16-switch-100",
    description: `100 agents, ${SWITCH_COUNT} chat switches with 1 s between them`,
    seed: HUNDRED_AGENTS,
    act: async (context) => {
      const started = Date.now();
      for (let index = 0; index < SWITCH_COUNT; index += 1) {
        await openAgent(context, scaleAgent(((index * SWITCH_STRIDE) % SCALED_HUNDRED) + 1));
        await context.wait(SECOND);
      }
      context.record({ "switch.count": SWITCH_COUNT, "switch.ms": Date.now() - started });
      await context.wait(5 * SECOND);
    },
  },
  {
    id: "s16-sidebar-100",
    description: "100 agents, change the sidebar filter 15 times, then scroll the sidebar up and down",
    seed: HUNDRED_AGENTS,
    act: async (context) => {
      const filterChanges = await filterSidebar(context);
      await context.wait(SECOND);
      const wheelSteps = await wheelOver(context, SIDEBAR_LIST, () => true, SIDEBAR_WHEEL_STEPS);
      context.record({ "sidebar.filterChanges": filterChanges, "sidebar.wheelSteps": wheelSteps });
      await context.wait(5 * SECOND);
    },
  },
  {
    id: "s3-scaled-small",
    description: "Startup with 10 agents x 200 messages, idle 1 min",
    seed: scaled("agents:10,messages:200"),
    act: idle(MINUTE),
  },
  {
    id: "s3-scaled-large",
    description: "Startup with 50 agents x 2,000 messages and 5 channels x 1,000 messages, idle 1 min",
    seed: scaled("agents:50,messages:2000,channels:5,channelMessages:1000"),
    act: idle(MINUTE),
    snapshots: true,
  },
  {
    id: "s4-long-chat",
    description: "Open a 2,000-message chat, scroll to the top and back, then switch across 10 agents",
    seed: scaled("agents:10,messages:2000"),
    act: async (context) => {
      await openAgent(context, scaleAgent(1));
      context.record({ "scroll.steps": await scrollThroughHistory(context) });
      for (let index = 2; index <= 10; index += 1) {
        await openAgent(context, scaleAgent(index));
        await context.wait(1_500);
      }
      await openAgent(context, scaleAgent(1));
      await context.wait(5 * SECOND);
    },
    snapshots: true,
  },
  streaming("claude"),
  streaming("opencode"),
  streaming("grok"),
  parallel("claude", 3),
  parallel("claude", 5),
  parallel("opencode", 5),
  parallel("grok", 5),
  {
    id: "s7-release-claude",
    description: "5 claude agents run one turn each, then idle 11 min (the idle release is 10 min)",
    seed: scaled("agents:5,messages:20"),
    act: async (context) => {
      const agents = Array.from({ length: 5 }, (_, index) => scaleAgent(index + 1));
      await useProvider(context, agents, "claude");
      await runTurns(context, agents, SHORT_REPLY_PROMPT);
      await context.wait(11 * MINUTE);
    },
  },
  {
    id: "s8-soak",
    description: "20 claude turns on one agent with an agent switch between turns",
    seed: scaled("agents:2,messages:50"),
    act: async (context) => {
      const [first, second] = [scaleAgent(1), scaleAgent(2)];
      await useProvider(context, [first], "claude");
      const settledHeaps = async (): Promise<MetricValues> => {
        await context.inspector?.collectGarbage();
        const heap = await context.inspector?.readHeap();
        const renderer = await context.evaluate<number>(
          "(performance.memory ? performance.memory.usedJSHeapSize : 0) / 1048576",
        );
        return { main: heap?.heapUsedMb ?? 0, renderer: Math.round(renderer * 10) / 10 };
      };
      let failed = 0;
      let firstHeaps: MetricValues | null = null;
      for (let turn = 1; turn <= 20; turn += 1) {
        await openAgent(context, first);
        await runTurns(context, [first], SHORT_REPLY_PROMPT);
        failed += (await lastReply(context, first)).completed ? 0 : 1;
        await openAgent(context, second);
        await context.wait(SECOND);
        if (turn === 1) firstHeaps = await settledHeaps();
      }
      const lastHeaps = await settledHeaps();
      context.record({
        "turns.failed": failed,
        "soak.heap.main.first": firstHeaps?.main ?? 0,
        "soak.heap.main.last": lastHeaps.main ?? 0,
        "soak.heap.renderer.first": firstHeaps?.renderer ?? 0,
        "soak.heap.renderer.last": lastHeaps.renderer ?? 0,
      });
    },
    snapshots: true,
  },
  {
    id: "s9-channel",
    description: "A channel with 3 member agents, one claude task each, channel open",
    seed: SHOWCASE,
    act: async (context) => {
      interface ListedChannel {
        id: string;
        name: string;
        members: { agentId: string }[];
        activeTasks: number;
      }
      const channels = await context.evaluate<ListedChannel[]>("window.openbot.agent.listChannels()");
      const channel = channels.find((one) => one.members.length >= 3);
      if (!channel) throw new Error("The showcase seed has no channel with 3 members.");
      const members = channel.members.slice(0, 3).map((member) => member.agentId);
      await useProvider(context, members, "claude");
      await openChannel(context, channel.name);
      const started = Date.now();
      for (const agentId of members) {
        const command = {
          type: "send",
          operationId: crypto.randomUUID(),
          channelId: channel.id,
          text: SHORT_REPLY_PROMPT,
          recipientAgentId: agentId,
          replyToMessageId: null,
          attachmentDraftIds: [],
        };
        await context.evaluate(`window.openbot.agent.channelCommand(${json(command)}).then(() => null)`);
      }
      const activeTasks = (): Promise<number> =>
        context.evaluate<number>(
          `window.openbot.agent.listChannels().then((all) => all.find((one) => one.id === ${json(channel.id)})?.activeTasks ?? 0)`,
        );
      await poll("the channel tasks to start", MINUTE, SECOND, async () => (await activeTasks()) > 0);
      await poll(
        "the channel tasks to finish",
        3 * TURN_TIMEOUT_MS,
        2 * SECOND,
        async () => (await activeTasks()) === 0,
      );
      context.record({ "turns.ms": Date.now() - started });
      await context.wait(30 * SECOND);
    },
  },
  browserTabs(1),
  browserTabs(5),
  browserTabs(25),
  manyAgents(20, 6),
  manyAgents(100, 30),
  {
    id: "s11-computer-use",
    description: "Computer Use state read (starts the driver when permitted), idle 2 min",
    seed: SHOWCASE,
    act: async (context) => {
      const state = await context.evaluate<{ status: string }>("window.openbot.computerUse.getState()");
      context.logger.info(`Computer Use: ${state.status}`);
      context.record({ "computerUse.ready": state.status === "ready" ? 1 : 0 });
      await context.wait(2 * MINUTE);
    },
  },
  {
    id: "s12-island-off",
    description: "Showcase seed, Dynamic Island turned off, idle 2 min (compare with s12-island-on)",
    seed: SHOWCASE,
    act: async (context) => {
      const preference = await context.evaluate<DynamicIslandPreference>(
        "window.openbot.dynamicIsland.getPreference()",
      );
      await context.evaluate(
        `window.openbot.dynamicIsland.setPreference(${json({ ...preference, enabled: false })}).then(() => null)`,
      );
      await context.wait(2 * MINUTE);
    },
  },
  {
    id: "s12-island-on",
    description: "Showcase seed, Dynamic Island on (the default), idle 2 min",
    seed: SHOWCASE,
    act: idle(2 * MINUTE),
  },
  {
    id: "s13-images",
    description: "A chat with 20 attached 2400x1600 images, scrolled through",
    seed: scaled("agents:1,messages:40,attachments:20"),
    act: async (context) => {
      await openAgent(context, scaleAgent(1));
      await context.wait(3 * SECOND);
      context.record({ "scroll.steps": await scrollThroughHistory(context) });
      await context.wait(10 * SECOND);
    },
  },
];
