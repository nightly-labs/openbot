// Runs the real `pi` provider driver and the real Pi binary against a fake OpenAI-compatible server,
// and books each turn's usage in a real OpenBot database, to check that a Pi turn gets the cost that
// Pi reports. Pi's `get_session_stats` sends the session's tokens and its cost at the rates of Pi's
// model list; both are session totals, so each turn books the difference from the last one. The
// agent directory has a `models.json` with a priced model and a model with no rates. Cases: a first
// turn, a second turn in the same session (it books its own cost, not the session total), a model
// with no rates (Pi reports 0, which is not a free turn, so the turn stays unpriced), a change in the
// same session to the priced model (priced) and back (unpriced again), and a session
// from before Pi costs were kept (its first cost report also counts that earlier use, so the turn
// stays unpriced and the next turn is priced).
// `PI_CLI=<pi> bun run test:pi-usage-cost`. Writes .openbot-build/pi-usage-cost-e2e/report.json.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { collectProviderUsage } from "../src/backend/agent/usage-collection";
import type { AgentClient } from "../src/backend/agent-client";
import { resolvePiCli } from "../src/backend/cli";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { type AppServerNotification, getString, isRecord } from "../src/backend/protocol";
import { requireProviderDriver } from "../src/backend/provider-drivers";
import { runTurn, startThread, stopClients } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/pi-usage-cost-e2e");
const PROVIDER = "cost-e2e";
/** USD per million tokens. */
const RATES = { input: 2, output: 10, cacheRead: 0.5, cacheWrite: 0 };

interface Sent {
  input: number;
  cached: number;
  output: number;
}

interface CaseReport {
  name: string;
  model: string;
  sent: Sent;
  expectedCost: number | null;
  cost: number | null;
  basis: string;
  passed: boolean;
}

interface Report {
  passed: boolean;
  piVersion?: string;
  usageNotices: unknown[];
  cases: CaseReport[];
  failure?: string;
}

const report: Report = { passed: false, usageNotices: [], cases: [] };
const root = await mkdtemp(join(tmpdir(), "openbot-pi-usage-cost-e2e-"));
const clients: AgentClient[] = [];
/** The usage of the next reply. Each case sets it before its turn. */
let next: Sent = { input: 0, cached: 0, output: 0 };

/** One server-sent event of a streamed chat completion. The last one has the usage of the request. */
function chunk(model: string, content: string | null, usage?: Sent): string {
  const choices = content
    ? [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }]
    : usage
      ? []
      : [{ index: 0, delta: {}, finish_reason: "stop" }];
  const value = {
    id: "chatcmpl-e2e",
    object: "chat.completion.chunk",
    created: 0,
    model,
    choices,
    ...(usage
      ? {
          usage: {
            prompt_tokens: usage.input,
            completion_tokens: usage.output,
            total_tokens: usage.input + usage.output,
            prompt_tokens_details: { cached_tokens: usage.cached },
          },
        }
      : {}),
  };
  return `data: ${JSON.stringify(value)}\n\n`;
}

const server = createServer((request: IncomingMessage, response: ServerResponse) => {
  void (async () => {
    const parts: Buffer[] = [];
    for await (const part of request) parts.push(Buffer.from(part));
    const body = JSON.parse(Buffer.concat(parts).toString("utf8") || "{}");
    const model = getString(body, "model") ?? "";
    response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    response.write(chunk(model, "Done."));
    response.write(chunk(model, null));
    response.write(chunk(model, null, next));
    response.end("data: [DONE]\n\n");
  })().catch((error: unknown) => {
    response.writeHead(500);
    response.end(String(error));
  });
});

/** The price of one request at `RATES`, or null for the model with no rates. */
function price(sent: Sent, priced: boolean): number | null {
  if (!priced) return null;
  return (
    ((sent.input - sent.cached) * RATES.input + sent.cached * RATES.cacheRead + sent.output * RATES.output) / 1_000_000
  );
}

try {
  await new Promise<void>((listening) => server.listen(0, "127.0.0.1", listening));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("The fake endpoint has no port.");

  // Pi must not read the developer's own providers and keys.
  const agentDirectory = join(root, "agent");
  await mkdir(agentDirectory, { recursive: true });
  await writeFile(join(agentDirectory, "settings.json"), "{}\n");
  await writeFile(join(agentDirectory, "auth.json"), "{}");
  const model = (id: string, cost: typeof RATES) => ({
    id,
    name: id,
    input: ["text"],
    reasoning: false,
    contextWindow: 32_768,
    maxTokens: 4_096,
    cost,
  });
  await writeFile(
    join(agentDirectory, "models.json"),
    `${JSON.stringify({
      providers: {
        [PROVIDER]: {
          baseUrl: `http://127.0.0.1:${address.port}/v1`,
          api: "openai-completions",
          apiKey: "e2e-placeholder",
          models: [model("priced", RATES), model("unpriced", { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })],
        },
      },
    })}\n`,
  );
  process.env.PI_CODING_AGENT_DIR = agentDirectory;
  const workspace = join(root, "workspace");
  await mkdir(workspace, { recursive: true });

  const database = new OpenBotDatabase(join(root, "profile"));
  await runCauseEffect(database.initialize());
  const reader = new DatabaseSync(database.path);
  const cli = await runCauseEffect(resolvePiCli({ bundledExecutable: process.env.PI_CLI }));
  report.piVersion = cli.version;
  const client = requireProviderDriver("pi").createClient(cli, 60_000, {
    apiKey: () => null,
    customProviders: () => [],
    mcpServers: () => [],
    providerStateDirectory: join(root, "state"),
  });
  clients.push(client);

  /** The agent service books each provider notice of a session as this does. */
  const sessions = new Map<string, { id: string; createdAt: string; dropCost: boolean; model: string }>();
  client.on("notification", (notification: AppServerNotification) => {
    const session = sessions.get(getString(notification.params, "threadId") ?? "");
    if (!session) return;
    let params = notification.params;
    if (notification.method === "openbot/usage") {
      report.usageNotices.push(params);
      // A version of OpenBot from before this change booked Pi's tokens without the cost.
      if (session.dropCost && isRecord(params)) {
        const { cost: _cost, ...rest } = params;
        params = rest;
      }
    }
    collectProviderUsage(
      database.usage,
      { id: "agent-e2e", model: session.model },
      { id: session.id, provider: "pi", createdAt: session.createdAt },
      notification.method,
      params,
    );
  });
  client.start();

  async function open(model: string, dropCost = false): Promise<string> {
    const thread = await startThread(client, { cwd: workspace, model });
    sessions.set(thread, { id: `session-${sessions.size + 1}`, createdAt: new Date().toISOString(), dropCost, model });
    return thread;
  }

  async function turn(
    name: string,
    thread: string,
    sent: Sent,
    expectedCost: number | null,
    model?: string,
  ): Promise<void> {
    const session = sessions.get(thread);
    assert.ok(session, `${name}: no session`);
    if (model) session.model = model;
    const rows = () =>
      reader
        .prepare(
          "SELECT estimated_cost_usd AS cost, rate_basis AS basis FROM agent_usage_records WHERE session_id = ? ORDER BY rowid",
        )
        .all(session.id);
    const count = rows().length;
    next = sent;
    const result = await runTurn(client, thread, { text: name, timeoutMs: 60_000, ...(model ? { model } : {}) });
    assert.equal(result.error, null, `${name}: the turn failed: ${result.error}`);
    const after = rows();
    assert.equal(after.length, count + 1, `${name}: the turn must add one usage record`);
    const row = after.at(-1);
    assert.ok(row, `${name}: no usage record`);
    const cost = typeof row.cost === "number" ? row.cost : null;
    const entry: CaseReport = {
      name,
      model: session.model,
      sent,
      expectedCost,
      cost,
      basis: String(row.basis),
      passed: false,
    };
    report.cases.push(entry);
    if (expectedCost === null) assert.equal(cost, null, `${name}: the turn must stay unpriced`);
    else {
      assert.ok(cost !== null && Math.abs(cost - expectedCost) < 1e-9, `${name}: cost ${cost}, not ${expectedCost}`);
      assert.match(entry.basis, /^Pi session cost report/u, `${name}: the basis names Pi's report`);
    }
    entry.passed = true;
  }

  const priced = `${PROVIDER}/priced`;
  const thread = await open(priced);
  const first = { input: 1_200, cached: 0, output: 300 };
  await turn("first turn", thread, first, price(first, true));
  const second = { input: 4_000, cached: 3_000, output: 100 };
  await turn("second turn in the session", thread, second, price(second, true));

  const free = await open(`${PROVIDER}/unpriced`);
  await turn("model with no rates", free, { input: 900, cached: 0, output: 50 }, null);
  const changed = { input: 3_000, cached: 2_000, output: 150 };
  await turn("change to the priced model", free, changed, price(changed, true), priced);
  await turn(
    "change back to the model with no rates",
    free,
    { input: 800, cached: 0, output: 40 },
    null,
    `${PROVIDER}/unpriced`,
  );

  // A session from before Pi costs were kept: its first turn has tokens and no cost.
  const older = await open(priced, true);
  const before = { input: 2_000, cached: 0, output: 400 };
  await turn("turn before costs were kept", older, before, null);
  const session = sessions.get(older);
  if (session) session.dropCost = false;
  await turn("first report of an older session", older, { input: 1_000, cached: 0, output: 100 }, null);
  const after = { input: 1_500, cached: 1_000, output: 200 };
  await turn("next turn of an older session", older, after, price(after, true));

  reader.close();
  database.close();
  report.passed = true;
} catch (error) {
  report.failure = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  await stopClients(clients);
  server.close();
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(`${report.passed ? "PASS" : "FAIL"} ${join(OUT, "report.json")}\n`);
  if (report.failure) process.stdout.write(`${report.failure}\n`);
}
