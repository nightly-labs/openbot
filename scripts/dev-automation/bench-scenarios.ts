// The `dev:bench` scenarios: what one run does between "the app is ready" and
// "collect garbage and read the settled state". Each drives the app the way a
// user does: the preload API a click would call, a click on the sidebar, a
// scroll of the chat, or the main-process window call the close button makes.
//
// Turn scenarios use the real claude, opencode and grok CLIs, so they spend
// the developer's model quota. They never start Codex.

import { createServer, type Server } from "node:http";
import type { DynamicIslandPreference } from "@openbot/contracts/ipc";
import type { Logger } from "@openbot/logging";
import type { Browser, Page } from "playwright-core";
import { NO_SCALE, parseSeedScale, type SeedScale } from "../seed-dev-scale";
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
  // Evaluates an expression in the app window and returns its value.
  evaluate: <T = unknown>(expression: string) => Promise<T>;
  wait: (milliseconds: number) => Promise<void>;
  // Values the scenario measured itself. They go into the settled reading.
  record: (values: MetricValues) => void;
}

export interface Scenario {
  id: string;
  description: string;
  seed: SeedPlan;
  act: (context: ScenarioContext) => Promise<void>;
  // Idle time after the garbage collection, before the settled reading.
  settleMs?: number;
  // Heap snapshots of main and the app window after the first run.
  snapshots?: boolean;
}

type BenchProvider = "claude" | "opencode" | "grok";

// The model each provider runs in a turn scenario, when the CLI lists it.
// Otherwise the first model the CLI lists.
const PREFERRED_MODELS: Record<BenchProvider, string> = {
  claude: "claude-sonnet-5",
  opencode: "opencode-go/muse-spark-1.3-contributor",
  grok: "grok-4.6",
};

// A long streamed reply with code blocks and a table, the Markdown the renderer
// works hardest on, and no tool call, so the numbers measure the stream and not
// what a tool did.
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

// --- agents and turns --------------------------------------------------------

interface ListedModel {
  provider: string;
  id: string;
  defaultReasoningEffort: string;
  supportedReasoningEfforts: string[];
}

/** Model discovery ends some seconds after launch, once every provider CLI has answered. */
const MODEL_DISCOVERY_TIMEOUT_MS = 2 * MINUTE;

async function useProvider(context: ScenarioContext, agentIds: string[], provider: BenchProvider): Promise<void> {
  let models: ListedModel[] = [];
  await poll(`${provider} models to be listed`, MODEL_DISCOVERY_TIMEOUT_MS, SECOND, async () => {
    models = await context.evaluate<ListedModel[]>("window.openbot.agent.listModels()");
    return models.some((model) => model.provider === provider);
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

async function openAgent(context: ScenarioContext, agentId: string): Promise<void> {
  await context.page.locator(`[data-chat-id="${agentId}"] > button`).click();
  await context.page.locator('main[aria-label="Conversation"] .conversation-scroll').waitFor();
}

interface SentDelivery {
  agentId: string;
  id: string;
}

/**
 * True when every one of these turns has ended. Waiting on the ids from the send
 * receipt, not on the agent looking idle, because a delivery can take seconds to
 * start its turn, and in that gap the agent has no active turn yet. A completed
 * delivery also needs its reply: a build without the boot-recovery fix settles a
 * turn that starts during provider startup while the reply is still coming.
 */
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

/**
 * Sends one message to each agent at once and waits until every one is idle.
 * Records how many replies failed, so a run that measured an error is visible
 * in the report and not read as a cheap turn.
 */
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

// --- windows -----------------------------------------------------------------

// The app window in the main process: not a Dynamic Island or overlay surface.
const MAIN_WINDOW = `require("electron").BrowserWindow.getAllWindows().find((window) => {
  const url = window.webContents.getURL();
  return url.startsWith("openbot-app://app/index.html") && !url.includes("surface=");
})`;

async function mainWindowCall(context: ScenarioContext, call: "close" | "minimize"): Promise<void> {
  if (!context.inspector) throw new Error("This scenario needs the main-process inspector.");
  const done = await context.inspector.evaluate(`(() => {
    const window = ${MAIN_WINDOW};
    if (!window) return false;
    window.${call}();
    return true;
  })()`);
  if (done !== true) throw new Error(`No app window to ${call}.`);
}

// --- chat scrolling ------------------------------------------------------------

const CHAT_SCROLL = 'main[aria-label="Conversation"] .conversation-scroll';

/**
 * Scrolls to the top until no older page loads, then back to the bottom. Each
 * step at the top loads one older page of 50 messages, so a 2,000-message chat
 * takes about 40 steps.
 */
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

// --- browser tabs ----------------------------------------------------------------

// A page with the weight of an ordinary article: a few thousand nodes, styles,
// and a timer that repaints once a second.
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

// --- scenarios -----------------------------------------------------------------

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
      const escaped = channel.name.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");
      await context.page.getByRole("button", { name: new RegExp(`^${escaped}[.,]`, "u") }).click();
      await context.page.locator('main[aria-label="Channel conversation"]').waitFor();
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
