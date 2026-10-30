// Checks that a custom provider on an Azure OpenAI or Foundry v1 endpoint calls the Responses API
// (#3460). Builds the OpenCode config layer with `openCodeConfigEnv` for each endpoint, then runs the
// real OpenCode CLI with that layer against a fake Azure server on loopback (only the base URL
// changes), and reads the requests that OpenCode sends. `--standalone` (OpenCode 2) keeps each run
// off the shared background service. Cases: Azure OpenAI and Foundry hosts, which must use the OpenAI
// adapter and reach `/openai/v1/responses` with the endpoint key and `store: false`; an Azure host
// with no key and another host, which keep the OpenAI-compatible adapter and `/chat/completions`.
// No request may carry the `OPENAI_API_KEY` of the OpenCode environment.
// `bun scripts/opencode-azure-responses-e2e.ts [<opencode binary>]`. Without an argument it uses
// `OPENBOT_OPENCODE_PATH`. Writes .openbot-build/opencode-azure-responses-e2e/report.json.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { openCodeConfigEnv } from "../src/backend/opencode-config";

const OUT = resolve(import.meta.dirname, "../.openbot-build/opencode-azure-responses-e2e");
const binaryArgument = process.argv[2] ?? process.env.OPENBOT_OPENCODE_PATH;
if (!binaryArgument) throw new Error("Give the OpenCode binary as the first argument or in OPENBOT_OPENCODE_PATH.");
const binary: string = binaryArgument;

const MODEL = "gpt-6-luna";
const root = await mkdtemp(join(tmpdir(), "openbot-opencode-azure-"));

/** In the OpenCode environment, as a user's shell can have it. No request may carry it. */
const ENV_OPENAI_KEY = "openai-env-key";

interface CapturedRequest {
  readonly path: string;
  readonly status: number;
  readonly authorization: string | null;
  /** The Responses `store` flag. `false` keeps the conversation off the provider's servers. */
  readonly store: unknown;
}
const requests: CapturedRequest[] = [];

function sse(response: ServerResponse, events: readonly (readonly [string | null, unknown])[]): void {
  response.writeHead(200, { "content-type": "text/event-stream" });
  for (const [event, data] of events)
    response.write(
      `${event ? `event: ${event}\n` : ""}data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`,
    );
  response.end();
}

function responsesStream(response: ServerResponse): void {
  const item = { id: "msg_1", type: "message", role: "assistant", status: "in_progress", content: [] };
  const part = { type: "output_text", text: "", annotations: [] };
  const done = { ...item, status: "completed", content: [{ ...part, text: "ok" }] };
  const base = { id: "resp_1", object: "response", created_at: 0, model: MODEL, output: [] };
  const usage = { input_tokens: 10, output_tokens: 1, total_tokens: 11 };
  sse(response, [
    ["response.created", { type: "response.created", response: { ...base, status: "in_progress" } }],
    ["response.output_item.added", { type: "response.output_item.added", output_index: 0, item }],
    [
      "response.content_part.added",
      { type: "response.content_part.added", item_id: "msg_1", output_index: 0, content_index: 0, part },
    ],
    [
      "response.output_text.delta",
      { type: "response.output_text.delta", item_id: "msg_1", output_index: 0, content_index: 0, delta: "ok" },
    ],
    ["response.output_item.done", { type: "response.output_item.done", output_index: 0, item: done }],
    [
      "response.completed",
      { type: "response.completed", response: { ...base, status: "completed", output: [done], usage } },
    ],
  ]);
}

function answer(request: IncomingMessage, response: ServerResponse, body: string): void {
  const path = request.url ?? "";
  const store = body ? JSON.parse(body).store : undefined;
  const authorization = request.headers.authorization ?? null;
  const record = (status: number) => requests.push({ path, status, authorization, store });
  if (path.endsWith("/responses")) {
    record(200);
    responsesStream(response);
    return;
  }
  if (path.endsWith("/chat/completions")) {
    record(200);
    const chunk = (delta: unknown, finish: string | null) => ({
      id: "c1",
      object: "chat.completion.chunk",
      created: 0,
      model: MODEL,
      choices: [{ index: 0, delta, finish_reason: finish }],
    });
    sse(response, [
      [null, chunk({ role: "assistant", content: "ok" }, null)],
      [null, { ...chunk({}, "stop"), usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 } }],
      [null, "[DONE]"],
    ]);
    return;
  }
  record(404);
  response.writeHead(404).end();
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
const local = `http://127.0.0.1:${address.port}/openai/v1`;

/** The layer OpenBot sends for one endpoint, with only the base URL moved to the fake server. */
function configFor(
  baseUrl: string,
  apiKey: string | null,
): { readonly npm: string; readonly baseURL: string; readonly content: string } {
  const env = openCodeConfigEnv(
    {},
    () => [
      {
        id: "azure-foundry",
        name: "Azure",
        baseUrl,
        apiKey,
        models: [{ id: MODEL, name: "Luna" }],
        headers: [],
      },
    ],
    null,
  );
  const content = env.OPENCODE_CONFIG_CONTENT;
  assert.ok(content, "no OpenCode config layer");
  const config = JSON.parse(content);
  const entry = config.provider["azure-foundry"];
  const sent = { npm: entry.npm, baseURL: entry.options.baseURL };
  entry.options.baseURL = local;
  return { ...sent, content: JSON.stringify(config) };
}

async function runOpenCode(
  content: string,
  name: string,
): Promise<{ readonly code: number | null; readonly stderr: string }> {
  const home = join(root, name);
  mkdirSync(home, { recursive: true });
  const child = spawn(binary, ["run", "--standalone", "--model", `azure-foundry/${MODEL}`, "Say ok."], {
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
      OPENAI_API_KEY: ENV_OPENAI_KEY,
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const code = await new Promise<number | null>((done) => child.on("close", done));
  return { code, stderr: stderr.slice(-2000) };
}

interface CaseReport {
  readonly name: string;
  readonly configuredBaseUrl: string;
  readonly npm: string;
  readonly sentBaseUrl: string;
  readonly requests: readonly CapturedRequest[];
  readonly exitCode: number | null;
}
const cases: CaseReport[] = [];
const report: { binary: string; model: string; cases: CaseReport[]; result?: "pass" | "fail"; error?: string } = {
  binary,
  model: MODEL,
  cases,
};
try {
  const checks = [
    {
      name: "azure-openai-v1",
      baseUrl: "https://example-resource.openai.azure.com/openai/v1",
      apiKey: "azure-test-key",
      npm: "@ai-sdk/openai",
      path: "/openai/v1/responses",
    },
    {
      name: "azure-foundry-v1",
      baseUrl: "https://example-resource.services.ai.azure.com/openai/v1/",
      apiKey: "azure-test-key",
      npm: "@ai-sdk/openai",
      path: "/openai/v1/responses",
    },
    {
      name: "azure-no-key",
      baseUrl: "https://example-resource.openai.azure.com/openai/v1",
      apiKey: null,
      npm: "@ai-sdk/openai-compatible",
      path: "/openai/v1/chat/completions",
    },
    {
      name: "other-host",
      baseUrl: "https://llm.example.com/openai/v1",
      apiKey: "other-test-key",
      npm: "@ai-sdk/openai-compatible",
      path: "/openai/v1/chat/completions",
    },
  ] as const;
  for (const item of checks) {
    const config = configFor(item.baseUrl, item.apiKey);
    assert.equal(config.npm, item.npm, `${item.name}: adapter`);
    assert.equal(config.baseURL, item.baseUrl, `${item.name}: base URL`);
    const before = requests.length;
    const run = await runOpenCode(config.content, item.name);
    const sent = requests.slice(before);
    const turn = sent.filter((request) => request.path === item.path && request.status === 200);
    assert.ok(turn.length > 0, `${item.name}: no answered request to ${item.path} (exit ${run.code}): ${run.stderr}`);
    assert.equal(run.code, 0, `${item.name}: OpenCode exit ${run.code}: ${run.stderr}`);
    for (const request of sent) {
      assert.notEqual(request.authorization, `Bearer ${ENV_OPENAI_KEY}`, `${item.name}: sent OPENAI_API_KEY`);
      if (item.apiKey) assert.equal(request.authorization, `Bearer ${item.apiKey}`, `${item.name}: key`);
      if (item.path.endsWith("/responses")) assert.equal(request.store, false, `${item.name}: store`);
    }
    cases.push({
      name: item.name,
      configuredBaseUrl: item.baseUrl,
      npm: config.npm,
      sentBaseUrl: config.baseURL,
      requests: sent,
      exitCode: run.code,
    });
  }
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
process.stdout.write(`PASS opencode-azure-responses-e2e: ${join(OUT, "report.json")}\n`);
