import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { PromptCacheTtl } from "@openbot/contracts/ipc";
import { type DynamicRecord, isDynamicRecord } from "@openbot/contracts/runtime-values";
import type { AgentClient } from "../src/backend/agent-client";
import { requireProviderDriver } from "../src/backend/provider-drivers";
import { runTurn, startThread, stopClients } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/pi-custom-endpoint-cache-retention-e2e");
const PI =
  process.env.OPENBOT_REAL_PI_PATH ?? join(homedir(), ".config/OpenBot/provider-runtimes/pi/linux-x64/1.6.0/bin/pi");
const MODEL = "lab-model";

interface CaseReport {
  ttl: PromptCacheTtl;
  requests: number;
  turnStatus: string | null;
  turnError: string | null;
  cacheRetentionFields: unknown[];
  storeFields: unknown[];
}

const report: { pi: string; passed: boolean; cases: CaseReport[]; failures: string[]; error?: string } = {
  pi: PI,
  passed: false,
  cases: [],
  failures: [],
};
const root = await mkdtemp(join(tmpdir(), "openbot-pi-endpoint-cache-"));
const clients: AgentClient[] = [];
const bodies: DynamicRecord[] = [];

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((done, fail) => {
    let text = "";
    request.setEncoding("utf8");
    request.on("data", (part) => {
      text += part;
    });
    request.on("end", () => done(text));
    request.on("error", fail);
  });
}

interface CompletionChunk {
  readonly id: string;
  readonly object: string;
  readonly created: number;
  readonly model: string;
  readonly choices: readonly DynamicRecord[];
  readonly usage?: DynamicRecord;
}

function chunk(response: ServerResponse, value: CompletionChunk): void {
  response.write(`data: ${JSON.stringify(value)}\n\n`);
}

const server = createServer(async (request, response) => {
  const text = await readBody(request);
  if (request.method !== "POST" || !request.url?.endsWith("/chat/completions")) {
    response.writeHead(404).end();
    return;
  }
  const body = JSON.parse(text);
  if (isDynamicRecord(body)) bodies.push(body);
  response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  const base = { id: "chatcmpl-lab", object: "chat.completion.chunk", created: 1, model: MODEL };
  chunk(response, { ...base, choices: [{ index: 0, delta: { role: "assistant", content: "Done." } }] });
  chunk(response, { ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
  chunk(response, { ...base, choices: [], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } });
  response.end("data: [DONE]\n\n");
});

async function runCase(ttl: PromptCacheTtl, baseUrl: string): Promise<void> {
  const dir = join(root, ttl);
  const agentDirectory = join(dir, "pi-agent");
  await mkdir(agentDirectory, { recursive: true });
  process.env.PI_CODING_AGENT_DIR = agentDirectory;
  const client = requireProviderDriver("pi").createClient(
    { executable: PI, version: "1.6.0", source: "managed" },
    30_000,
    {
      apiKey: () => null,
      customProviders: () => [
        {
          id: "lab",
          name: "Lab",
          baseUrl,
          apiKey: "lab-key",
          headers: [],
          harness: "pi",
          models: [{ id: MODEL, name: "Lab model" }],
        },
      ],
      mcpServers: () => [],
      promptCacheTtl: () => ttl,
    },
  );
  clients.push(client);
  client.start();
  const before = bodies.length;
  const thread = await startThread(client, { cwd: dir });
  const turn = await runTurn(client, thread, { model: `lab/${MODEL}`, text: "Say done.", timeoutMs: 60_000 });
  const sent = bodies.slice(before);
  const entry: CaseReport = {
    ttl,
    requests: sent.length,
    turnStatus: turn.status,
    turnError: turn.error,
    cacheRetentionFields: sent.flatMap((body) =>
      "prompt_cache_retention" in body ? [body.prompt_cache_retention] : [],
    ),
    storeFields: sent.flatMap((body) => ("store" in body ? [body.store] : [])),
  };
  report.cases.push(entry);
  if (entry.requests === 0) report.failures.push(`${ttl}: the endpoint got no request.`);
  if (entry.turnStatus !== "completed") report.failures.push(`${ttl}: the turn ended as ${entry.turnStatus}.`);
  if (entry.cacheRetentionFields.length > 0)
    report.failures.push(`${ttl}: Pi sent prompt_cache_retention ${JSON.stringify(entry.cacheRetentionFields)}.`);
  if (entry.storeFields.length > 0) report.failures.push(`${ttl}: Pi sent store ${JSON.stringify(entry.storeFields)}.`);
}

try {
  if (!existsSync(PI)) throw new Error(`No Pi binary at ${PI}. Set OPENBOT_REAL_PI_PATH.`);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("The test endpoint has no port.");
  process.env.HOME = join(root, "home");
  await mkdir(process.env.HOME, { recursive: true });
  const baseUrl = `http://127.0.0.1:${address.port}/v1`;
  await runCase("1h", baseUrl);
  await runCase("5m", baseUrl);
  report.passed = report.failures.length === 0;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
} finally {
  await stopClients(clients);
  server.close();
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.passed) process.exitCode = 1;
}
