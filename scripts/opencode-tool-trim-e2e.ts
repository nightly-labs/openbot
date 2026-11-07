// Runs the real `opencode` provider driver and the real OpenCode binary against a fake
// OpenAI-compatible server, to check the Code Mode catalog that each request carries. OpenBot denies
// OpenCode's `session_*` and `worktree_*` tools: OpenBot names its own chats, and `session_move` would
// move the session out of the agent's workspace. `worktree_remove` stays, because OpenCode checks it
// with the `edit` permission. The user's own config denies `opencode_models`, so the catalog also
// shows that OpenCode keeps the user's rules beside OpenBot's.
// `OPENCODE_CLI=<opencode> bun scripts/opencode-tool-trim-e2e.ts`.
// Writes .openbot-build/opencode-tool-trim-e2e/report.json.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createServer as createTcpServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type { AgentClient } from "../src/backend/agent-client";
import { resolveOpencodeCli } from "../src/backend/cli";
import { runCauseEffect } from "../src/backend/effect-boundary";
import type { CustomProviderConfig } from "../src/backend/opencode-config";
import { getArray, getString } from "../src/backend/protocol";
import { requireProviderDriver } from "../src/backend/provider-drivers";
import { runTurn, startThread, stopClients } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/opencode-tool-trim-e2e");
const NL = String.fromCharCode(10);
const ENDPOINT = "spark";
const MODEL = "agent-model";
const DENIED = ["session_move", "session_rename", "worktree_create", "worktree_list"];
const KEPT = ["list_mcp_resources", "read_mcp_resource", "worktree_remove"];
/** Denied by the user's own config. */
const USER_DENIED = "models";

interface Request {
  bytes: number;
  /** The names after `tools.opencode.` in the system prompt. */
  catalog: string[];
}

interface Report {
  passed: boolean;
  openCodeVersion?: string;
  requests: Request[];
  turn?: { error: string | null; status: string | null };
  error?: string;
}

const report: Report = { passed: false, requests: [] };
const root = await mkdtemp(join(tmpdir(), "openbot-opencode-trim-e2e-"));
const clients: AgentClient[] = [];
const run = promisify(execFile);

async function readRequest(request: IncomingMessage): Promise<{ text: string; value: unknown }> {
  const chunks: Buffer[] = [];
  for await (const part of request) chunks.push(Buffer.from(part));
  const text = Buffer.concat(chunks).toString("utf8");
  return { text, value: text ? JSON.parse(text) : null };
}

function chunk(content: string | null): string {
  const choice = content
    ? { index: 0, delta: { role: "assistant", content }, finish_reason: null }
    : { index: 0, delta: {}, finish_reason: "stop" };
  const value = { id: "chatcmpl-e2e", object: "chat.completion.chunk", created: 0, model: MODEL, choices: [choice] };
  return `data: ${JSON.stringify(value)}${NL}${NL}`;
}

const server = createServer((request: IncomingMessage, response: ServerResponse) => {
  void (async () => {
    const { text, value } = await readRequest(request);
    const system = getArray(value, "messages")
      .filter((message) => getString(message, "role") === "system")
      .map((message) => JSON.stringify(message))
      .join(NL);
    const catalog = [...new Set([...system.matchAll(/tools\.opencode\.([a-z_]+)\(/gu)].map((match) => match[1] ?? ""))];
    if (getArray(value, "tools").length > 0) report.requests.push({ bytes: text.length, catalog: catalog.sort() });
    response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    response.write(chunk("done"));
    response.write(chunk(null));
    response.end(`data: [DONE]${NL}${NL}`);
  })().catch((error: unknown) => {
    response.writeHead(500);
    response.end(String(error));
  });
});

/** A free TCP port for OpenCode's managed service, so the test does not meet a running OpenBot's. */
async function freePort(): Promise<number> {
  const probe = createTcpServer();
  await new Promise<void>((listening) => probe.listen(0, "127.0.0.1", listening));
  const address = probe.address();
  await new Promise<void>((closed) => probe.close(() => closed()));
  if (!address || typeof address === "string") throw new Error("The port probe has no port.");
  return address.port;
}

let cliPath: string | null = null;
try {
  await new Promise<void>((listening) => server.listen(0, "127.0.0.1", listening));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("The fake endpoint has no port.");

  // OpenCode must not read the developer's own config, keys or sessions.
  for (const [name, folder] of [
    ["HOME", "home"],
    ["XDG_CONFIG_HOME", "config"],
    ["XDG_DATA_HOME", "data"],
    ["XDG_STATE_HOME", "state"],
    ["XDG_CACHE_HOME", "cache"],
  ] as const) {
    process.env[name] = join(root, folder);
    await mkdir(join(root, folder), { recursive: true });
  }
  await mkdir(join(root, "config", "opencode"), { recursive: true });
  await writeFile(
    join(root, "config", "opencode", "opencode.json"),
    `${JSON.stringify({ $schema: "https://opencode.ai/config.json", permission: { [`opencode_${USER_DENIED}`]: "deny" } })}${NL}`,
  );
  const workspace = join(root, "workspace");
  await mkdir(workspace, { recursive: true });

  const endpoint: CustomProviderConfig = {
    id: ENDPOINT,
    name: "Spark",
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    apiKey: null,
    headers: [],
    models: [{ id: MODEL, name: "Agent model" }],
  };

  const cli = await runCauseEffect(resolveOpencodeCli({ bundledExecutable: process.env.OPENCODE_CLI }));
  report.openCodeVersion = cli.version;
  cliPath = cli.executable;
  await run(cli.executable, ["service", "set", "port", String(await freePort())], { env: process.env });

  const client = requireProviderDriver("opencode").createClient(cli, 60_000, {
    apiKey: () => null,
    customProviders: () => [endpoint],
    mcpServers: () => [],
    providerStateDirectory: join(root, "provider-state"),
  });
  clients.push(client);
  client.start();

  const thread = await startThread(client, { cwd: workspace, model: `${ENDPOINT}/${MODEL}` });
  const turn = await runTurn(client, thread, { text: "Say one word.", timeoutMs: 120_000 });
  report.turn = { error: turn.error, status: turn.status };
  assert.equal(turn.error, null, `The turn failed: ${turn.error}`);

  assert.ok(report.requests.length > 0, "OpenCode sent no request with tools.");
  for (const { catalog } of report.requests) {
    for (const name of DENIED) assert.ok(!catalog.includes(name), `The catalog lists ${name}: ${catalog.join(", ")}`);
    for (const name of KEPT)
      assert.ok(catalog.includes(name), `The catalog does not list ${name}: ${catalog.join(", ")}`);
    assert.ok(!catalog.includes(USER_DENIED), `OpenCode dropped the user's rule: ${catalog.join(", ")}`);
  }
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  await stopClients(clients);
  if (cliPath) await run(cliPath, ["service", "stop"], { env: process.env }).catch(() => undefined);
  server.close();
  await rm(root, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}${NL}`);
  process.stdout.write(`${report.passed ? "passed" : "failed"}: ${join(OUT, "report.json")}${NL}`);
}
