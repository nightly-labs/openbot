import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { CHANNEL_ROUTES } from "@openbot/contracts/team-protocol/channels-v1";
import { SIDEBAR_PINS_ROUTES } from "@openbot/contracts/team-protocol/sidebar-pins-v1";
import {
  AGENTS_SYNC_COLLECTION,
  CHANNELS_SYNC_COLLECTION,
  QUEUE_SYNC_COLLECTION,
  SIDEBAR_PINS_SYNC_COLLECTION,
  WORKFLOWS_SYNC_COLLECTION,
} from "@openbot/contracts/team-protocol/sync-collections";
import {
  AGENT_MESSAGES_SYNC_LOG,
  CHANNEL_MESSAGES_SYNC_LOG,
  CHANNEL_PAGE_META_SYNC_COLLECTION,
  CONVERSATION_PAGE_META_SYNC_COLLECTION,
} from "@openbot/contracts/team-protocol/sync-logs";
import { WORKFLOWS_ROUTES } from "@openbot/contracts/team-protocol/workflows-v1";
import { translateFor } from "@openbot/i18n";
import { createOpenBotLogger } from "@openbot/logging";
import { type RemoteRequestRecord, routeTemplate } from "@openbot/team-client/sync-profile";
import { type Browser, chromium, type Locator, type Page } from "playwright-core";
import { argument, WAIT_MS } from "./channel-e2e-support";
import { delay, instrumentRemotePeer, literal, readSyncSink, signInDevHost } from "./remote-perf-support";

const NAME = "web-sync";
const ROOT = resolve(import.meta.dirname, "..");
const OUT = resolve(ROOT, ".openbot-build", `${NAME}-e2e`);
const MARK_PREFIX = "openbot:remote-";
const QUIET_MS = 1_500;
const english = translateFor("en");
const logger = createOpenBotLogger(NAME);

const api = (argument("api") ?? "http://localhost:3100").replace(/\/$/, "");
const hostCdp = argument("host-cdp");
const browserExecutable = argument("browser-executable");
const agentName = argument("agent") ?? "Research";
const channelName = argument("channel") ?? "Launch room";
const queueAgentName = argument("queue-agent") ?? "Chief";
const STEP_NAMES = ["channels", "agents", "pins", "workflows", "reactions", "queue", "channel-messages"] as const;
type StepName = (typeof STEP_NAMES)[number];
const only = new Set(argument("steps")?.split(",") ?? STEP_NAMES);
for (const name of only)
  assert.ok(
    STEP_NAMES.some((step) => step === name),
    `Unknown step: ${name}.`,
  );
assert.ok(hostCdp, "--host-cdp takes the remote debugging port of the dev host app.");
assert.ok(
  process.argv.includes("--allow-mutations"),
  "This test renames a channel, an agent and a workflow, changes a pin, adds and removes a reaction, sends one agent message and posts one channel message on the dev host. Re-run with --allow-mutations.",
);

interface Change {
  label: string;
  run(host: Page, page: Page): Promise<void>;
  visible(page: Page): Locator;
  state?: "visible" | "detached";
}

interface Step {
  name: StepName;
  listRoutes: readonly string[];
  marks: readonly string[];
  open(page: Page): Promise<number>;
  changes(host: Page): Promise<Change[]>;
}

interface ChangeReport {
  step: StepName;
  change: string;
  visibleMs: number;
  routes: string[];
  listCalls: number;
}

interface Report {
  createdAt: string;
  api: string;
  initialListCalls: Record<string, number>;
  changes: ChangeReport[];
  passed: boolean;
  failure: string | null;
}

const routeKey = (record: RemoteRequestRecord) => `${record.method} ${record.route}`;
const listCallsOf = (step: Step, routes: readonly string[]) =>
  routes.filter((route) => step.listRoutes.some((listed) => route === listed || route.startsWith(`${listed}?`))).length;
const timelineMessage = (page: Page, text: string) => page.getByRole("article").filter({ hasText: text }).first();
const startsWith = (text: string) => new RegExp(`^${literal(text)}`);
const rowCss = (label: string) => `[aria-label^=${JSON.stringify(`${label},`)}]`;
const pinnedCss = (name: string) => `[aria-label^=${JSON.stringify(english("sidebar.pinned.agent", { name }))}]`;
const stamp = Date.now().toString(36);
const SAMPLE_ID = "00000000-0000-4000-8000-000000000000";

function pageNow(page: Page): Promise<number> {
  return page.evaluate(() => performance.timeOrigin + performance.now());
}

async function waitMark(page: Page, name: string, after: number): Promise<void> {
  await page.waitForFunction(
    ({ mark, after }) =>
      performance.getEntriesByName(mark).some((entry) => performance.timeOrigin + entry.startTime >= after),
    { mark: `${MARK_PREFIX}${name}`, after },
    { timeout: WAIT_MS, polling: 100 },
  );
}

async function settleNetwork(page: Page, from: number): Promise<RemoteRequestRecord[]> {
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    const sink = await readSyncSink(page);
    const mine = sink.records.filter((record) => record.startedAt >= from);
    const lastEnd = Math.max(from, ...mine.map((record) => record.endedAt));
    if (sink.open === 0 && (await pageNow(page)) - lastEnd >= QUIET_MS) return mine;
    if (Date.now() > deadline) throw new Error("The network of the web client did not become quiet.");
    await delay(100);
  }
}

let hostPage: Page | null = null;
let hostBrowser: Browser | null = null;

async function hostRenderer(): Promise<Page> {
  if (hostPage) return hostPage;
  const host = await chromium.connectOverCDP(`http://127.0.0.1:${hostCdp}`);
  hostBrowser = host;
  for (const context of host.contexts())
    for (const candidate of context.pages()) {
      const bridged = await candidate
        .evaluate(() => typeof window.openbot?.agent?.channelCommand === "function")
        .catch(() => false);
      if (bridged) {
        hostPage = candidate;
        return candidate;
      }
    }
  throw new Error("The host app has no window with the OpenBot bridge.");
}

async function hostAgentId(host: Page, name: string): Promise<string> {
  const id = await host.evaluate(
    async (wanted) => (await window.openbot.agent.listAgents()).find((agent) => agent.name === wanted)?.id ?? null,
    name,
  );
  assert.ok(id, `The host has no agent with the name "${name}".`);
  return id;
}

function renameChannel(from: string, to: string): Change {
  return {
    label: `rename channel to "${to}"`,
    run: async (host) => {
      await host.evaluate(
        async ({ from, to }) => {
          const agent = window.openbot.agent;
          const channel = (await agent.listChannels()).find((item) => item.name === from);
          if (!channel) throw new Error("The host has no channel with this name.");
          const { title, instructions, members, leadAgentId, isolated, browser, icon } = channel;
          await agent.channelCommand({
            type: "save",
            operationId: crypto.randomUUID(),
            channelId: channel.id,
            update: true,
            draft: {
              name: to,
              title,
              instructions,
              members,
              leadAgentId,
              ...(isolated === undefined ? {} : { isolated }),
              ...(browser === undefined ? {} : { browser }),
              ...(icon === undefined ? {} : { icon }),
            },
          });
        },
        { from, to },
      );
    },
    visible: (page) => page.locator(rowCss(to)).first(),
  };
}

function renameAgent(agentId: string, to: string): Change {
  return {
    label: `rename agent to "${to}"`,
    run: async (host) => {
      await host.evaluate(({ agentId, to }) => window.openbot.agent.updateAgent({ agentId, name: to }), {
        agentId,
        to,
      });
    },
    visible: (page) => page.getByRole("button", { name: startsWith(`${to},`) }).first(),
  };
}

function setPinned(agentId: string, pinned: boolean): Change {
  return {
    label: pinned ? `pin "${agentName}"` : `unpin "${agentName}"`,
    run: async (host) => {
      await host.evaluate(
        async ({ agentId, pinned }) => {
          const agent = window.openbot.agent;
          const others = (await agent.getSidebarPins()).items.filter(
            (item) => item.kind !== "agent" || item.id !== agentId,
          );
          await agent.setSidebarPins({
            items: pinned ? [{ kind: "agent", id: agentId }, ...others] : others,
          });
        },
        { agentId, pinned },
      );
    },
    visible: (page) => page.locator(pinnedCss(agentName)).first(),
    state: pinned ? "visible" : "detached",
  };
}

function renameWorkflow(workflowId: string, to: string): Change {
  return {
    label: `rename workflow to "${to}"`,
    run: async (host) => {
      await host.evaluate(({ workflowId, to }) => window.openbot.workflows.rename({ workflowId, title: to }), {
        workflowId,
        to,
      });
    },
    visible: (page) => page.getByText(to, { exact: true }).first(),
  };
}

async function openChannel(page: Page, name: string): Promise<void> {
  await page.locator(rowCss(name)).first().click();
}

function postChannelMessage(name: string, text: string): Change {
  return {
    label: "post one channel message from the host",
    run: async (host) => {
      await host.evaluate(
        async ({ name, text }) => {
          const agent = window.openbot.agent;
          const channel = (await agent.listChannels()).find((item) => item.name === name);
          if (!channel) throw new Error("The host has no channel with this name.");
          await agent.channelCommand({
            type: "send",
            operationId: crypto.randomUUID(),
            channelId: channel.id,
            text,
            recipientAgentId: null,
            replyToMessageId: null,
            attachmentDraftIds: [],
          });
        },
        { name, text },
      );
    },
    visible: (page) => timelineMessage(page, text),
  };
}

async function showAgents(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: english("app.rail.agents"), exact: true })
    .first()
    .click();
}

async function openAgent(page: Page, name: string): Promise<void> {
  await page
    .getByRole("navigation", { name: english("sidebar.nav.label") })
    .getByRole("button", { name: startsWith(`${name},`) })
    .first()
    .click();
  await page
    .getByRole("textbox", { name: english("composer.placeholder.message", { name }) })
    .waitFor({ timeout: WAIT_MS });
}

const REACTION = "👍";

async function shownUserMessageId(host: Page, page: Page, agentId: string): Promise<string> {
  const ids = await host.evaluate(async (agentId) => {
    const conversation = await window.openbot.agent.readConversationPage({ agentId });
    return conversation.messages
      .filter((message) => message.author === "user" && message.source !== "routine")
      .map((message) => message.id);
  }, agentId);
  for (const id of ids.reverse()) if (await page.locator(`[data-chat-search-message="${id}"]`).isVisible()) return id;
  throw new Error("The web shows no message from the user in this chat. Send one on the dev host first.");
}

async function setHostReaction(host: Page, agentId: string, messageId: string, emoji: "👍" | null): Promise<void> {
  await host.evaluate((input) => window.openbot.agent.setMessageReaction(input), { agentId, messageId, emoji });
}

function reactionOn(page: Page, messageId: string): Locator {
  return page.locator(`[data-chat-search-message="${messageId}"] [aria-label*="${REACTION}"]`).first();
}

function removeReactionAfterOpen(agentId: string): Change {
  let messageId = "";
  return {
    label: "host removes a reaction right after the web opens the chat",
    run: async (host, page) => {
      messageId = await shownUserMessageId(host, page, agentId);
      await openAgent(page, queueAgentName);
      await setHostReaction(host, agentId, messageId, REACTION);
      await openAgent(page, agentName);
      await reactionOn(page, messageId).waitFor({ timeout: WAIT_MS });
      await setHostReaction(host, agentId, messageId, null);
    },
    visible: (page) => reactionOn(page, messageId),
    state: "detached",
  };
}

const noOpen = async () => 0;

function steps(): Step[] {
  const renamedChannel = `${channelName} ${stamp}`;
  const renamedAgent = `${agentName} ${stamp}`;
  const queueText = `Web sync check ${stamp}. Reply with the word ok.`;
  const channelText = `Web sync channel check ${stamp}. Reply with the word ok.`;
  const all: Step[] = [
    {
      name: "channels",
      listRoutes: [`GET ${routeTemplate(CHANNEL_ROUTES.list)}`],
      marks: [`sync:${CHANNELS_SYNC_COLLECTION.name}`],
      open: noOpen,
      changes: async () => [renameChannel(channelName, renamedChannel), renameChannel(renamedChannel, channelName)],
    },
    {
      name: "agents",
      listRoutes: [`GET ${routeTemplate(TEAM_API_ROUTES.agents.all)}`],
      marks: [`sync:${AGENTS_SYNC_COLLECTION.name}`],
      open: noOpen,
      changes: async (host) => {
        const id = await hostAgentId(host, agentName);
        return [renameAgent(id, renamedAgent), renameAgent(id, agentName)];
      },
    },
    {
      name: "pins",
      listRoutes: [`GET ${routeTemplate(SIDEBAR_PINS_ROUTES.read)}`],
      marks: [`sync:${SIDEBAR_PINS_SYNC_COLLECTION.name}`],
      open: noOpen,
      changes: async (host) => {
        const id = await hostAgentId(host, agentName);
        const pinned = await host.evaluate(
          async (agentId) =>
            (await window.openbot.agent.getSidebarPins()).items.some(
              (item) => item.kind === "agent" && item.id === agentId,
            ),
          id,
        );
        return [setPinned(id, !pinned), setPinned(id, pinned)];
      },
    },
    {
      name: "workflows",
      listRoutes: [`POST ${routeTemplate(WORKFLOWS_ROUTES.list)}`],
      marks: [`sync:${WORKFLOWS_SYNC_COLLECTION.name}`],
      open: async (page) => {
        const from = await pageNow(page);
        await page
          .getByRole("button", { name: english("app.rail.workflows"), exact: true })
          .first()
          .click();
        await page
          .getByRole("button", { name: english("workflow.canvas.switcher.all") })
          .first()
          .click();
        return from;
      },
      changes: async (host) => {
        const first = await host.evaluate(async () => {
          const [workflow] = await window.openbot.workflows.list();
          return workflow ? { id: workflow.id, title: workflow.title } : null;
        });
        assert.ok(first, "The host has no workflow. Make one on the dev host first.");
        return [renameWorkflow(first.id, `${first.title} ${stamp}`), renameWorkflow(first.id, first.title)];
      },
    },
    {
      name: "reactions",
      listRoutes: [],
      marks: [`sync:${AGENT_MESSAGES_SYNC_LOG.name}`, `sync:${CONVERSATION_PAGE_META_SYNC_COLLECTION.name}`],
      open: async (page) => {
        const from = await pageNow(page);
        await showAgents(page);
        await openAgent(page, agentName);
        return from;
      },
      changes: async (host) => {
        return [removeReactionAfterOpen(await hostAgentId(host, agentName))];
      },
    },
    {
      name: "queue",
      listRoutes: [
        `GET ${routeTemplate(TEAM_API_ROUTES.agent.queue(SAMPLE_ID))}`,
        `GET ${routeTemplate(TEAM_API_ROUTES.agent.conversationPage(SAMPLE_ID))}`,
        `GET ${routeTemplate(TEAM_API_ROUTES.agent.conversation(SAMPLE_ID))}`,
      ],
      marks: [
        `sync:${QUEUE_SYNC_COLLECTION.name}`,
        `sync:${AGENT_MESSAGES_SYNC_LOG.name}`,
        `sync:${CONVERSATION_PAGE_META_SYNC_COLLECTION.name}`,
      ],
      open: async (page) => {
        await showAgents(page);
        await openAgent(page, agentName);
        await settleNetwork(page, await pageNow(page));
        const from = await pageNow(page);
        await openAgent(page, queueAgentName);
        return from;
      },
      changes: async (host) => {
        const id = await hostAgentId(host, queueAgentName);
        return [
          {
            label: "send one message from the host",
            run: async () => {
              await host.evaluate(({ agentId, text }) => window.openbot.agent.sendMessage({ agentId, text }), {
                agentId: id,
                text: queueText,
              });
            },
            visible: (page) => timelineMessage(page, queueText),
          },
        ];
      },
    },
    {
      name: "channel-messages",
      listRoutes: [`POST ${routeTemplate(CHANNEL_ROUTES.read)}`],
      marks: [`sync:${CHANNEL_MESSAGES_SYNC_LOG.name}`, `sync:${CHANNEL_PAGE_META_SYNC_COLLECTION.name}`],
      open: async (page) => {
        const from = await pageNow(page);
        await openChannel(page, channelName);
        return from;
      },
      changes: async () => [postChannelMessage(channelName, channelText)],
    },
  ];
  return all.filter((step) => only.has(step.name));
}

async function runStep(page: Page, host: Page, step: Step, report: Report): Promise<void> {
  const openedAt = await step.open(page);
  for (const mark of step.marks) await waitMark(page, mark, openedAt);
  await settleNetwork(page, await pageNow(page));
  for (const change of await step.changes(host)) {
    const from = await pageNow(page);
    await change.run(host, page);
    await change.visible(page).waitFor({ state: change.state ?? "visible", timeout: WAIT_MS });
    const visibleMs = Math.round((await pageNow(page)) - from);
    const records = await settleNetwork(page, from);
    const routes = records.map(routeKey);
    const listCalls = listCallsOf(step, routes);
    report.changes.push({ step: step.name, change: change.label, visibleMs, routes, listCalls });
    logger.info(`${step.name}: ${change.label}: visible after ${visibleMs} ms, ${listCalls} list calls.`);
    assert.equal(
      listCalls,
      0,
      `${step.name}: "${change.label}" made ${listCalls} HTTP calls to ${step.listRoutes.join(", ")}.`,
    );
  }
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const report: Report = {
    createdAt: new Date().toISOString(),
    api,
    initialListCalls: {},
    changes: [],
    passed: false,
    failure: null,
  };
  const browser: Browser = await chromium.launch(
    browserExecutable ? { executablePath: browserExecutable } : { channel: "chrome" },
  );
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  try {
    await instrumentRemotePeer(context, 0);
    await signInDevHost(page, api, OUT);
    await page.waitForFunction(
      (mark) => performance.getEntriesByName(mark).length > 0,
      `${MARK_PREFIX}workspace-ready`,
      {
        timeout: WAIT_MS,
      },
    );
    const host = await hostRenderer();
    const plan = steps();
    const initial = await settleNetwork(page, 0);
    for (const step of plan) report.initialListCalls[step.name] = listCallsOf(step, initial.map(routeKey));
    for (const step of plan) {
      try {
        await runStep(page, host, step, report);
      } catch (error) {
        await page.screenshot({ path: resolve(OUT, `${step.name}-failure.png`) }).catch(() => undefined);
        throw error;
      }
    }
    await page.screenshot({ path: resolve(OUT, "web-sync.png") });
    report.passed = true;
  } catch (error) {
    report.failure = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    writeFileSync(resolve(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
    logger.info(`Report: ${resolve(OUT, "report.json")}`);
    await context.close();
    await browser.close();
    await hostBrowser?.close();
  }
}

await main();
