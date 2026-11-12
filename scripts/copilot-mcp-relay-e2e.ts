// Runs the real `copilot` provider driver over a fake agent that, as GitHub Copilot CLI 1.0.105 does,
// starts no stdio MCP server of a session (github/copilot-cli#3889). Computer Use is a stdio server,
// so a Copilot agent with Computer Use on had no desktop tools. OpenBot must start each stdio server
// itself and send it as http, with the server's environment, and end it with the session.
// `bun run test:copilot-mcp-relay`. Writes .openbot-build/copilot-mcp-relay-e2e/report.json.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { McpServerConfig } from "@openbot/contracts/ipc";
import type { AgentClient } from "../src/backend/agent-client";
import { NO_PROVIDER_CREDENTIALS, requireProviderDriver } from "../src/backend/provider-drivers";
import { installFakeAgent, readJsonl, runTurn, startThread, stopClients } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/copilot-mcp-relay-e2e");

interface ServerEntry {
  method: string;
  server: string;
  transport: string;
  tools: string[];
}

interface Report {
  passed: boolean;
  entries?: ServerEntry[];
  reply?: string;
  serverStoppedWithSession?: boolean;
}

/** A stdio MCP server with one tool, named from its environment. It writes its process id at start. */
const ECHO_SERVER = `
const { writeFileSync } = require("node:fs");
writeFileSync(process.env.FAKE_PID_FILE, String(process.pid));
let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  for (let end = buffer.indexOf("\\n"); end >= 0; end = buffer.indexOf("\\n")) {
    const line = buffer.slice(0, end).trim();
    buffer = buffer.slice(end + 1);
    if (!line) continue;
    const message = JSON.parse(line);
    if (message.id === undefined) continue;
    const result =
      message.method === "initialize"
        ? { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "echo", version: "1.0.0" } }
        : message.method === "tools/list"
          ? { tools: [{ name: process.env.FAKE_TOOL_NAME, inputSchema: { type: "object" } }] }
          : {};
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }) + "\\n");
  }
});
`;

const root = await mkdtemp(join(tmpdir(), "openbot-copilot-mcp-relay-e2e-"));
const report: Report = { passed: false };
const clients: AgentClient[] = [];

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

try {
  const executable = join(root, "bin", "copilot");
  const workspace = join(root, "workspace");
  const log = join(root, "agent.jsonl");
  const serverFile = join(root, "echo-server.cjs");
  const pidFile = join(root, "echo-server.pid");
  await mkdir(workspace, { recursive: true });
  await writeFile(serverFile, ECHO_SERVER);
  await installFakeAgent(executable, "copilot-mcp", { FAKE_LOG: log });

  // Stands for Computer Use, which the gateway gives as a stdio server with its own environment.
  const computerUse: McpServerConfig = {
    id: "computer-use",
    name: "computer_use",
    transport: "stdio",
    enabled: true,
    command: process.execPath,
    args: [serverFile],
    env: [
      { key: "FAKE_TOOL_NAME", value: "click" },
      { key: "FAKE_PID_FILE", value: pidFile },
    ],
    envPassthrough: [],
    workingDirectory: "",
    url: "",
    headers: [],
  };
  const client = requireProviderDriver("copilot").createClient(
    { executable, version: "1.0.105", source: "managed" },
    20_000,
    { ...NO_PROVIDER_CREDENTIALS, mcpServers: () => [computerUse] },
    undefined,
  );
  clients.push(client);
  client.start();

  const thread = await startThread(client, { cwd: workspace });
  const turn = await runTurn(client, thread, { text: "Reply with OK only." });
  assert.equal(turn.error, null, "The turn succeeds.");
  report.reply = turn.reply;
  assert.equal(turn.reply, "OK", "The turn answers.");

  // The client also opens a session of its own to list models. It carries no servers.
  const entries = await readJsonl<ServerEntry>(log);
  report.entries = entries;
  const given = entries.filter((entry) => entry.server === "computer_use");
  assert.ok(given.length > 0, "The thread's session carries Computer Use.");
  for (const entry of given) {
    assert.deepEqual(
      [entry.transport, entry.tools],
      ["http", ["click"]],
      `${entry.method}: Computer Use travels as http, and its tools come from the stdio server with its environment.`,
    );
  }

  const pid = Number(await readFile(pidFile, "utf8"));
  assert.ok(alive(pid), "The stdio server runs while the session is open.");
  // A stop waits for the relays, so that an app quit leaves no server running.
  await stopClients(clients);
  clients.length = 0;
  report.serverStoppedWithSession = !alive(pid);
  assert.ok(report.serverStoppedWithSession, "The stdio server ends with the session.");

  report.passed = true;
} finally {
  await stopClients(clients);
  await rm(root, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
