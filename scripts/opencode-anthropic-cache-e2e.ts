// Checks that a custom provider on Anthropic's API host gets prompt caching. Builds the OpenCode
// config layer with `openCodeConfigEnv` for an endpoint at `https://api.anthropic.com/v1/`, then runs
// the real OpenCode CLI with that layer against a fake Anthropic server on loopback (only the base
// URL changes), and reads the request that OpenCode sends. `--standalone` (OpenCode 2) keeps each
// run off the shared background service. Cases: the Anthropic adapter, which must
// send `cache_control` breakpoints to `/v1/messages`, and the OpenAI-compatible adapter that such an
// endpoint used before, which sends none to `/v1/chat/completions`.
// `bun scripts/opencode-anthropic-cache-e2e.ts [<opencode binary>]`. Without an argument it uses
// `OPENBOT_OPENCODE_PATH`. Writes .openbot-build/opencode-anthropic-cache-e2e/report.json.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { openCodeConfigEnv } from "../src/backend/opencode-config";

const OUT = resolve(import.meta.dirname, "../.openbot-build/opencode-anthropic-cache-e2e");
const binaryArgument = process.argv[2] ?? process.env.OPENBOT_OPENCODE_PATH;
if (!binaryArgument) throw new Error("Give the OpenCode binary as the first argument or in OPENBOT_OPENCODE_PATH.");
const binary: string = binaryArgument;

const MODEL = "claude-sonnet-5-5";
const root = await mkdtemp(join(tmpdir(), "openbot-opencode-anthropic-"));

interface CapturedRequest {
  readonly path: string;
  readonly body: unknown;
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

function answer(request: IncomingMessage, response: ServerResponse, body: string): void {
  const path = request.url ?? "";
  requests.push({ path, body: body ? JSON.parse(body) : null });
  if (path.endsWith("/messages")) {
    const usage = { input_tokens: 10, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
    sse(response, [
      [
        "message_start",
        {
          type: "message_start",
          message: {
            id: "msg_1",
            type: "message",
            role: "assistant",
            model: MODEL,
            content: [],
            stop_reason: null,
            usage,
          },
        },
      ],
      ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
      ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ok" } }],
      ["content_block_stop", { type: "content_block_stop", index: 0 }],
      ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } }],
      ["message_stop", { type: "message_stop" }],
    ]);
    return;
  }
  if (path.endsWith("/chat/completions")) {
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
const local = `http://127.0.0.1:${address.port}/v1`;

/** The layer OpenBot sends for one endpoint, with only the base URL moved to the fake server. */
function configFor(baseUrl: string): { readonly npm: string; readonly baseURL: string; readonly content: string } {
  const env = openCodeConfigEnv(
    {},
    () => [
      {
        id: "anthropic-direct",
        name: "Anthropic",
        baseUrl,
        apiKey: "sk-ant-test",
        models: [{ id: MODEL, name: "Sonnet" }],
        headers: [],
      },
    ],
    null,
  );
  const content = env.OPENCODE_CONFIG_CONTENT;
  assert.ok(content, "no OpenCode config layer");
  const config = JSON.parse(content);
  const entry = config.provider["anthropic-direct"];
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
  const child = spawn(binary, ["run", "--standalone", "--model", `anthropic-direct/${MODEL}`, "Say ok."], {
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
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const code = await new Promise<number | null>((done) => child.on("close", done));
  return { code, stderr: stderr.slice(-2000) };
}

/** Each `cache_control` value in a request body. */
function breakpoints(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap(breakpoints);
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) => (key === "cache_control" ? [child] : breakpoints(child)));
}

interface CaseReport {
  readonly name: string;
  readonly configuredBaseUrl: string;
  readonly npm: string;
  readonly sentBaseUrl: string;
  readonly requests: readonly string[];
  readonly breakpoints: readonly unknown[];
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
      name: "anthropic-host",
      baseUrl: "https://api.anthropic.com/v1/",
      npm: "@ai-sdk/anthropic",
      path: "/v1/messages",
      cached: true,
    },
    {
      name: "other-host",
      baseUrl: "https://llm.example.com/v1",
      npm: "@ai-sdk/openai-compatible",
      path: "/v1/chat/completions",
      cached: false,
    },
  ] as const;
  for (const item of checks) {
    const config = configFor(item.baseUrl);
    assert.equal(config.npm, item.npm, `${item.name}: adapter`);
    const before = requests.length;
    const run = await runOpenCode(config.content, item.name);
    const turn = requests.slice(before).filter((request) => request.path === item.path);
    assert.ok(turn.length > 0, `${item.name}: no request to ${item.path} (exit ${run.code}): ${run.stderr}`);
    const marks = turn.flatMap((request) => breakpoints(request.body));
    if (item.cached) assert.ok(marks.length > 0, `${item.name}: no cache_control breakpoint`);
    else assert.equal(marks.length, 0, `${item.name}: unexpected cache_control`);
    cases.push({
      name: item.name,
      configuredBaseUrl: item.baseUrl,
      npm: config.npm,
      sentBaseUrl: config.baseURL,
      requests: requests.slice(before).map((request) => request.path),
      breakpoints: marks,
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
process.stdout.write(`PASS opencode-anthropic-cache-e2e: ${join(OUT, "report.json")}\n`);
