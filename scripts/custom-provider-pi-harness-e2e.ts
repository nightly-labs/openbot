// Runs the real `pi` provider driver and the real Pi binary against a fake OpenAI-compatible server,
// to check that a custom endpoint saved with "Runs on: Pi" runs through Pi, and that an endpoint that
// runs on OpenCode stays out of Pi. Pi reads `$` and a leading `!` in a key or a header as an
// environment reference or a shell command, so the key and the header must arrive literally. The
// key and the header value must not reach the extension file or an error message.
// `PI_CLI=<pi> bun run test:custom-provider-pi`. Writes .openbot-build/custom-provider-pi-harness/report.json.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentClient } from "../src/backend/agent-client";
import { resolvePiCli } from "../src/backend/cli";
import { runCauseEffect } from "../src/backend/effect-boundary";
import {
  type CustomProviderConfig,
  customProvidersOn,
  OPENCODE_PROFILE_CONFIG,
  openCodeConfigEnv,
} from "../src/backend/opencode-config";
import { getArray, getRecord, getString } from "../src/backend/protocol";
import { requireProviderDriver } from "../src/backend/provider-drivers";
import { runTurn, startThread, stopClients } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/custom-provider-pi-harness");
const REPLY = "pong from the fake endpoint";
const KEY = "!sk-e2e-$HOME-literal";
const HEADER_VALUE = "team-$PATH";
const FAILING_MODEL = "fake-broken";

interface Request {
  path: string;
  authorization: string | null;
  header: string | null;
  model: string | null;
}

interface Report {
  passed: boolean;
  piVersion?: string;
  models?: string[];
  requests: Request[];
  reply?: string;
  status?: string | null;
  failure?: { error: string | null; status: string | null; messages: string[] };
  extensionFiles?: string[];
  openCodeEndpoints?: string[];
  error?: string;
}

const report: Report = { passed: false, requests: [] };
const root = await mkdtemp(join(tmpdir(), "openbot-custom-pi-e2e-"));
const clients: AgentClient[] = [];

function header(request: IncomingMessage, name: string): string | null {
  const value = request.headers[name];
  return typeof value === "string" ? value : null;
}

/** The model that a chat completion request names. */
async function requestedModel(request: IncomingMessage): Promise<string | null> {
  const chunks: Buffer[] = [];
  for await (const part of request) chunks.push(Buffer.from(part));
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? getString(JSON.parse(text), "model") : null;
}

/** One server-sent event of a streamed chat completion: the reply text, or the end of the reply. */
function chunk(model: string, content: string | null): string {
  const choice = content
    ? { index: 0, delta: { role: "assistant", content }, finish_reason: null }
    : { index: 0, delta: {}, finish_reason: "stop" };
  const value = { id: "chatcmpl-e2e", object: "chat.completion.chunk", created: 0, model, choices: [choice] };
  return `data: ${JSON.stringify(value)}\n\n`;
}

const server = createServer((request: IncomingMessage, response: ServerResponse) => {
  void (async () => {
    const model = await requestedModel(request);
    const authorization = header(request, "authorization");
    report.requests.push({ path: request.url ?? "", authorization, header: header(request, "x-e2e"), model });
    if (model === FAILING_MODEL) {
      // A server that names the key it refused. Pi passes the body on, so OpenBot must redact it.
      response.writeHead(401, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: `Key refused: ${authorization}`, type: "invalid_key" } }));
      return;
    }
    response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    response.write(chunk(model ?? "", REPLY));
    response.write(chunk(model ?? "", null));
    response.end("data: [DONE]\n\n");
  })().catch((error: unknown) => {
    response.writeHead(500);
    response.end(String(error));
  });
});

/** The text of every file in the extension folders that Pi got. */
async function extensionFiles(directory: string): Promise<{ names: string[]; text: string }> {
  const names: string[] = [];
  let text = "";
  for (const folder of await readdir(directory).catch(() => [])) {
    if (!folder.startsWith("openbot-pi-")) continue;
    for (const name of await readdir(join(directory, folder))) {
      names.push(`${folder}/${name}`);
      text += await readFile(join(directory, folder, name), "utf8");
    }
  }
  return { names, text };
}

try {
  await new Promise<void>((listening) => server.listen(0, "127.0.0.1", listening));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("The fake endpoint has no port.");
  const baseUrl = `http://127.0.0.1:${address.port}/v1`;

  // Pi must not read the developer's own providers and keys.
  const agentDirectory = join(root, "agent");
  await mkdir(agentDirectory, { recursive: true });
  await writeFile(join(agentDirectory, "settings.json"), "{}\n");
  await writeFile(join(agentDirectory, "auth.json"), "{}");
  process.env.PI_CODING_AGENT_DIR = agentDirectory;
  const stateDirectory = join(root, "state");
  const workspace = join(root, "workspace");
  await mkdir(workspace, { recursive: true });

  const onPi: CustomProviderConfig = {
    id: "spark-e2e",
    name: "Spark E2E",
    baseUrl,
    apiKey: KEY,
    headers: [{ name: "X-E2E", value: HEADER_VALUE }],
    models: [
      { id: "fake-coder", name: "Fake coder", contextWindow: 32_768 },
      { id: FAILING_MODEL, name: "Fake broken" },
    ],
    harness: "pi",
  };
  const onOpenCode: CustomProviderConfig = {
    id: "oc-only",
    name: "OpenCode only",
    baseUrl,
    apiKey: null,
    headers: [],
    models: [{ id: "oc-model", name: "OpenCode model" }],
    harness: "opencode",
  };
  const source = () => [onPi, onOpenCode];

  // OpenCode gets only its own endpoint.
  const layer = openCodeConfigEnv(OPENCODE_PROFILE_CONFIG, customProvidersOn(source, "opencode"), null);
  report.openCodeEndpoints = Object.keys(
    getRecord(JSON.parse(layer.OPENCODE_CONFIG_CONTENT ?? "{}"), "provider") ?? {},
  );
  assert.ok(report.openCodeEndpoints.includes("oc-only"), "OpenCode must get its endpoint.");
  assert.ok(!report.openCodeEndpoints.includes("spark-e2e"), "OpenCode must not get the endpoint that runs on Pi.");

  const cli = await runCauseEffect(resolvePiCli({ bundledExecutable: process.env.PI_CLI }));
  report.piVersion = cli.version;
  const client = requireProviderDriver("pi").createClient(cli, 60_000, {
    apiKey: () => null,
    customProviders: source,
    mcpServers: () => [],
    providerStateDirectory: stateDirectory,
  });
  clients.push(client);
  const messages: string[] = [];
  client.on("diagnostic", (text: string) => messages.push(text));
  client.on("notification", (notification) => messages.push(JSON.stringify(notification.params)));
  client.start();

  const listed = await runCauseEffect(client.request("model/list", {}, (value) => value));
  report.models = getArray(listed, "data").flatMap((model) => getString(model, "model") ?? []);
  assert.ok(report.models.includes("spark-e2e/fake-coder"), "Pi must list the endpoint's model.");
  assert.ok(!report.models.some((model) => model.startsWith("oc-only/")), "Pi must not list the OpenCode endpoint.");

  const thread = await startThread(client, { cwd: workspace, model: "spark-e2e/fake-coder" });
  const files = await extensionFiles(stateDirectory);
  report.extensionFiles = files.names;
  assert.ok(
    files.names.some((name) => name.endsWith("custom-endpoints.mjs")),
    "Pi must get the extension.",
  );
  assert.ok(!files.text.includes("sk-e2e"), "The extension file must not hold the key.");
  assert.ok(!files.text.includes(HEADER_VALUE), "The extension file must not hold the header value.");

  const turn = await runTurn(client, thread, { text: "Say pong.", timeoutMs: 60_000 });
  report.reply = turn.reply;
  report.status = turn.status;
  assert.equal(turn.error, null, `The turn failed: ${turn.error}`);
  assert.match(turn.reply, new RegExp(REPLY, "u"));
  const sent = report.requests.find((request) => request.model === "fake-coder");
  assert.ok(sent, "The endpoint got no request for fake-coder.");
  assert.equal(sent.path, "/v1/chat/completions");
  assert.equal(sent.authorization, `Bearer ${KEY}`, "Pi must send the key literally.");
  assert.equal(sent.header, HEADER_VALUE, "Pi must send the header literally.");

  // A refused request: the error reaches the user, but not the key.
  const failure = await runTurn(client, thread, {
    model: `spark-e2e/${FAILING_MODEL}`,
    text: "Fail.",
    timeoutMs: 60_000,
  });
  const refused = messages.filter((message) => message.includes("Key refused"));
  report.failure = { error: failure.error, status: failure.status, messages: refused };
  assert.ok(refused.length > 0, "The refusal must reach OpenBot.");
  assert.ok(
    report.requests.some((request) => request.model === FAILING_MODEL),
    "The endpoint got no request for the failing model.",
  );
  assert.ok(failure.error, "A refused key must fail the turn.");
  for (const message of messages) {
    assert.ok(!message.includes("sk-e2e"), `A message holds the key: ${message}`);
    assert.ok(!message.includes(HEADER_VALUE), `A message holds the header value: ${message}`);
  }

  await stopClients(clients);
  assert.deepEqual((await extensionFiles(stateDirectory)).names, [], "The client must remove the extension.");
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  await stopClients(clients);
  server.close();
  await rm(root, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  // The report holds the fake key and the fake header only; neither is a real secret.
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${report.passed ? "passed" : "failed"}: ${join(OUT, "report.json")}\n`);
}
