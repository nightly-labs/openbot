// Runs the real `grok` provider driver and the real Grok binary with one http MCP server that asks
// for a sign-in: it answers 401 with an OAuth challenge. Grok reports the failed start twice, as an
// `x.ai/mcp/server_status` handshake failure and as an `rmcp` line on stderr. The user got two toasts:
// one with the raw `rmcp` transport text, one that told them to sign in. Both reports must now carry
// the same sign-in sentence, so the renderer shows one toast, and no report carries the `rmcp` text.
// Grok runs with a temporary `GROK_HOME` and a fake key, so no account, quota or user setting is used.
// `bun run test:grok-mcp-sign-in`. Writes .openbot-build/grok-mcp-sign-in-e2e/report.json.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { McpServerConfig } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { mcpProviderFailureKind } from "../src/backend/agent/provider-diagnostics";
import type { AgentClient } from "../src/backend/agent-client";
import { resolveGrokCli } from "../src/backend/cli";
import { runCauseEffect } from "../src/backend/effect-boundary";
import type { McpServerDrop } from "../src/backend/mcp-provider-shapes";
import { requireProviderDriver } from "../src/backend/provider-drivers";
import { startThread, stopClients } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/grok-mcp-sign-in-e2e");
const NL = String.fromCharCode(10);
const NAME = "metricool";
/** Grok gives a server 30 s to start, and a 401 ends the start at once. */
const STATUS_TIMEOUT_MS = 60_000;

interface Report {
  passed: boolean;
  grokVersion?: string;
  drops: McpServerDrop[];
  /** The MCP lines that the client sent as diagnostics. */
  diagnostics: string[];
  mcpRequests: number;
  error?: string;
}

const report: Report = { passed: false, drops: [], diagnostics: [], mcpRequests: 0 };
const root = await realpath(await mkdtemp(join(tmpdir(), "openbot-grok-mcp-sign-in-e2e-")));
const clients: AgentClient[] = [];
const saved = { ...process.env };

/**
 * Answers `/mcp` as an MCP server that needs an OAuth sign-in, as Metricool does. Other paths stand
 * for the xAI endpoint, which no turn reaches.
 */
const mcp = createServer((request: IncomingMessage, response: ServerResponse) => {
  request.resume();
  if (!request.url?.startsWith("/mcp")) {
    response.writeHead(404, { "content-type": "application/json" });
    response.end("{}");
    return;
  }
  report.mcpRequests += 1;
  const address = mcp.address();
  const port = address && typeof address !== "string" ? address.port : 0;
  response.writeHead(401, {
    "content-type": "application/json",
    "www-authenticate": `Bearer resource_metadata="http://127.0.0.1:${port}/.well-known/oauth-protected-resource/mcp"`,
  });
  response.end(JSON.stringify({ error: "invalid_token" }));
});

try {
  await new Promise<void>((listening) => mcp.listen(0, "127.0.0.1", listening));
  const address = mcp.address();
  if (!address || typeof address === "string") throw new Error("The MCP server has no port.");
  const workspace = join(root, "workspace");
  await mkdir(workspace, { recursive: true });
  // Grok must not read the developer's own sign-in, MCP servers, skills and memory.
  Object.assign(process.env, {
    HOME: root,
    GROK_HOME: join(root, ".grok"),
    XAI_API_KEY: "xai-e2e",
    GROK_CODE_XAI_API_KEY: "xai-e2e",
    GROK_XAI_API_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
    GROK_CLI_CHAT_PROXY_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
  });

  const server: McpServerConfig = {
    id: "metricool",
    name: NAME,
    transport: "http",
    enabled: true,
    command: "",
    args: [],
    env: [],
    envPassthrough: [],
    workingDirectory: "",
    url: `http://127.0.0.1:${address.port}/mcp`,
    headers: [],
  };
  let dropped: () => void = () => undefined;
  const firstDrop = new Promise<void>((done) => {
    dropped = done;
  });
  let diagnosed: () => void = () => undefined;
  const firstDiagnostic = new Promise<void>((done) => {
    diagnosed = done;
  });
  const cli = await runCauseEffect(resolveGrokCli({ bundledExecutable: process.env.GROK_CLI ?? null }));
  report.grokVersion = cli.version;
  const client = requireProviderDriver("grok").createClient(cli, 60_000, {
    apiKey: () => null,
    customProviders: () => [],
    mcpServers: () => [server],
    reportMcpDrops: (_provider, drops) => {
      report.drops.push(...drops);
      // Each spawn reports its hand-off, also when nothing was dropped.
      if (drops.length > 0) dropped();
    },
  });
  clients.push(client);
  client.on("diagnostic", (line: string) => {
    if (!/\b(mcp|rmcp)\b|AuthRequired/i.test(line)) return;
    report.diagnostics.push(line);
    diagnosed();
  });
  client.start();
  await startThread(client, { cwd: workspace });
  await Promise.race([
    Promise.all([firstDrop, firstDiagnostic]),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("Grok did not report the failed MCP server on both paths.")),
        STATUS_TIMEOUT_MS,
      ),
    ),
  ]);

  assert.ok(report.mcpRequests > 0, "Grok connects to the MCP server.");
  const expected = sourceText("error.backend.mcpServerSignInForProvider", { provider: "Grok", name: NAME });
  assert.deepEqual(
    report.drops.map((drop) => [drop.name, drop.reason, drop.detail]),
    [[NAME, "failed_in_provider", expected]],
    "The handshake failure is reported once, by the saved name, as a sign-in.",
  );
  assert.ok(
    report.drops.every((drop) => !/rmcp|Transport/u.test(drop.detail)),
    "No report carries the rmcp text.",
  );
  // The provider runtime reads these stderr lines and shows the sentence of their kind. The same
  // kind gives the same text as the drop, so the renderer shows one toast.
  assert.deepEqual(
    [...new Set(report.diagnostics.map(mcpProviderFailureKind))],
    ["sign_in"],
    "The stderr lines of the failure read as a sign-in too.",
  );
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  await stopClients(clients);
  process.env = saved;
  mcp.close();
  await rm(root, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}${NL}`);
  process.stdout.write(`${report.passed ? "passed" : "failed"}: ${join(OUT, "report.json")}${NL}`);
}
