import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AcpAgentClient } from "../src/backend/acp-client";
import { type AcpFlavor, DEFAULT_ACP_FLAVOR } from "../src/backend/acp-flavor";
import { ANTIGRAVITY_ACP_FLAVOR } from "../src/backend/acp-flavor-antigravity";
import { openBotTool, toolActivity, toolUsage, toThreadItem } from "../src/backend/agent/thread-items";
import type { AgentClient } from "../src/backend/agent-client";
import { runCauseEffect } from "../src/backend/effect-boundary";
import {
  type AppServerNotification,
  type AppServerRequest,
  getRecord,
  getString,
  type ThreadItem,
} from "../src/backend/protocol";
import { installFakeAgent, readJsonl, runTurn, stopClients } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/acp-workspace-bridge-tools-e2e");

const BRIDGE_CALLS = [
  { toolCallId: "agy-title", title: "Run mcp_openbot_send_message", kind: "other" },
  { toolCallId: "agy-browser-title", title: "Run mcp_openbot_browser_open?", kind: "other" },
  {
    toolCallId: "agy-server-name",
    title: "MCP Tool send_message",
    kind: "execute",
    rawInput: { ServerName: "openbot", ToolName: "send_message" },
  },
  { toolCallId: "grok-title", title: "openbot__send_message", kind: "other" },
  {
    toolCallId: "agy-meta-call",
    title: "MCP Tool tool_call",
    kind: "execute",
    rawInput: { ServerName: "openbot", ToolName: "tool_call", Arguments: { name: "openbot.send_message" } },
  },
];

const CONFINED_COMMANDS = [
  { toolCallId: "title-command", title: "Run mcp_openbot_send_message", kind: "execute" },
  {
    toolCallId: "command-line",
    title: "Run mcp_openbot_send_message",
    kind: "execute",
    rawInput: { CommandLine: "Run mcp_openbot_send_message" },
  },
  { toolCallId: "shell", title: "ls attachments", kind: "execute" },
];

const OTHER_CALLS = [
  { toolCallId: "no-server", title: "Running send_message", kind: "other" },
  { toolCallId: "other-server", title: "Run mcp_github_create_issue", kind: "other" },
  {
    toolCallId: "other-server-name",
    title: "MCP Tool send_message",
    kind: "execute",
    rawInput: { ServerName: "github", ToolName: "send_message" },
  },
  {
    toolCallId: "unknown-tool",
    title: "MCP Tool delete_everything",
    kind: "execute",
    rawInput: { ServerName: "openbot", ToolName: "delete_everything" },
  },
  {
    toolCallId: "server-name-edit",
    title: "Edit notes.md",
    kind: "edit",
    rawInput: { TargetFile: "/tmp/notes.md", ServerName: "openbot", ToolName: "send_message" },
  },
  {
    toolCallId: "server-name-command-line",
    title: "MCP Tool send_message",
    kind: "execute",
    rawInput: { ServerName: "openbot", ToolName: "send_message", CommandLine: "rm -rf build" },
  },
];

const ALL_CALLS = [...BRIDGE_CALLS, ...CONFINED_COMMANDS, ...OTHER_CALLS];

const bridgeIds = new Set(BRIDGE_CALLS.map((call) => call.toolCallId));

const DYNAMIC_TOOLS = [
  {
    type: "namespace",
    name: "openbot",
    description: "OpenBot tools",
    tools: [
      { type: "function", name: "send_message", description: "Send a message", inputSchema: { type: "object" } },
      { type: "function", name: "tool_call", description: "Call a tool", inputSchema: { type: "object" } },
    ],
  },
  {
    type: "namespace",
    name: "openbot_browser",
    description: "OpenBot browser",
    tools: [{ type: "function", name: "open", description: "Open a page", inputSchema: { type: "object" } }],
  },
];

interface Run {
  status: string | null;
  error: string | null;
  cards: string[];
  outcomes: Record<string, string>;
  items: Record<string, ThreadItem>;
}

interface Report {
  passed: boolean;
  confined?: Run;
  unconfined?: Run;
  otherFlavor?: Run;
  otherUnconfined?: Run;
  failure?: string;
}

const root = await mkdtemp(join(tmpdir(), "openbot-acp-workspace-bridge-tools-e2e-"));
process.env.GEMINI_HOME = join(root, "gemini");
const report: Report = { passed: false };
const clients: AgentClient[] = [];

async function run(name: string, confined: boolean, flavor: AcpFlavor = ANTIGRAVITY_ACP_FLAVOR): Promise<Run> {
  const executable = join(root, name, "bin", "antigravity");
  const log = join(root, name, "agent.jsonl");
  await installFakeAgent(executable, "antigravity-bridge-permission", {
    FAKE_LOG: log,
    FAKE_TOOL_CALLS: JSON.stringify(ALL_CALLS),
  });
  const client = new AcpAgentClient({ executable, version: "1.5.10", source: "managed" }, 10_000, {
    provider: "antigravity",
    flavor,
    argv: ["acp"],
    env: {},
    signInMessage: "Sign in to the fake agent.",
    ...(confined ? { confine: (target) => target } : {}),
  });
  clients.push(client);
  const cards: string[] = [];
  const items: Record<string, ThreadItem> = {};
  client.on("notification", (notification: AppServerNotification) => {
    const record = getRecord(notification.params, "item");
    const item = record ? toThreadItem(record) : null;
    const id = getString(item, "id");
    if (notification.method === "item/completed" && item?.type === "toolCall" && id) items[id] = item;
  });
  client.on("request", (request: AppServerRequest) => {
    cards.push(getString(request.params, "reason") ?? request.method);
    client.respond(request.id, { decision: "decline" });
  });
  client.start();
  const workspace = join(root, name, "workspace");
  await mkdir(workspace, { recursive: true });
  const response = await runCauseEffect(
    client.request("thread/start", { cwd: workspace, dynamicTools: DYNAMIC_TOOLS }, (value) => value),
  );
  const threadId = getString(getRecord(response, "thread"), "id");
  assert.ok(threadId, "thread/start answers a thread id.");
  const turn = await runTurn(client, threadId, { timeoutMs: 20_000 });
  const outcomes = Object.fromEntries(
    (await readJsonl<{ event: string; text: string; outcome: string }>(log))
      .filter((entry) => entry.event === "permission")
      .map((entry) => [entry.text, entry.outcome]),
  );
  return { status: turn.status, error: turn.error, cards, outcomes, items };
}

try {
  await mkdir(OUT, { recursive: true });

  const confined = await run("confined", true);
  report.confined = confined;
  assert.equal(confined.status, "completed", "The confined turn completes.");
  for (const call of BRIDGE_CALLS)
    assert.equal(confined.outcomes[call.toolCallId], "allow", `${call.toolCallId} runs without a card.`);
  for (const call of CONFINED_COMMANDS)
    assert.equal(confined.outcomes[call.toolCallId], "allow", `${call.toolCallId} runs in the sandbox without a card.`);
  for (const call of OTHER_CALLS)
    assert.equal(confined.outcomes[call.toolCallId], "reject", `${call.toolCallId} keeps its card.`);
  assert.deepEqual(
    confined.cards,
    OTHER_CALLS.map((call) => call.title),
    "Only the requests that are not OpenBot tools or sandboxed commands show a card.",
  );

  const unconfined = await run("unconfined", false);
  report.unconfined = unconfined;
  assert.equal(unconfined.status, "completed", "The unconfined turn completes.");
  for (const call of BRIDGE_CALLS)
    assert.equal(
      unconfined.outcomes[call.toolCallId],
      "allow",
      `${call.toolCallId} runs without a card in Full access.`,
    );
  assert.deepEqual(
    unconfined.cards,
    [...CONFINED_COMMANDS, ...OTHER_CALLS].map((call) => call.title),
    "Without Workspace only, OpenBot tools run without a card, and commands and other tools keep their card.",
  );

  const readAs = {
    "agy-title": "send_message",
    "agy-server-name": "send_message",
  } as const;
  for (const [toolCallId, tool] of Object.entries(readAs)) {
    const item = unconfined.items[toolCallId];
    assert.ok(item, `${toolCallId} has a tool item.`);
    assert.equal(openBotTool(item), tool, `${toolCallId} is read as the OpenBot tool ${tool}.`);
    assert.deepEqual(
      toolUsage(item),
      { kind: "mcp", server: "openbot", tool, failed: false },
      `${toolCallId} counts as an OpenBot MCP call, not a command.`,
    );
  }
  const browserItem = unconfined.items["agy-browser-title"];
  assert.ok(browserItem, "The browser call has a tool item.");
  assert.equal(toolActivity(browserItem, false), "browsing", "A running Gemini browser call shows as browsing.");
  const metaCall = unconfined.items["agy-meta-call"];
  assert.ok(metaCall, "The tool_call call has a tool item.");
  assert.equal(openBotTool(metaCall), "send_message", "A Gemini tool_call reads the OpenBot tool that it calls.");
  const shell = unconfined.items.shell;
  assert.ok(shell, "The shell call has a tool item.");
  assert.equal(openBotTool(shell), null, "A shell command is not read as an OpenBot tool.");

  const otherUnconfined = await run("other-flavor-unconfined", false, DEFAULT_ACP_FLAVOR);
  report.otherUnconfined = otherUnconfined;
  assert.equal(otherUnconfined.status, "completed", "The unconfined turn of another flavor completes.");
  assert.equal(
    otherUnconfined.cards.length,
    ALL_CALLS.length,
    "Another flavor without Workspace only keeps a card for each request.",
  );

  const otherFlavor = await run("other-flavor", true, DEFAULT_ACP_FLAVOR);
  report.otherFlavor = otherFlavor;
  assert.equal(otherFlavor.status, "completed", "The turn of another confined flavor completes.");
  for (const call of ALL_CALLS) {
    const allowed = call.kind === "execute" || (call.rawInput === undefined && bridgeIds.has(call.toolCallId));
    assert.equal(
      otherFlavor.outcomes[call.toolCallId],
      allowed ? "allow" : "reject",
      `${call.toolCallId} on another flavor reads only the title, and runs each command in the sandbox.`,
    );
  }

  report.passed = true;
} catch (error) {
  report.failure = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  await stopClients(clients);
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
