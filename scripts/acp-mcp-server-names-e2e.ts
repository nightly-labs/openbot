// Runs the real `acp` provider driver over a fake agent that refuses an MCP server name with a
// character outside `[A-Za-z0-9_-]`, as Antigravity does. A server the user named "My Server" made
// every Gemini task fail with `invalid params` (#2801). The session must start with each name changed
// to that form. A changed name that another server has (`computer use` and Computer Use's
// `computer_use`), one that becomes a name of OpenBot's own tools, and the second of two that become
// the same name are reported as drops.
// `bun run test:acp-mcp-names`. Writes .openbot-build/acp-mcp-server-names-e2e/report.json.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { McpServerConfig } from "@openbot/contracts/ipc";
import type { AgentClient } from "../src/backend/agent-client";
import { runCauseEffect } from "../src/backend/effect-boundary";
import type { McpServerDrop } from "../src/backend/mcp-provider-shapes";
import { requireProviderDriver } from "../src/backend/provider-drivers";
import { CustomAgentStore } from "../src/main/custom-agent-store";
import { installFakeAgent, readJsonl, runTurn, startThread, stopClients, xorCipher } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/acp-mcp-server-names-e2e");

interface SessionRequest {
  method: string;
  names: string[];
}

interface Report {
  passed: boolean;
  requests?: SessionRequest[];
  drops?: McpServerDrop[];
  reply?: string;
}

const root = await mkdtemp(join(tmpdir(), "openbot-acp-mcp-names-e2e-"));
const report: Report = { passed: false };
const clients: AgentClient[] = [];

function server(id: string, name: string): McpServerConfig {
  return {
    id,
    name,
    transport: "stdio",
    enabled: true,
    command: "/bin/sh",
    args: ["-c", "sleep 120"],
    env: [],
    envPassthrough: [],
    workingDirectory: "",
    url: "",
    headers: [],
  };
}

try {
  const executable = join(root, "bin", "fake-acp-agent");
  const workspace = join(root, "workspace");
  const log = join(root, "requests.jsonl");
  await mkdir(workspace);
  await installFakeAgent(executable, "mcp-names");

  const store = new CustomAgentStore({ path: join(root, "custom-agents.json"), cipher: xorCipher });
  await runCauseEffect(store.load());
  await runCauseEffect(
    store.save({
      id: "names",
      name: "names",
      command: executable,
      args: [],
      env: [{ name: "FAKE_LOG", value: log }],
      usagePrompt: null,
    }),
  );

  const drops: McpServerDrop[] = [];
  const servers = [
    server("spaced", "My Server"),
    server("underscored", "My_Server"),
    server("bridge-like", "openbot browser"),
    server("computer-use-like", "computer use"),
    // Stands for the built-in Computer Use server, which `McpGateway.enabled` puts after the user's.
    server("computer-use", "computer_use"),
    server("home", "Home Assistant"),
    server("home-dotted", "Home.Assistant"),
  ];
  const driver = requireProviderDriver("acp");
  const context = {
    apiKey: () => null,
    customProviders: () => [],
    mcpServers: () => servers,
    reportMcpDrops: (_provider: string, dropped: readonly McpServerDrop[]) => drops.push(...dropped),
    customAgents: () => store.configs(),
  };
  const cli = await runCauseEffect(driver.resolveCli());
  const client = driver.createClient(cli, 20_000, context, undefined);
  clients.push(client);
  client.start();

  const model = "names/default";
  const thread = await startThread(client, { model, cwd: workspace });
  const turn = await runTurn(client, thread, { model, text: "Reply with OK only." });
  assert.equal(turn.error, null, "The turn succeeds.");
  report.reply = turn.reply;
  assert.equal(turn.reply, "OK", "The turn answers.");

  // The client also opens a session of its own to list models. It carries no servers.
  const requests = await readJsonl<SessionRequest>(log);
  report.requests = requests;
  report.drops = drops;
  const withServers = requests.filter((request) => request.names.length > 0);
  assert.ok(withServers.length > 0, "The thread's session request carries the servers.");
  for (const request of withServers) {
    assert.deepEqual(
      request.names,
      ["My_Server", "computer_use", "Home_Assistant"],
      `${request.method}: each name travels once, in the form the agent accepts.`,
    );
  }
  assert.deepEqual(
    drops.map((drop) => [drop.name, drop.reason]),
    [
      ["My Server", "name_conflict"],
      ["openbot browser", "name_conflict"],
      ["computer use", "name_conflict"],
      ["Home.Assistant", "name_conflict"],
    ],
    "Each changed name that is taken is reported once.",
  );

  report.passed = true;
} finally {
  await stopClients(clients);
  await rm(root, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
