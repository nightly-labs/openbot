import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { sourceText } from "@openbot/i18n/source";
import { MCP_PROVIDER_FAILURE_TEXT, mcpProviderFailureKind } from "../src/backend/agent/provider-diagnostics";
import type { AgentClient } from "../src/backend/agent-client";
import { resolveCodexCli } from "../src/backend/cli";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { getString } from "../src/backend/protocol";
import { NO_PROVIDER_CREDENTIALS, requireProviderDriver } from "../src/backend/provider-drivers";
import { startThread, stopClients } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/codex-mcp-unavailable-e2e");
const NL = String.fromCharCode(10);
const STATUS_TIMEOUT_MS = 90_000;

interface CaseReport {
  name: string;
  error: string | null;
  kind?: string;
  text?: string;
}

interface Report {
  passed: boolean;
  codexVersion?: string;
  mcpRequests: number;
  cases: CaseReport[];
  error?: string;
}

const report: Report = { passed: false, mcpRequests: 0, cases: [] };
const root = await realpath(await mkdtemp(join(tmpdir(), "openbot-codex-mcp-unavailable-e2e-")));
const clients: AgentClient[] = [];
const saved = { ...process.env };

const unavailable = createServer((request: IncomingMessage, response: ServerResponse) => {
  request.resume();
  report.mcpRequests += 1;
  response.writeHead(503, { "content-type": "text/plain" });
  response.end("Service Unavailable");
});
const closed = createServer();

function httpServer(name: string, port: number): string {
  return `[mcp_servers.${name}]${NL}url = "http://127.0.0.1:${port}/mcp"${NL}startup_timeout_sec = 20${NL}`;
}

function portOf(server: ReturnType<typeof createServer>): number {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("The server has no port.");
  return address.port;
}

try {
  await new Promise<void>((listening) => unavailable.listen(0, "127.0.0.1", listening));
  await new Promise<void>((listening) => closed.listen(0, "127.0.0.1", listening));
  const refusedPort = portOf(closed);
  await new Promise<void>((done) => closed.close(() => done()));
  const servers = ["statuspage", "offline"];

  const workspace = join(root, "workspace");
  await mkdir(workspace, { recursive: true });
  Object.assign(process.env, { HOME: root, CODEX_HOME: join(root, ".codex") });
  await mkdir(join(root, ".codex"), { recursive: true });
  await writeFile(
    join(root, ".codex", "config.toml"),
    [httpServer("statuspage", portOf(unavailable)), httpServer("offline", refusedPort)].join(NL),
  );

  const cli = await runCauseEffect(resolveCodexCli({ bundledExecutable: process.env.CODEX_CLI ?? null }));
  report.codexVersion = cli.version;
  const client = requireProviderDriver("codex").createClient(cli, 60_000, NO_PROVIDER_CREDENTIALS);
  clients.push(client);
  const failures = new Map<string, string | null>();
  let reported: () => void = () => undefined;
  const allReported = new Promise<void>((done) => {
    reported = done;
  });
  client.on("notification", (notification: { method: string; params?: unknown }) => {
    if (notification.method !== "mcpServer/startupStatus/updated") return;
    const name = getString(notification.params, "name");
    if (getString(notification.params, "status") !== "failed" || !name) return;
    failures.set(name, getString(notification.params, "error") ?? null);
    if (failures.size >= servers.length) reported();
  });
  client.start();
  await runCauseEffect(
    client.request(
      "initialize",
      {
        clientInfo: { name: "openbot_e2e", title: "OpenBot E2E", version: "0.0.0" },
        capabilities: { experimentalApi: true },
      },
      (value) => value,
    ),
  );
  client.notify("initialized");
  await startThread(client, { cwd: workspace });
  await Promise.race([
    allReported,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Codex did not report both MCP servers as failed.")), STATUS_TIMEOUT_MS),
    ),
  ]);

  for (const [name, error] of failures) {
    const kind = mcpProviderFailureKind(error ?? "");
    report.cases.push({
      name,
      error,
      kind,
      text: sourceText(MCP_PROVIDER_FAILURE_TEXT[kind], { provider: "Codex", name }),
    });
  }
  assert.ok(report.mcpRequests > 0, "Codex connects to the MCP server that answers 503.");
  assert.deepEqual(
    report.cases.map((entry) => entry.kind),
    report.cases.map(() => "unavailable"),
    "A 503 answer and a refused connection read as a server that is not available now.",
  );
  assert.ok(
    report.cases.every(
      (entry) =>
        entry.text ===
        sourceText("error.backend.mcpServerUnavailableInProvider", { provider: "Codex", name: entry.name }),
    ),
    "Each failure gets the plain unavailable text.",
  );
  assert.deepEqual(
    ["Error: HTTP 401", "MCP client for `x` timed out after 30 seconds", "No such file or directory (os error 2)"].map(
      mcpProviderFailureKind,
    ),
    ["sign_in", "timeout", "failed"],
    "Sign-in, timeout and other failures keep their kinds.",
  );
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  await stopClients(clients);
  process.env = saved;
  unavailable.close();
  await rm(root, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}${NL}`);
  process.stdout.write(`${report.passed ? "passed" : "failed"}: ${join(OUT, "report.json")}${NL}`);
}
