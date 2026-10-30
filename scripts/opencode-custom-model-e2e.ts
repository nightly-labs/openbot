// Runs the real `opencode` provider driver and the real OpenCode binary against a fake
// OpenAI-compatible server with two models, as a llama-swap user has them: the user's own OpenCode
// config names one as `model` and `small_model`, and the agent runs on the other. A local server like llama-swap loads
// the model that each request names, so every request must name the agent's model.
// `OPENCODE_CLI=<opencode> bun run test:opencode-custom-model`.
// Writes .openbot-build/opencode-custom-model/report.json.
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
import { getArray, getString, isRecord } from "../src/backend/protocol";
import { requireProviderDriver } from "../src/backend/provider-drivers";
import { runTurn, startThread, stopClients } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/opencode-custom-model");
const ENDPOINT = "spark";
const DEFAULT_MODEL = "default-model";
const AGENT_MODEL = "agent-model";

interface Request {
  path: string;
  model: string | null;
  stream: boolean;
}

interface Report {
  passed: boolean;
  openCodeVersion?: string;
  models?: string[];
  requests: Request[];
  turns: { reply: string; error: string | null; status: string | null }[];
  error?: string;
}

const report: Report = { passed: false, requests: [], turns: [] };
const root = await mkdtemp(join(tmpdir(), "openbot-opencode-model-e2e-"));
const clients: AgentClient[] = [];
const run = promisify(execFile);

/** The model and the stream flag of one chat request. */
async function readRequest(request: IncomingMessage): Promise<Omit<Request, "path">> {
  const chunks: Buffer[] = [];
  for await (const part of request) chunks.push(Buffer.from(part));
  const text = Buffer.concat(chunks).toString("utf8");
  const value = text ? JSON.parse(text) : null;
  return { model: getString(value, "model"), stream: isRecord(value) && value.stream === true };
}

function chunk(model: string, content: string | null): string {
  const choice = content
    ? { index: 0, delta: { role: "assistant", content }, finish_reason: null }
    : { index: 0, delta: {}, finish_reason: "stop" };
  const value = { id: "chatcmpl-e2e", object: "chat.completion.chunk", created: 0, model, choices: [choice] };
  return `data: ${JSON.stringify(value)}\n\n`;
}

const server = createServer((request: IncomingMessage, response: ServerResponse) => {
  void (async () => {
    const { model, stream } = await readRequest(request);
    report.requests.push({ path: request.url ?? "", model, stream });
    const reply = `reply from ${model}`;
    if (!stream) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          id: "chatcmpl-e2e",
          object: "chat.completion",
          created: 0,
          model,
          choices: [{ index: 0, message: { role: "assistant", content: reply }, finish_reason: "stop" }],
        }),
      );
      return;
    }
    response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    response.write(chunk(model ?? "", reply));
    response.write(chunk(model ?? "", null));
    response.end("data: [DONE]\n\n");
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
  const baseUrl = `http://127.0.0.1:${address.port}/v1`;

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
  // The user's own OpenCode config names a default and a small model of the same server, as a
  // llama-swap user's can. OpenCode asks the small model for a title unless OpenBot turns titles off.
  await mkdir(join(root, "config", "opencode"), { recursive: true });
  await writeFile(
    join(root, "config", "opencode", "opencode.json"),
    `${JSON.stringify(
      {
        $schema: "https://opencode.ai/config.json",
        model: `${ENDPOINT}/${DEFAULT_MODEL}`,
        small_model: `${ENDPOINT}/${DEFAULT_MODEL}`,
      },
      null,
      2,
    )}\n`,
  );
  const workspace = join(root, "workspace");
  await mkdir(workspace, { recursive: true });

  const endpoint: CustomProviderConfig = {
    id: ENDPOINT,
    name: "Spark",
    baseUrl,
    apiKey: null,
    headers: [],
    models: [
      { id: DEFAULT_MODEL, name: "Default model" },
      { id: AGENT_MODEL, name: "Agent model" },
    ],
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

  const listed = await runCauseEffect(client.request("model/list", {}, (value) => value));
  report.models = getArray(listed, "data").flatMap((model) => getString(model, "model") ?? []);
  assert.ok(report.models.includes(`${ENDPOINT}/${AGENT_MODEL}`), "OpenCode must list the agent's model.");

  const thread = await startThread(client, { cwd: workspace, model: `${ENDPOINT}/${AGENT_MODEL}` });
  for (const text of ["Say one word.", "Say another word."]) {
    const turn = await runTurn(client, thread, { text, timeoutMs: 120_000 });
    report.turns.push(turn);
    assert.equal(turn.error, null, `The turn failed: ${turn.error}`);
  }

  assert.ok(report.requests.length > 0, "The endpoint got no request.");
  const others = report.requests.filter((request) => request.model !== null && request.model !== AGENT_MODEL);
  assert.deepEqual(others, [], "Each request must name the agent's model.");
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
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${report.passed ? "passed" : "failed"}: ${join(OUT, "report.json")}\n`);
}
