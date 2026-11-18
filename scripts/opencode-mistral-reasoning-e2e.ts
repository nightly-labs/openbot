// Checks that a DeepSeek model on a custom endpoint on Mistral's API finishes a turn with a tool call
// (#10094). OpenCode 2.2.5 adds an empty `reasoning_content` to each earlier assistant message when
// the model id contains `deepseek`, and Mistral refuses that field with HTTP 422 `extra_forbidden`.
// Builds the OpenCode config layer with `openCodeConfigEnv`, then runs the real OpenCode CLI with that
// layer against a fake strict server on loopback (only the base URL changes). The fake server answers
// the first request with a `bash` tool call, and refuses a request whose assistant message carries
// `reasoning_content`, as Mistral does. It streams the last answer as Mistral does with reasoning on:
// `delta.content` is a list of `thinking` and `text` parts, which the OpenAI-compatible adapter refuses
// as an invalid stream event (#10591).
// Cases: `other-host`, the `provider` entry that every other endpoint keeps, which must get the 422
// (the control); `mistral`, which must finish the turn and keep the key, the header, the saved output
// cap and the saved efforts, use Mistral's own adapter, and show the text of the last answer. A keyless
// endpoint on Mistral's API keeps the OpenAI-compatible adapter, which reads no `MISTRAL_API_KEY`. The
// `mistral` layer also holds a second endpoint and an OpenCode Go key, and OpenCode must list the models of both endpoints. The `mistral` endpoint is in both blocks:
// OpenCode 2 uses its `providers` entry, and OpenCode 1 ignores `providers` and keeps `provider`.
// `bun scripts/opencode-mistral-reasoning-e2e.ts [<opencode binary>]`. Without an argument it uses
// `OPENBOT_OPENCODE_PATH`. Writes .openbot-build/opencode-mistral-reasoning-e2e/report.json.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  CUSTOM_ENDPOINT_SILENCE_MS,
  type CustomProviderConfig,
  openCodeConfigEnv,
} from "../src/backend/opencode-config";
import { getArray, getString, isRecord } from "../src/backend/protocol";

const OUT = resolve(import.meta.dirname, "../.openbot-build/opencode-mistral-reasoning-e2e");
const binaryArgument = process.argv[2] ?? process.env.OPENBOT_OPENCODE_PATH;
if (!binaryArgument) throw new Error("Give the OpenCode binary as the first argument or in OPENBOT_OPENCODE_PATH.");
const binary: string = binaryArgument;

const ENDPOINT = "mistral-direct";
const MODEL = "deepseek-v4-1-flash-1017";
const KEY = "mistral-test-key";
const HEADER = { name: "x-e2e-header", value: "e2e-value" } as const;
const MAX_OUTPUT = 12_345;
const EFFORT = "high";
const OTHER_ENDPOINT = "lab";
const OTHER_MODEL = "lab-model";
const REPLY = "e2e reply";
const root = await mkdtemp(join(tmpdir(), "openbot-opencode-mistral-"));

interface CapturedRequest {
  readonly status: number;
  readonly model: unknown;
  /** Whether the request carried the endpoint key. The report keeps no key. */
  readonly auth: "key" | "other" | "none";
  readonly header: string | null;
  readonly maxCompletionTokens: unknown;
  readonly reasoningEffort: unknown;
  /** The keys of each assistant message that the request sent back. */
  readonly assistantKeys: readonly (readonly string[])[];
  readonly toolResult: boolean;
}
const requests: CapturedRequest[] = [];

function sse(response: ServerResponse, model: unknown, choices: readonly unknown[]): void {
  response.writeHead(200, { "content-type": "text/event-stream" });
  for (const choice of choices)
    response.write(
      `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", created: 0, model, choices: [choice] })}\n\n`,
    );
  response.end("data: [DONE]\n\n");
}

function answer(request: IncomingMessage, response: ServerResponse, text: string): void {
  const body = text ? JSON.parse(text) : null;
  const messages = getArray(body, "messages");
  const assistantKeys = messages
    .filter((message) => getString(message, "role") === "assistant")
    .map((message) => (isRecord(message) ? Object.keys(message) : []));
  const refused = messages.findIndex(
    (message) => getString(message, "role") === "assistant" && isRecord(message) && "reasoning_content" in message,
  );
  const toolResult = messages.some((message) => getString(message, "role") === "tool");
  const header = request.headers[HEADER.name];
  const model = getString(body, "model");
  requests.push({
    status: refused >= 0 ? 422 : 200,
    model,
    auth: request.headers.authorization === `Bearer ${KEY}` ? "key" : request.headers.authorization ? "other" : "none",
    header: typeof header === "string" ? header : null,
    maxCompletionTokens: isRecord(body) ? (body.max_completion_tokens ?? body.max_tokens) : null,
    reasoningEffort: getString(body, "reasoning_effort"),
    assistantKeys,
    toolResult,
  });
  if (refused >= 0) {
    // Mistral's answer, as the issue reports it.
    const loc = ["body", "messages", refused, "assistant", "reasoning_content"];
    response.writeHead(422, { "content-type": "application/json" });
    response.end(
      JSON.stringify({ detail: [{ type: "extra_forbidden", loc, msg: "Extra inputs are not permitted", input: "" }] }),
    );
    return;
  }
  if (!toolResult) {
    const call = {
      index: 0,
      id: "call1",
      type: "function",
      function: { name: "bash", arguments: JSON.stringify({ command: "echo e2e", description: "Print e2e" }) },
    };
    sse(response, model, [
      { index: 0, delta: { role: "assistant", tool_calls: [call] }, finish_reason: null },
      { index: 0, delta: {}, finish_reason: "tool_calls" },
    ]);
    return;
  }
  sse(response, model, [
    {
      index: 0,
      delta: {
        role: "assistant",
        content: [{ type: "thinking", thinking: [{ type: "text", text: "The bash ran." }] }],
      },
      finish_reason: null,
    },
    { index: 0, delta: { content: [{ type: "text", text: REPLY }] }, finish_reason: null },
    { index: 0, delta: {}, finish_reason: "stop" },
  ]);
}

const server = createServer((request, response) => {
  let body = "";
  request.on("data", (chunk) => {
    body += chunk;
  });
  request.on("end", () => answer(request, response, body));
});
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
const address = server.address();
assert.ok(address && typeof address === "object", "the fake server has no port");
const local = `http://127.0.0.1:${address.port}/v1`;

function endpoint(baseUrl: string): CustomProviderConfig {
  return {
    id: ENDPOINT,
    name: "Mistral direct",
    baseUrl,
    apiKey: KEY,
    headers: [HEADER],
    models: [
      {
        id: MODEL,
        name: "DeepSeek V4.1 Flash",
        contextWindow: 131_072,
        maxOutput: MAX_OUTPUT,
        reasoningEfforts: ["low", EFFORT],
        inputs: ["image"],
      },
    ],
  };
}

const other: CustomProviderConfig = {
  id: OTHER_ENDPOINT,
  name: "Lab",
  baseUrl: "https://llm.example.com/v1",
  apiKey: null,
  headers: [],
  models: [{ id: OTHER_MODEL, name: "Lab model" }],
};

/** The layer OpenBot sends, with only the endpoint's base URL moved to the fake server. */
function configFor(providers: readonly CustomProviderConfig[]): {
  readonly format: "provider" | "providers";
  /** The endpoint's entry as OpenBot wrote it, with the test key replaced, for the report. */
  readonly entry: unknown;
  /** The settings that OpenBot wrote: `settings` in `providers`, `options` in `provider`. */
  readonly settings: { readonly baseURL: unknown; readonly headerTimeout: unknown; readonly chunkTimeout: unknown };
  readonly content: string;
} {
  const content = openCodeConfigEnv({}, () => providers, "opencode-go-test-key").OPENCODE_CONFIG_CONTENT;
  assert.ok(content, "no OpenCode config layer");
  const config = JSON.parse(content);
  const format = config.providers?.[ENDPOINT] ? "providers" : "provider";
  assert.ok(config[format]?.[ENDPOINT], `the layer has no ${ENDPOINT} entry`);
  const entry = JSON.parse(
    JSON.stringify(config[format][ENDPOINT], (key, value) => (key === "apiKey" ? "[redacted]" : value)),
  );
  const written = format === "providers" ? config.providers[ENDPOINT].settings : config.provider[ENDPOINT].options;
  const settings = {
    baseURL: written.baseURL,
    headerTimeout: written.headerTimeout,
    chunkTimeout: written.chunkTimeout,
  };
  written.baseURL = local;
  // The `provider` entry that stays beside a `providers` entry, for OpenCode 1, moves too.
  config.provider[ENDPOINT].options.baseURL = local;
  return { format, entry, settings, content: JSON.stringify(config) };
}

async function runOpenCode(
  content: string,
  name: string,
  args: readonly string[],
): Promise<{ readonly code: number | null; readonly stdout: string; readonly stderr: string }> {
  const home = join(root, name);
  mkdirSync(home, { recursive: true });
  const child = spawn(binary, args, {
    cwd: home,
    env: {
      PATH: process.env.PATH,
      HOME: home,
      XDG_CONFIG_HOME: join(home, ".config"),
      XDG_DATA_HOME: join(home, ".local/share"),
      XDG_CACHE_HOME: join(home, ".cache"),
      XDG_STATE_HOME: join(home, ".local/state"),
      OPENCODE_CONFIG_CONTENT: content,
      OPENCODE_DISABLE_AUTOUPDATE: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
    // A turn against the loopback server takes seconds. A hang must end in a failed case and a report.
    timeout: 180_000,
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const code = await new Promise<number | null>((done) => child.on("close", done));
  return { code, stdout, stderr: stderr.slice(-2000) };
}

/** One turn on the endpoint's model at the saved effort, on a private OpenCode server. */
function runTurn(content: string, name: string) {
  return runOpenCode(content, name, [
    "run",
    "--standalone",
    "--auto",
    "--format",
    "json",
    "--model",
    `${ENDPOINT}/${MODEL}#${EFFORT}`,
    "Run echo e2e.",
  ]);
}

interface CaseReport {
  readonly name: string;
  readonly format: string;
  readonly entry: unknown;
  readonly requests: readonly CapturedRequest[];
  readonly exitCode: number | null;
  readonly models?: readonly string[];
}
const cases: CaseReport[] = [];
const report: { binary: string; model: string; cases: CaseReport[]; result?: "pass" | "fail"; error?: string } = {
  binary,
  model: MODEL,
  cases,
};
try {
  // The control: the `provider` entry, which every host other than Mistral's keeps.
  const control = configFor([endpoint("https://llm.example.com/v1")]);
  assert.equal(control.format, "provider", "other-host: format");
  let before = requests.length;
  const controlRun = await runTurn(control.content, "other-host");
  const controlSent = requests.slice(before);
  cases.push({
    name: "other-host",
    format: control.format,
    entry: control.entry,
    requests: controlSent,
    exitCode: controlRun.code,
  });
  assert.ok(
    controlSent.some((request) => request.status === 422 && request.assistantKeys.flat().includes("reasoning_content")),
    `other-host: the strict server did not refuse reasoning_content (exit ${controlRun.code}): ${controlRun.stderr}`,
  );

  const mistral = configFor([endpoint("https://api.mistral.ai/v1"), other]);
  assert.equal(mistral.format, "providers", "mistral: format");
  assert.equal(mistral.settings.baseURL, "https://api.mistral.ai/v1", "mistral: base URL");
  assert.equal(mistral.settings.headerTimeout, CUSTOM_ENDPOINT_SILENCE_MS, "mistral: header timeout");
  assert.equal(mistral.settings.chunkTimeout, CUSTOM_ENDPOINT_SILENCE_MS, "mistral: chunk timeout");
  const layer = JSON.parse(mistral.content);
  assert.ok(layer.provider?.[ENDPOINT], "mistral: the endpoint must keep its `provider` entry for OpenCode 1");
  assert.ok(layer.provider?.[OTHER_ENDPOINT], "mistral: the other endpoint must keep its `provider` entry");
  assert.equal(layer.providers[ENDPOINT].package, "aisdk:@ai-sdk/mistral", "mistral: package");
  const keyless = openCodeConfigEnv({}, () => [{ ...endpoint("https://api.mistral.ai/v1"), apiKey: null }], null);
  assert.equal(
    JSON.parse(keyless.OPENCODE_CONFIG_CONTENT ?? "{}").providers?.[ENDPOINT]?.package,
    "aisdk:@ai-sdk/openai-compatible",
    "keyless mistral: package",
  );
  before = requests.length;
  const turn = await runTurn(mistral.content, "mistral");
  const sent = requests.slice(before);
  const listed = await runOpenCode(mistral.content, "mistral", ["models", "--standalone"]);
  const models = listed.stdout
    .split("\n")
    .filter((line) => line.startsWith(`${ENDPOINT}/`) || line.startsWith(`${OTHER_ENDPOINT}/`));
  cases.push({
    name: "mistral",
    format: mistral.format,
    entry: mistral.entry,
    requests: sent,
    exitCode: turn.code,
    models,
  });
  assert.equal(turn.code, 0, `mistral: OpenCode exit ${turn.code}: ${turn.stderr}`);
  const events = turn.stdout
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line): unknown => JSON.parse(line));
  const errors = events.filter((event) => getString(event, "type") === "error");
  assert.deepEqual(errors, [], "mistral: OpenCode reported an error");
  const texts = events.filter((event) => getString(event, "type") === "text");
  assert.ok(
    texts.some((event) => isRecord(event) && getString(event.part, "text") === REPLY),
    "mistral: the text of the last answer did not show",
  );
  assert.ok(
    sent.some((request) => request.toolResult && request.status === 200),
    "mistral: the request after the tool call was not answered",
  );
  for (const request of sent) {
    assert.equal(request.status, 200, "mistral: a request was refused");
    assert.ok(!request.assistantKeys.flat().includes("reasoning_content"), "mistral: sent reasoning_content");
    assert.equal(request.model, MODEL, "mistral: model");
    assert.equal(request.auth, "key", "mistral: key");
    assert.equal(request.header, HEADER.value, "mistral: header");
    assert.equal(request.maxCompletionTokens, MAX_OUTPUT, "mistral: saved output cap");
    assert.equal(request.reasoningEffort, EFFORT, "mistral: saved effort");
  }
  assert.ok(models.includes(`${ENDPOINT}/${MODEL}`), `mistral: OpenCode did not list ${MODEL}: ${listed.stderr}`);
  assert.ok(models.includes(`${OTHER_ENDPOINT}/${OTHER_MODEL}`), `mistral: OpenCode did not list ${OTHER_MODEL}`);
  report.result = "pass";
} catch (error) {
  report.result = "fail";
  report.error = error instanceof Error ? error.message : String(error);
  throw error;
} finally {
  server.close();
  await rm(root, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
}
process.stdout.write(`PASS opencode-mistral-reasoning-e2e: ${join(OUT, "report.json")}\n`);
