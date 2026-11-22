import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AcpAgentClient } from "../src/backend/acp-client";
import { type AcpFlavor, DEFAULT_ACP_FLAVOR } from "../src/backend/acp-flavor";
import { ANTIGRAVITY_ACP_FLAVOR } from "../src/backend/acp-flavor-antigravity";
import type { AgentClient } from "../src/backend/agent-client";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { type AppServerRequest, getRecord, getString } from "../src/backend/protocol";
import { installFakeAgent, readJsonl, runTurn, stopClients } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/acp-workspace-bridge-tools-e2e");

const BRIDGE_CALLS = [
  { toolCallId: "agy-title", title: "Run mcp_openbot_send_message", kind: "other" },
  { toolCallId: "agy-browser-title", title: "Run mcp_openbot_browser_navigate?", kind: "other" },
  {
    toolCallId: "agy-server-name",
    title: "MCP Tool send_message",
    kind: "execute",
    rawInput: { ServerName: "openbot", ToolName: "send_message" },
  },
  { toolCallId: "grok-title", title: "openbot__send_message", kind: "other" },
];

const OTHER_CALLS = [
  { toolCallId: "no-server", title: "Running send_message", kind: "other" },
  { toolCallId: "title-command", title: "Run mcp_openbot_send_message", kind: "execute" },
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
    toolCallId: "command-line",
    title: "Run mcp_openbot_send_message",
    kind: "execute",
    rawInput: { CommandLine: "Run mcp_openbot_send_message" },
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
  { toolCallId: "shell", title: "rm -rf build", kind: "execute" },
];

const DYNAMIC_TOOLS = [
  {
    type: "namespace",
    name: "openbot",
    description: "OpenBot tools",
    tools: [{ type: "function", name: "send_message", description: "Send a message", inputSchema: { type: "object" } }],
  },
  {
    type: "namespace",
    name: "openbot_browser",
    description: "OpenBot browser",
    tools: [{ type: "function", name: "navigate", description: "Open a page", inputSchema: { type: "object" } }],
  },
];

interface Run {
  status: string | null;
  error: string | null;
  cards: string[];
  outcomes: Record<string, string>;
}

interface Report {
  passed: boolean;
  confined?: Run;
  unconfined?: Run;
  otherFlavor?: Run;
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
    FAKE_TOOL_CALLS: JSON.stringify([...BRIDGE_CALLS, ...OTHER_CALLS]),
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
  return { status: turn.status, error: turn.error, cards, outcomes };
}

try {
  await mkdir(OUT, { recursive: true });

  const confined = await run("confined", true);
  report.confined = confined;
  assert.equal(confined.status, "completed", "The confined turn completes.");
  for (const call of BRIDGE_CALLS)
    assert.equal(confined.outcomes[call.toolCallId], "allow", `${call.toolCallId} runs without a card.`);
  for (const call of OTHER_CALLS)
    assert.equal(confined.outcomes[call.toolCallId], "reject", `${call.toolCallId} keeps its card.`);
  assert.deepEqual(
    confined.cards,
    OTHER_CALLS.map((call) => call.title),
    "Only the requests that are not OpenBot tools show a card.",
  );

  const unconfined = await run("unconfined", false);
  report.unconfined = unconfined;
  assert.equal(unconfined.status, "completed", "The unconfined turn completes.");
  assert.equal(
    unconfined.cards.length,
    BRIDGE_CALLS.length + OTHER_CALLS.length,
    "An agent without Workspace only keeps a card for each request.",
  );

  const otherFlavor = await run("other-flavor", true, DEFAULT_ACP_FLAVOR);
  report.otherFlavor = otherFlavor;
  assert.equal(otherFlavor.status, "completed", "The turn of another confined flavor completes.");
  for (const call of BRIDGE_CALLS)
    assert.equal(
      otherFlavor.outcomes[call.toolCallId],
      call.rawInput === undefined ? "allow" : "reject",
      `${call.toolCallId} on another flavor reads only the title.`,
    );

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
