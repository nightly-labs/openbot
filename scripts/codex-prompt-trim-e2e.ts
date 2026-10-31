// Runs the real `codex app-server` against a fake Responses server, to check that a thread with the
// features that OpenBot sets declares no goal tools. Codex sends each other tool and its permission
// text as before: at Ask first Codex runs with no sandbox, and that text makes the model ask before a
// destructive command. A local server stands in for the model and records the tools and the
// instructions of each request, so no account or key is used.
// `bun scripts/codex-prompt-trim-e2e.ts`. Writes .openbot-build/codex-prompt-trim-e2e/report.json.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server as HttpServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CODEX_FEATURES_CONFIG } from "../src/backend/agent/thread-lifecycle";
import { CodexAppServerClient } from "../src/backend/app-server-client";
import { resolveCodexCli } from "../src/backend/cli";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { decodeRecordResponse, getRecord, getString } from "../src/backend/protocol";

const OUT = resolve(import.meta.dirname, "../.openbot-build/codex-prompt-trim-e2e");
const NL = String.fromCharCode(10);
const DEADLINE_MS = 60_000;

interface ResponsesRequest {
  instructions?: string;
  tools?: Array<{ name?: string; type?: string }>;
  input?: Array<{ role?: string; content?: Array<{ text?: string }> }>;
}

interface OutputItem {
  type: "message";
  role: "assistant";
  id: string;
  content: Array<{ type: "output_text"; text: string }>;
}

/** One server-sent event of a streamed Responses answer. */
interface StreamEvent {
  type: string;
  output_index?: number;
  item?: OutputItem;
  response?: { id: string; status: string; output?: OutputItem[]; usage?: Record<string, number> };
}

interface Recorded {
  bytes: number;
  tools: string[];
  developer: string[];
}

function startFakeModel() {
  const requests: Recorded[] = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const parsed: ResponsesRequest = JSON.parse(body || "{}");
      requests.push({
        bytes: body.length,
        tools: (parsed.tools ?? []).map((tool) => tool.name ?? tool.type ?? "?").sort(),
        developer: (parsed.input ?? [])
          .filter((item) => item.role === "developer")
          .flatMap((item) => (item.content ?? []).map((part) => part.text ?? "")),
      });
      const item: OutputItem = {
        type: "message",
        role: "assistant",
        id: "m",
        content: [{ type: "output_text", text: "done" }],
      };
      const send = (event: StreamEvent) =>
        response.write(`event: ${event.type}${NL}data: ${JSON.stringify(event)}${NL}${NL}`);
      response.writeHead(200, { "content-type": "text/event-stream" });
      send({ type: "response.created", response: { id: "r", status: "in_progress" } });
      send({ type: "response.output_item.done", output_index: 0, item });
      send({
        type: "response.completed",
        response: {
          id: "r",
          status: "completed",
          output: [item],
          usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        },
      });
      response.end();
    });
  });
  return listen(server).then((listening) => ({ requests, ...listening }));
}

async function listen(server: HttpServer) {
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  assert(address && typeof address === "object");
  return {
    port: address.port,
    close: () =>
      new Promise<void>((done) => {
        server.closeAllConnections();
        server.close(() => done());
      }),
  };
}

function deadline(what: string): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`No answer for ${what} in ${DEADLINE_MS} ms.`)), DEADLINE_MS).unref();
  });
}

const VARIANTS: Record<"before" | "after", { config: Partial<typeof CODEX_FEATURES_CONFIG> }> = {
  before: { config: {} },
  after: { config: CODEX_FEATURES_CONFIG },
};
const GOAL_TOOLS = ["create_goal", "get_goal", "update_goal"];

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
const cli = await runCauseEffect(resolveCodexCli());
const model = await startFakeModel();
const root = await mkdtemp(join(tmpdir(), "openbot-codex-trim-e2e-"));
const results: Record<string, Recorded | undefined> = {};
const report: {
  passed: boolean;
  codexVersion: string;
  /** The characters that the largest request of a turn no longer sends. */
  saved?: number;
  results?: Record<string, { bytes: number; tools: string[] } | undefined>;
  error?: string;
} = { passed: false, codexVersion: cli.version };
try {
  for (const [index, [name, variant]] of Object.entries(VARIANTS).entries()) {
    // Homes of one length, so each request carries paths of one length.
    const home = join(root, String(index));
    await mkdir(home, { recursive: true });
    await writeFile(
      join(home, "config.toml"),
      [
        'model = "fake-model"',
        'model_provider = "fake"',
        "[model_providers.fake]",
        'name = "fake"',
        `base_url = "http://127.0.0.1:${model.port}/v1"`,
        'env_key = "FAKE_KEY"',
        'wire_api = "responses"',
        "",
      ].join(NL),
    );
    const client = new CodexAppServerClient(cli.executable, 30_000, { CODEX_HOME: home, FAKE_KEY: "e2e" });
    const turnDone = new Promise<void>((done) => {
      client.on("notification", (notification) => {
        if (notification.method === "turn/completed") done();
      });
    });
    client.start();
    try {
      await runCauseEffect(
        client.request(
          "initialize",
          { clientInfo: { name: "openbot_e2e", title: "OpenBot E2E", version: "0.0.0" }, capabilities: {} },
          decodeRecordResponse,
        ),
      );
      client.notify("initialized");
      const started = await runCauseEffect(
        client.request(
          "thread/start",
          {
            cwd: home,
            approvalPolicy: "on-request",
            sandbox: "danger-full-access",
            model: "fake-model",
            config: variant.config,
          },
          decodeRecordResponse,
        ),
      );
      const threadId = getString(getRecord(started, "thread"), "id");
      assert(threadId, "thread/start returned no thread id");
      const first = model.requests.length;
      await runCauseEffect(
        client.request("turn/start", { threadId, input: [{ type: "text", text: "hello" }] }, decodeRecordResponse),
      );
      await Promise.race([turnDone, deadline(`the turn of ${name}`)]);
      results[name] = model.requests.slice(first).sort((a, b) => b.bytes - a.bytes)[0];
    } finally {
      await runCauseEffect(client.stop());
    }
  }
  const { before, after } = results;
  assert(before && after, "Codex sent no model request.");
  for (const tool of GOAL_TOOLS) assert.ok(before.tools.includes(tool), `Codex ${cli.version} declares no ${tool}.`);
  assert.deepEqual(
    after.tools,
    before.tools.filter((tool) => !GOAL_TOOLS.includes(tool)),
    "Other tools changed.",
  );
  const permissions = (request: Recorded) =>
    request.developer.some((text) => text.includes("<permissions instructions>"));
  assert.ok(permissions(after), "Codex sends no permission text.");
  report.saved = before.bytes - after.bytes;
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  await model.close();
  await rm(root, { recursive: true, force: true });
  report.results = Object.fromEntries(
    Object.entries(results).map(([name, result]) => [name, result && { bytes: result.bytes, tools: result.tools }]),
  );
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}${NL}`);
  process.stdout.write(`${report.passed ? "passed" : "failed"}: ${join(OUT, "report.json")}${NL}`);
}
