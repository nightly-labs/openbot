// Lists and selects Cline's free models end to end on the real Cline driver, with a fake `cline --acp`
// that answers as Cline 3.0.73 does: a provider option of the model category comes before the model
// option, the model option does not list the `cline-free/*` models, and the agent takes any model
// value. Cline's recommended-models endpoint is answered in this process. Checks that the picker gets
// the free models with a "(free)" name, that a listed and a free model each reach the session through
// the `model` option, that a free model moves the session to the `cline` provider, that a list that
// cannot be read gives the last good one, then the bundled one, and that an empty free tier is kept.
// `bun scripts/cline-free-models-e2e.ts`. Writes .openbot-build/cline-free-models-e2e/report.json.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentClient } from "../src/backend/agent-client";
import type { AgentCliInfo } from "../src/backend/cli";
import { CLINE_RECOMMENDED_MODELS_URL } from "../src/backend/cline-free-models";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { decodeModelListResponse, type ModelListResponse } from "../src/backend/protocol";
import { NO_PROVIDER_CREDENTIALS, requireProviderDriver } from "../src/backend/provider-drivers";
import { installFakeAgent, readJsonl, runTurn, startThread, stopClients } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/cline-free-models-e2e");

// The shape of Cline's answer on 2026-10-19, with one id that `isAgentModel` refuses.
const RECOMMENDED = {
  recommended: [{ id: "anthropic/claude-sonnet-5.5", name: "claude-sonnet-5.5", description: "", tags: ["NEW"] }],
  free: [
    { id: "cline-free/minimax-m3.1-flash", name: "Minimax M3.1 Flash", description: "Flash model", tags: [] },
    { id: "cline-free/nemotron-3.5-super-vl", name: "cline-free/nemotron-3.5-super-vl", description: "", tags: [] },
    { id: "~cline-free/not valid", name: "Not valid", description: "", tags: [] },
  ],
  clinePass: [{ id: "cline-pass/glm-5.3", name: "cline-pass/glm-5.3", description: "", tags: [] }],
};

interface LogEntry {
  event: "set" | "prompt";
  sessionId: string;
  configId?: string;
  value?: string;
  provider?: string;
  model?: string;
}

interface Report {
  passed: boolean;
  listed?: { id: string; name: string }[];
  requests?: { headers: Record<string, string>; credentials: string | null }[];
  turns?: { model: string; set: LogEntry[]; sessionProvider: string | null; sessionModel: string | null }[];
  lastGood?: string[];
  bundled?: string[];
  ended?: string[];
}

const root = await mkdtemp(join(tmpdir(), "openbot-cline-free-models-e2e-"));
const log = join(root, "cline.jsonl");
const report: Report = { passed: false };
const clients: AgentClient[] = [];
process.env.FAKE_LOG = log;

// Cline's endpoint, answered here: `status` 200 with `RECOMMENDED`, or the error status set below.
let status = 200;
let free: { id: string; name: string; description: string; tags: string[] }[] = RECOMMENDED.free;
const requests: NonNullable<Report["requests"]> = [];
const realFetch = globalThis.fetch;
globalThis.fetch = Object.assign(
  async (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
    if (String(input) !== CLINE_RECOMMENDED_MODELS_URL) return realFetch(input, init);
    requests.push({
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      credentials: init?.credentials ?? null,
    });
    return status === 200
      ? new Response(JSON.stringify({ ...RECOMMENDED, free }), {
          status,
          headers: { "content-type": "application/json" },
        })
      : new Response("unavailable", { status });
  },
  { preconnect: realFetch.preconnect },
);

function open(cli: AgentCliInfo): AgentClient {
  const client = requireProviderDriver("cline").createClient(cli, 10_000, NO_PROVIDER_CREDENTIALS);
  clients.push(client);
  client.start();
  return client;
}

async function listModels(client: AgentClient): Promise<ModelListResponse["data"]> {
  const response = await runCauseEffect(client.request("model/list", {}, decodeModelListResponse));
  return response.data;
}

try {
  const executable = join(root, "cline", "bin", "cline");
  const workspace = join(root, "workspace");
  await mkdir(workspace);
  await installFakeAgent(executable, "cline");
  const cli: AgentCliInfo = { executable, version: "3.0.73", source: "managed" };

  // 1. The picker gets the CLI's models, then Cline's free ones with a "(free)" name.
  const client = open(cli);
  const listed = (await listModels(client)).map((model) => ({ id: model.model ?? "", name: model.displayName ?? "" }));
  assert.deepEqual(
    listed,
    [
      { id: "anthropic/claude-sonnet-5.5", name: "Claude Sonnet 5.5" },
      { id: "openai/gpt-6-astra", name: "GPT-6 Astra" },
      { id: "cline-free/minimax-m3.1-flash", name: "Minimax M3.1 Flash (free)" },
      { id: "cline-free/nemotron-3.5-super-vl", name: "cline-free/nemotron-3.5-super-vl (free)" },
    ],
    "The picker lists the CLI's models and Cline's valid free models.",
  );
  assert.ok(requests.length > 0, "OpenBot reads Cline's recommended models.");
  for (const request of requests) {
    assert.deepEqual(request.headers, { accept: "application/json" }, "The request sends no account data.");
    assert.equal(request.credentials, null, "The request sends no credentials.");
  }
  report.listed = listed;
  report.requests = requests;

  // 2. A listed and a free model each reach the session through the `model` option, not `provider`.
  // The session starts on `cline-pass`: a listed model keeps it, and a free one moves it to `cline`.
  await rm(log, { force: true });
  const thread = await startThread(client, { model: "openai/gpt-6-astra", cwd: workspace });
  report.turns = [];
  // A listed model after the free one sets the session's own provider back.
  for (const [model, provider, providerChange] of [
    ["openai/gpt-6-astra", "cline-pass", false],
    ["cline-free/minimax-m3.1-flash", "cline", true],
    ["openai/gpt-6-astra", "cline-pass", true],
  ] as const) {
    await rm(log, { force: true });
    assert.equal((await runTurn(client, thread, { model })).error, null, `The turn on ${model} succeeds.`);
    const entries: LogEntry[] = (await readJsonl<LogEntry>(log)).filter((entry) => entry.sessionId === thread);
    const set = entries.filter((entry) => entry.event === "set");
    const prompt = entries.filter((entry) => entry.event === "prompt").at(-1);
    const modelSet = set.findIndex((entry) => entry.configId === "model" && entry.value === model);
    assert.ok(modelSet >= 0, `${model} is sent as the model option.`);
    if (providerChange) {
      const providerSet = set.findIndex((entry) => entry.configId === "provider" && entry.value === provider);
      assert.ok(providerSet >= 0 && providerSet < modelSet, `${model} sets the ${provider} provider first.`);
    } else {
      assert.ok(!set.some((entry) => entry.configId === "provider"), `${model} does not change the provider.`);
    }
    assert.equal(prompt?.provider, provider, `The turn on ${model} uses the ${provider} provider.`);
    assert.equal(prompt?.model, model, `The turn on ${model} runs on it.`);
    report.turns.push({ model, set, sessionProvider: prompt?.provider ?? null, sessionModel: prompt?.model ?? null });
  }

  // 3. A list that cannot be read keeps the last good one.
  status = 503;
  const lastGood = (await listModels(client))
    .map((model) => model.model ?? "")
    .filter((id) => id.startsWith("cline-free/"));
  assert.deepEqual(
    lastGood,
    ["cline-free/minimax-m3.1-flash", "cline-free/nemotron-3.5-super-vl"],
    "A failed read keeps the free models of the last good one.",
  );
  report.lastGood = lastGood;

  // 4. With no good read yet, the bundled free tier is listed.
  const bundled = (await listModels(open(cli)))
    .map((model) => model.model ?? "")
    .filter((id) => id.startsWith("cline-free/"));
  assert.deepEqual(
    bundled,
    [
      "cline-free/minimax-m3.1-flash",
      "cline-free/nemotron-3.5-super-vl",
      "cline-free/mimo-v2.6-flash",
      "cline-free/muse-spark-1.3-contributor",
      "cline-free/solar-mini4",
    ],
    "With no good read, the bundled free tier is listed.",
  );
  report.bundled = bundled;

  // 5. An empty free tier is an answer: the picker does not keep the old free models.
  status = 200;
  free = [];
  const ended = (await listModels(client)).map((model) => model.model ?? "");
  assert.deepEqual(
    ended,
    ["anthropic/claude-sonnet-5.5", "openai/gpt-6-astra"],
    "An empty free tier removes the free models.",
  );
  report.ended = ended;
  report.passed = true;
} finally {
  globalThis.fetch = realFetch;
  await stopClients(clients);
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
