// Runs the real `grok` provider driver and the real Grok binary against a fake xAI Responses server,
// to check which tools each request declares. Grok must not declare `send_feedback`, which sends
// feedback to xAI, or `workflow`, a background agent fleet that OpenBot does not show. The image and
// video tools stay: an agent can attach the files they make. Grok runs with a temporary `GROK_HOME`
// and a fake key, so no account, quota or user setting is used.
// `bun scripts/grok-tool-trim-e2e.ts`. Writes .openbot-build/grok-tool-trim-e2e/report.json.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentClient } from "../src/backend/agent-client";
import { resolveGrokCli } from "../src/backend/cli";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { NO_PROVIDER_CREDENTIALS, requireProviderDriver } from "../src/backend/provider-drivers";
import { runTurn, startThread, stopClients } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/grok-tool-trim-e2e");
const NL = String.fromCharCode(10);
const REMOVED = ["send_feedback", "workflow"];
const KEPT = ["run_terminal_command", "image_gen", "image_to_video"];

interface Report {
  passed: boolean;
  grokVersion?: string;
  /** The tool names and the body size of each request that declares tools. */
  requests: Array<{ bytes: number; tools: string[] }>;
  turn?: { error: string | null; status: string | null };
  error?: string;
}

const report: Report = { passed: false, requests: [] };
const root = await realpath(await mkdtemp(join(tmpdir(), "openbot-grok-trim-e2e-")));
const clients: AgentClient[] = [];
const saved = { ...process.env };

async function body(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const part of request) chunks.push(Buffer.from(part));
  return Buffer.concat(chunks).toString("utf8");
}

interface OutputItem {
  type: "message";
  id: string;
  role: "assistant";
  status: "completed";
  content: Array<{ type: "output_text"; text: string; annotations: [] }>;
}

/** One server-sent event of a streamed Responses answer. */
interface StreamEvent {
  type: string;
  output_index?: number;
  item?: OutputItem;
  response?: {
    id: string;
    object: "response";
    created_at: number;
    model: string;
    status: string;
    output: OutputItem[];
    usage?: {
      input_tokens: number;
      input_tokens_details: { cached_tokens: number };
      output_tokens: number;
      output_tokens_details: { reasoning_tokens: number };
      total_tokens: number;
    };
  };
}

/** A streamed Responses answer with one short text, with each field that Grok requires. */
function answer(response: ServerResponse): void {
  const item: OutputItem = {
    type: "message",
    id: "m",
    role: "assistant",
    status: "completed",
    content: [{ type: "output_text", text: "done", annotations: [] }],
  };
  const body = { id: "r", object: "response", created_at: 0, model: "grok-e2e" } as const;
  let sequence = 0;
  const send = (event: StreamEvent) =>
    response.write(
      `event: ${event.type}${NL}data: ${JSON.stringify({ ...event, sequence_number: sequence++ })}${NL}${NL}`,
    );
  response.writeHead(200, { "content-type": "text/event-stream" });
  send({ type: "response.created", response: { ...body, status: "in_progress", output: [] } });
  send({ type: "response.output_item.done", output_index: 0, item });
  send({
    type: "response.completed",
    response: {
      ...body,
      status: "completed",
      output: [item],
      usage: {
        input_tokens: 1,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens: 1,
        output_tokens_details: { reasoning_tokens: 0 },
        total_tokens: 2,
      },
    },
  });
  response.end();
}

const server = createServer((request: IncomingMessage, response: ServerResponse) => {
  void (async () => {
    const text = await body(request);
    if (request.method !== "POST" || !request.url?.endsWith("/responses")) {
      response.writeHead(404, { "content-type": "application/json" });
      response.end("{}");
      return;
    }
    const parsed: { tools?: Array<{ name?: string }> } = text ? JSON.parse(text) : {};
    const tools = (parsed.tools ?? []).flatMap((tool) => tool.name ?? []).sort();
    if (tools.length > 0) report.requests.push({ bytes: text.length, tools });
    answer(response);
  })().catch((error: unknown) => {
    response.writeHead(500);
    response.end(String(error));
  });
});

try {
  await new Promise<void>((listening) => server.listen(0, "127.0.0.1", listening));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("The fake endpoint has no port.");
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

  const cli = await runCauseEffect(resolveGrokCli({ bundledExecutable: process.env.GROK_CLI ?? null }));
  report.grokVersion = cli.version;
  const client = requireProviderDriver("grok").createClient(cli, 60_000, NO_PROVIDER_CREDENTIALS);
  clients.push(client);
  client.start();
  const thread = await startThread(client, { cwd: workspace });
  const turn = await runTurn(client, thread, { text: "Say done.", timeoutMs: 90_000 });
  report.turn = { error: turn.error, status: turn.status };
  assert.equal(turn.status, "completed", `The turn failed: ${turn.error}`);

  const main = report.requests.reduce<Report["requests"][number] | null>(
    (largest, request) => (largest && largest.bytes >= request.bytes ? largest : request),
    null,
  );
  assert.ok(main, "Grok sent no request with tools.");
  for (const name of REMOVED) assert.ok(!main.tools.includes(name), `Grok declares ${name}: ${main.tools.join(", ")}`);
  for (const name of KEPT)
    assert.ok(main.tools.includes(name), `Grok does not declare ${name}: ${main.tools.join(", ")}`);
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  await stopClients(clients);
  process.env = saved;
  server.close();
  await rm(root, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}${NL}`);
  process.stdout.write(`${report.passed ? "passed" : "failed"}: ${join(OUT, "report.json")}${NL}`);
}
