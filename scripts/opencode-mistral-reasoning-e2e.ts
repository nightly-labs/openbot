// A DeepSeek model on Mistral's API must not get `reasoning_content` back on a replayed `assistant`
// message. Mistral validates the body with `extra="forbid"` and answers HTTP 422 `extra_forbidden`,
// and OpenCode 2.2.5 sends an empty `reasoning_content` for any model id that contains `deepseek`.
// The test builds the OpenCode config with the real `openCodeConfigEnv` for an endpoint on
// `https://api.mistral.ai/v1`, moves only the base URL to a fake server that refuses the field as
// Mistral does, and runs the real OpenCode binary through a turn with a tool call. A control
// config in OpenCode's `provider` format, as OpenBot wrote it before, must hit the 422.
// `OPENCODE_CLI=<opencode> bun run test:opencode-mistral-reasoning`.
// Writes .openbot-build/opencode-mistral-reasoning/report.json.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { type CustomProviderConfig, openCodeConfigEnv } from "../src/backend/opencode-config";

const OUT = resolve(import.meta.dirname, "../.openbot-build/opencode-mistral-reasoning");
const MODEL = "deepseek-v4-1-flash-1017";
const REFUSED = ["reasoning_content", "reasoning", "reasoning_details", "thinking_blocks"];

/** One message of a request: its role, and the refused fields that an `assistant` message carries. */
interface ParsedMessage {
  role: string;
  refusedFields: string[];
}

interface Request {
  roles: string[];
  /** The refused fields on `assistant` messages, as `messages[index].field`. */
  refused: string[];
}

interface Run {
  output: string;
  requests: Request[];
}

interface Report {
  passed: boolean;
  openCodeVersion?: string;
  control?: Run;
  fixed?: Run;
  error?: string;
}

const report: Report = { passed: false };
const run = promisify(execFile);
const root = await mkdtemp(join(tmpdir(), "openbot-mistral-reasoning-e2e-"));
let requests: Request[] = [];

/** The messages of a chat request. The body is the fake server's input, so it is read here once. */
async function readMessages(request: IncomingMessage): Promise<ParsedMessage[]> {
  const chunks: Buffer[] = [];
  for await (const part of request) chunks.push(Buffer.from(part));
  const body: { messages?: { role?: string }[] } = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  return (body.messages ?? []).map((message) => ({
    role: String(message.role),
    refusedFields: message.role === "assistant" ? REFUSED.filter((field) => field in message) : [],
  }));
}

interface ChunkDelta {
  role?: "assistant";
  content?: string | null;
  tool_calls?: { index: number; id: string; type: "function"; function: { name: string; arguments: string } }[];
}

function chunk(delta: ChunkDelta, finish: string | null): string {
  const value = {
    id: "chatcmpl-e2e",
    object: "chat.completion.chunk",
    created: 0,
    model: MODEL,
    choices: [{ index: 0, delta, finish_reason: finish }],
  };
  return `data: ${JSON.stringify(value)}\n\n`;
}

/** A fake Mistral: the first turn asks for a tool call, and a refused field gets the 422 that the user saw. */
const server = createServer((request: IncomingMessage, response: ServerResponse) => {
  void (async () => {
    const messages = await readMessages(request);
    const refused = messages.flatMap((message, index) =>
      message.refusedFields.map((field) => `messages[${index}].${field}`),
    );
    requests.push({ roles: messages.map((message) => message.role), refused });
    if (refused.length > 0) {
      response.writeHead(422, { "content-type": "application/json" });
      response.end(
        JSON.stringify({ detail: [{ type: "extra_forbidden", loc: ["body", ...refused.slice(0, 1)], input: "" }] }),
      );
      return;
    }
    response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    if (messages.some((message) => message.role === "tool")) {
      response.write(chunk({ role: "assistant", content: "done" }, null));
      response.write(chunk({}, "stop"));
    } else {
      const call = {
        index: 0,
        id: "call12345",
        type: "function",
        function: { name: "bash", arguments: JSON.stringify({ command: "ls", description: "list" }) },
      };
      response.write(chunk({ role: "assistant", content: null, tool_calls: [call] }, null));
      response.write(chunk({}, "tool_calls"));
    }
    response.end("data: [DONE]\n\n");
  })().catch((error: unknown) => {
    response.writeHead(500);
    response.end(String(error));
  });
});

const endpoint: CustomProviderConfig = {
  id: "mistral",
  name: "Mistral",
  baseUrl: "https://api.mistral.ai/v1",
  apiKey: "e2e-key",
  headers: [],
  models: [{ id: MODEL, name: "DeepSeek V4.1 Flash" }],
};

/** The config that OpenBot hands to OpenCode, with only the base URL moved to the fake server. */
function fixedConfig(local: string): string {
  const text = openCodeConfigEnv({}, () => [endpoint], null).OPENCODE_CONFIG_CONTENT;
  assert.ok(text, "OpenBot wrote no OpenCode config.");
  assert.ok(text.includes("https://api.mistral.ai/v1"), "The config does not name Mistral's API.");
  return text.replaceAll("https://api.mistral.ai/v1", local);
}

/** The `provider` format that OpenBot wrote before: OpenCode drops a `compatibility` key there. */
function controlConfig(local: string): string {
  return JSON.stringify({
    provider: {
      mistral: {
        npm: "@ai-sdk/openai-compatible",
        name: "Mistral",
        options: { baseURL: local, apiKey: "e2e-key" },
        models: { [MODEL]: { name: "DeepSeek V4.1 Flash" } },
      },
    },
  });
}

async function turn(cli: string, config: string, name: string): Promise<Run> {
  const home = join(root, name);
  await mkdir(join(home, "work"), { recursive: true });
  requests = [];
  const env = {
    PATH: process.env.PATH ?? "",
    HOME: home,
    XDG_CONFIG_HOME: join(home, "c"),
    XDG_DATA_HOME: join(home, "d"),
    XDG_STATE_HOME: join(home, "s"),
    XDG_CACHE_HOME: join(home, "k"),
    OPENCODE_CONFIG_CONTENT: config,
  };
  const args = ["run", "--standalone", "--auto", "-m", `mistral/${MODEL}`, "Run ls with the bash tool."];
  // `opencode run` reads the prompt from a piped stdin too, so the test closes it.
  const child = run(cli, args, { cwd: join(home, "work"), env, timeout: 120_000 });
  child.child.stdin?.end();
  const result = await child.catch((error: { stdout?: string; stderr?: string }) => ({
    stdout: error.stdout ?? "",
    stderr: error.stderr ?? "",
  }));
  return { output: `${result.stdout}${result.stderr}`.slice(-400), requests: [...requests] };
}

async function main() {
  const cli = process.env.OPENCODE_CLI;
  assert.ok(cli, "Set OPENCODE_CLI to the OpenCode binary.");
  report.openCodeVersion = (await run(cli, ["--version"])).stdout.trim();
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const local = `http://127.0.0.1:${address.port}/v1`;

  report.control = await turn(cli, controlConfig(local), "control");
  assert.ok(
    report.control.requests.some((request) => request.refused.includes("messages[2].reasoning_content")),
    "The control did not reproduce the bug: OpenCode sent no reasoning_content on the assistant message.",
  );

  report.fixed = await turn(cli, fixedConfig(local), "fixed");
  assert.ok(
    report.fixed.requests.some((request) => request.roles.includes("tool")),
    "OpenCode sent no request after the tool call.",
  );
  assert.deepEqual(
    report.fixed.requests.flatMap((request) => request.refused),
    [],
    "OpenBot's Mistral config still sent a refused field on an assistant message.",
  );
  assert.match(report.fixed.output, /done/u, "The turn after the tool call did not finish.");
  report.passed = true;
}

try {
  await main();
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  server.close();
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
}
