// Runs turns on the real ACP client against a fake agent that reports subagents as the pinned agents
// do (`provider-fakes/agents/subagents.ts`). Checks the `turn/subagents/updated` notifications that
// the chat's subagent card shows:
// - OpenCode: the client asks for child session updates; a child's steps, thinking, nested child,
//   failure and a background child that ends after its turn.
// - Kimi, Cline, Hermes: a subagent tool call gives a card with its task and its report or error.
//   Kimi's background call is not shown. A turn that the person stops stops its subagent.
// `bun run test:acp-subagents`. Writes .openbot-build/acp-subagents-e2e/report.json.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ConversationSubagent } from "@openbot/contracts/ipc";
import { AcpAgentClient } from "../src/backend/acp-client";
import { CLINE_ACP_FLAVOR, HERMES_ACP_FLAVOR, KIMI_ACP_FLAVOR } from "../src/backend/acp-flavor";
import { SUBAGENTS_UPDATED_METHOD, subagentsFromNotification } from "../src/backend/agent/subagent-updates";
import type { AgentClient } from "../src/backend/agent-client";
import type { AgentCliInfo } from "../src/backend/cli";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { type AppServerNotification, getString } from "../src/backend/protocol";
import { NO_PROVIDER_CREDENTIALS, requireProviderDriver } from "../src/backend/provider-drivers";
import { installFakeAgent, readJsonl, runTurn, startThread, stopClients } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/acp-subagents-e2e");
const WAIT_MS = 20_000;

/** The parts of a subagent that the card shows, without its times. */
interface Card {
  title: string;
  agentType: string | null;
  prompt: string | null;
  status: ConversationSubagent["status"];
  error: string | null;
  background: boolean;
  steps: string[];
}

interface Report {
  passed: boolean;
  /** The last list of each turn, by provider and prompt. */
  cards: Record<string, Card[]>;
  /** How many `turn/subagents/updated` notifications each case sent. */
  notifications: Record<string, number>;
  openCodeAskedForChildUpdates: boolean | null;
}

const root = await mkdtemp(join(tmpdir(), "openbot-acp-subagents-e2e-"));
const report: Report = { passed: false, cards: {}, notifications: {}, openCodeAskedForChildUpdates: null };
const clients: AgentClient[] = [];

function card(subagent: ConversationSubagent): Card {
  return {
    title: subagent.title,
    agentType: subagent.agentType,
    prompt: subagent.prompt,
    status: subagent.status,
    error: subagent.error,
    background: subagent.background === true,
    steps: subagent.steps.map((step) => `${step.kind}: ${step.text}`),
  };
}

/** The subagent lists of one thread, and a wait for a list that matches. */
function watch(client: AgentClient, thread: string) {
  const lists: ConversationSubagent[][] = [];
  const waiters = new Set<() => void>();
  client.on("notification", (notification: AppServerNotification) => {
    if (notification.method !== SUBAGENTS_UPDATED_METHOD) return;
    if (getString(notification.params, "threadId") !== thread) return;
    const subagents = subagentsFromNotification(notification.params);
    assert.ok(subagents, "The notification decodes as a subagent list.");
    lists.push(subagents);
    for (const waiter of waiters) waiter();
  });
  const until = (
    label: string,
    find: (subagents: ConversationSubagent[]) => boolean,
  ): Promise<ConversationSubagent[]> =>
    new Promise((found, fail) => {
      const check = () => {
        const list = lists.findLast(find);
        if (!list) return;
        waiters.delete(check);
        clearTimeout(timer);
        found(list);
      };
      const timer = setTimeout(() => {
        waiters.delete(check);
        fail(new Error(`Timed out waiting for ${label}.`));
      }, WAIT_MS);
      waiters.add(check);
      check();
    });
  return { lists, until };
}

function save(name: string, lists: readonly ConversationSubagent[][]): Card[] {
  const cards = (lists.at(-1) ?? []).map(card);
  report.cards[name] = cards;
  report.notifications[name] = lists.length;
  return cards;
}

async function fakeCli(name: string, style: string, log: string): Promise<AgentCliInfo> {
  const executable = join(root, name, "bin", name);
  await installFakeAgent(executable, "subagents", { FAKE_STYLE: style, FAKE_LOG: log });
  return { executable, version: "1.0.0", source: "managed" };
}

/** A client with an agent's flavor and no driver: the Cline driver fetches free models from the network. */
async function flavoredClient(style: "kimi" | "cline" | "hermes"): Promise<AgentClient> {
  const flavors = { kimi: KIMI_ACP_FLAVOR, cline: CLINE_ACP_FLAVOR, hermes: HERMES_ACP_FLAVOR };
  const cli = await fakeCli(style, style, join(root, `${style}.jsonl`));
  const client = new AcpAgentClient(cli, 10_000, {
    provider: style,
    flavor: flavors[style],
    argv: ["acp"],
    env: {},
    signInMessage: "Sign in.",
  });
  clients.push(client);
  client.start();
  return client;
}

try {
  const workspace = join(root, "workspace");
  await mkdir(workspace);

  // OpenCode, through its driver.
  {
    const log = join(root, "opencode.jsonl");
    const cli = await fakeCli("opencode", "opencode", log);
    const client = requireProviderDriver("opencode").createClient(cli, 10_000, NO_PROVIDER_CREDENTIALS);
    clients.push(client);
    client.start();
    const thread = await startThread(client, { cwd: workspace });
    const work = watch(client, thread);
    assert.equal((await runTurn(client, thread, { text: "work" })).status, "completed");
    const entries = await readJsonl<{ event: string; childUpdates?: boolean }>(log);
    report.openCodeAskedForChildUpdates = entries.find((entry) => entry.event === "initialize")?.childUpdates ?? null;
    assert.equal(report.openCodeAskedForChildUpdates, true, "OpenBot asks OpenCode for child session updates.");
    const cards = save("opencode/work", work.lists);
    assert.deepEqual(cards, [
      {
        title: "Review the parser",
        agentType: "general",
        prompt: "Read parser.ts and list its bugs.",
        status: "completed",
        error: null,
        background: false,
        steps: [
          "read: /work/parser.ts",
          "thinking: The loop skips the last token.",
          "search: TODO",
          "text: Found two bugs.",
        ],
      },
      {
        title: "Run the tests",
        agentType: "general",
        prompt: "Run the unit tests.",
        status: "failed",
        error: "The model is rate limited.",
        background: false,
        steps: [],
      },
    ]);

    const background = watch(client, thread);
    assert.equal((await runTurn(client, thread, { text: "background" })).status, "completed");
    await background.until("the background subagent's end", (list) => list[0]?.status === "completed");
    const ended = save("opencode/background", background.lists);
    assert.deepEqual(ended, [
      {
        title: "Index the repository",
        agentType: "explore",
        prompt: "Index every file.",
        status: "completed",
        error: null,
        background: true,
        steps: ["command: ls -R"],
      },
    ]);
  }

  // Kimi: the arguments come as content, and a background call is not shown.
  {
    const client = await flavoredClient("kimi");
    const thread = await startThread(client, { cwd: workspace, model: "fake/model" });
    const work = watch(client, thread);
    assert.equal((await runTurn(client, thread, { text: "work" })).status, "completed");
    assert.deepEqual(save("kimi/work", work.lists), [
      {
        title: "Find the tests",
        agentType: "explore",
        prompt: "List the test files.",
        status: "completed",
        error: null,
        background: false,
        steps: ["text: There are 12 test files."],
      },
      {
        title: "Fix the build",
        agentType: "explore",
        prompt: "Fix it.",
        status: "failed",
        error: "Subagent crashed: context window exceeded.",
        background: false,
        steps: [],
      },
    ]);
  }

  // Cline: the task is in `rawInput`; another tool is not a subagent. A stopped turn stops its subagent.
  {
    const client = await flavoredClient("cline");
    const thread = await startThread(client, { cwd: workspace, model: "fake/model" });
    const work = watch(client, thread);
    assert.equal((await runTurn(client, thread, { text: "work" })).status, "completed");
    assert.deepEqual(save("cline/work", work.lists), [
      {
        title: "Audit the dependencies",
        agentType: null,
        prompt: "Audit the dependencies.",
        status: "completed",
        error: null,
        background: false,
        steps: ["text: No known vulnerabilities."],
      },
      {
        title: "Update the lockfile",
        agentType: null,
        prompt: "Update the lockfile.",
        status: "failed",
        error: "The subagent hit its iteration limit.",
        background: false,
        steps: [],
      },
    ]);

    const stopped = watch(client, thread);
    const turn = runTurn(client, thread, { text: "stop" });
    await stopped.until("the running subagent", (list) => list[0]?.status === "running");
    await runCauseEffect(client.request("turn/interrupt", { threadId: thread }, (value) => value));
    assert.equal((await turn).status, "interrupted");
    const cards = save("cline/stopped", stopped.lists);
    assert.equal(cards[0]?.status, "stopped", "Stopping the turn stops its foreground subagent.");
  }

  // Hermes: the goal is in the title.
  {
    const client = await flavoredClient("hermes");
    const thread = await startThread(client, { cwd: workspace, model: "fake/model" });
    const work = watch(client, thread);
    assert.equal((await runTurn(client, thread, { text: "work" })).status, "completed");
    assert.deepEqual(save("hermes/work", work.lists), [
      {
        title: "Summarize the logs",
        agentType: null,
        prompt: null,
        status: "completed",
        error: null,
        background: false,
        steps: ["text: The logs show three restarts."],
      },
    ]);
  }

  report.passed = true;
} finally {
  await stopClients(clients);
  await rm(root, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
