import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createServer as createTcpServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import type { AgentClient } from "../src/backend/agent-client";
import { resolveOpencodeCli } from "../src/backend/cli";
import { runCauseEffect } from "../src/backend/effect-boundary";
import type { CustomProviderConfig } from "../src/backend/opencode-config";
import { getArray, getString, isRecord } from "../src/backend/protocol";
import { requireProviderDriver } from "../src/backend/provider-drivers";
import { createModelReasoningSupport } from "../src/main/model-reasoning-probe";
import { runTurn, startThread, stopClients } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/opencode-custom-model");
const ENDPOINT = "spark";
const DEFAULT_MODEL = "default-model";
const AGENT_MODEL = "agent-model";
const KEYED_ENDPOINT = "vault";
const KEYED_PATH = "/keyed/v1";
const KEY = "e2e-endpoint-key";
const CAPPED_MODEL = "capped-model";
const WIDE_MODEL = "wide-model";
const GUESSED_MODEL = "guessed-model";
const EFFORT_MODEL = "effort-model";
const SAVED_EFFORTS = ["low", "high", "max"] as const;
const PLAIN_MODEL = "plain-model";
const VISION_MODEL = "vision-model";
const TEXT_MODEL = "text-model";
const READ_PDF = "Read report.pdf.";
const PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 10 10]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
);
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

interface Request {
  path: string;
  model: string | null;
  stream: boolean;
  auth?: "key" | "other" | "none";
  maxCompletionTokens: number | null;
  reasoningEffort: string | null;
  images: number;
  pdf: boolean;
  pdfRefused: boolean;
  userText: string | null;
}

interface Report {
  passed: boolean;
  openCodeVersion?: string;
  models?: string[];
  efforts?: Record<string, string[]>;
  requests: Request[];
  ollamaRequests: string[];
  turns: { reply: string; error: string | null; status: string | null }[];
  error?: string;
}

const report: Report = { passed: false, requests: [], ollamaRequests: [], turns: [] };
const root = await mkdtemp(join(tmpdir(), "openbot-opencode-model-e2e-"));
const clients: AgentClient[] = [];
const run = promisify(execFile);
const pdfPath = join(root, "workspace", "report.pdf");

async function readRequest(request: IncomingMessage): Promise<Omit<Request, "path" | "auth">> {
  const chunks: Buffer[] = [];
  for await (const part of request) chunks.push(Buffer.from(part));
  const text = Buffer.concat(chunks).toString("utf8");
  const value = text ? JSON.parse(text) : null;
  const budget = isRecord(value) ? value.max_completion_tokens : null;
  return {
    model: getString(value, "model"),
    stream: isRecord(value) && value.stream === true,
    maxCompletionTokens: typeof budget === "number" ? budget : null,
    reasoningEffort: getString(value, "reasoning_effort"),
    images: getArray(value, "messages")
      .flatMap((message) => getArray(message, "content"))
      .filter((part) => getString(part, "type") === "image_url").length,
    pdf: text.includes("application/pdf;base64") || text.includes(PDF.toString("base64").slice(0, 24)),
    pdfRefused: text.includes("does not support pdf input"),
    userText: userText(getArray(value, "messages").at(-1)),
  };
}

function userText(message: unknown): string | null {
  if (getString(message, "role") !== "user") return null;
  const content = isRecord(message) ? message.content : null;
  if (typeof content === "string") return content;
  return getArray(message, "content")
    .map((part) => getString(part, "text") ?? "")
    .join("");
}

function readCall(model: string, path: string): string {
  const call = {
    index: 0,
    id: "call_read_pdf",
    type: "function",
    function: { name: "read", arguments: JSON.stringify({ path }) },
  };
  const start = { index: 0, delta: { role: "assistant", tool_calls: [call] }, finish_reason: null };
  const end = { index: 0, delta: {}, finish_reason: "tool_calls" };
  return [start, end]
    .map(
      (choice) =>
        `data: ${JSON.stringify({ id: "chatcmpl-e2e", object: "chat.completion.chunk", created: 0, model, choices: [choice] })}\n\n`,
    )
    .join("");
}

function chunk(model: string, content: string | null): string {
  const choice = content
    ? { index: 0, delta: { role: "assistant", content }, finish_reason: null }
    : { index: 0, delta: {}, finish_reason: "stop" };
  const value = { id: "chatcmpl-e2e", object: "chat.completion.chunk", created: 0, model, choices: [choice] };
  return `data: ${JSON.stringify(value)}\n\n`;
}

const server = createServer((request: IncomingMessage, response: ServerResponse) => {
  void (async () => {
    const read = await readRequest(request);
    const { model, stream } = read;
    const path = request.url ?? "";
    if (path.startsWith("/api/")) {
      report.ollamaRequests.push(path);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify(
          path === "/api/version"
            ? { version: "0.0.0-e2e" }
            : { capabilities: model === PLAIN_MODEL ? ["completion", "tools"] : ["completion", "tools", "thinking"] },
        ),
      );
      return;
    }
    if (!path.startsWith(KEYED_PATH)) report.requests.push({ path, ...read });
    else {
      const header = request.headers.authorization;
      const auth = header === `Bearer ${KEY}` ? "key" : header ? "other" : "none";
      report.requests.push({ path, ...read, auth });
      if (auth !== "key") {
        response.writeHead(401, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: { message: "The API key is invalid", type: "authentication_error" } }));
        return;
      }
    }
    if (stream && read.userText?.includes(READ_PDF)) {
      response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      response.write(readCall(model ?? "", pdfPath));
      response.end("data: [DONE]\n\n");
      return;
    }
    const reply = `reply from ${model}`;
    if (!stream) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          id: "chatcmpl-e2e",
          object: "chat.completion",
          created: 0,
          model,
          choices: [{ index: 0, message: { role: "assistant", content: reply }, finish_reason: "stop" }],
        }),
      );
      return;
    }
    response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    response.write(chunk(model ?? "", reply));
    response.write(chunk(model ?? "", null));
    response.end("data: [DONE]\n\n");
  })().catch((error: unknown) => {
    response.writeHead(500);
    response.end(String(error));
  });
});

async function freePort(): Promise<number> {
  const probe = createTcpServer();
  await new Promise<void>((listening) => probe.listen(0, "127.0.0.1", listening));
  const address = probe.address();
  await new Promise<void>((closed) => probe.close(() => closed()));
  if (!address || typeof address === "string") throw new Error("The port probe has no port.");
  return address.port;
}

let cliPath: string | null = null;
try {
  await new Promise<void>((listening) => server.listen(0, "127.0.0.1", listening));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("The fake endpoint has no port.");
  const origin = `http://127.0.0.1:${address.port}`;
  const baseUrl = `${origin}/v1`;

  for (const [name, folder] of [
    ["HOME", "home"],
    ["XDG_CONFIG_HOME", "config"],
    ["XDG_DATA_HOME", "data"],
    ["XDG_STATE_HOME", "state"],
    ["XDG_CACHE_HOME", "cache"],
  ] as const) {
    process.env[name] = join(root, folder);
    await mkdir(join(root, folder), { recursive: true });
  }
  await mkdir(join(root, "config", "opencode"), { recursive: true });
  await writeFile(
    join(root, "config", "opencode", "opencode.json"),
    `${JSON.stringify(
      {
        $schema: "https://opencode.ai/config.json",
        model: `${ENDPOINT}/${DEFAULT_MODEL}`,
        small_model: `${ENDPOINT}/${DEFAULT_MODEL}`,
      },
      null,
      2,
    )}\n`,
  );
  const workspace = join(root, "workspace");
  await mkdir(workspace, { recursive: true });

  const endpoint: CustomProviderConfig = {
    id: ENDPOINT,
    name: "Spark",
    baseUrl,
    apiKey: null,
    headers: [],
    models: [
      { id: DEFAULT_MODEL, name: "Default model" },
      { id: AGENT_MODEL, name: "Agent model" },
      { id: CAPPED_MODEL, name: "Capped model", contextWindow: 131_072, maxOutput: 16_384 },
      { id: WIDE_MODEL, name: "Wide model", contextWindow: 131_072 },
      { id: GUESSED_MODEL, name: "Guessed model", contextWindow: 16_384 },
      { id: EFFORT_MODEL, name: "Effort model", reasoningEfforts: [...SAVED_EFFORTS] },
      { id: VISION_MODEL, name: "Vision model", inputs: ["image", "pdf"] },
      { id: TEXT_MODEL, name: "Text model", inputs: [] },
      { id: PLAIN_MODEL, name: "Plain model" },
    ],
  };
  const reasoning = createModelReasoningSupport(() => [endpoint]);
  assert.deepEqual(
    await Effect.runPromise(reasoning.refresh()),
    { changed: true, unreachable: false },
    "The first answer must count as a change.",
  );
  assert.deepEqual(reasoning.configs()[0]?.withoutReasoning, [PLAIN_MODEL]);
  assert.deepEqual(
    await Effect.runPromise(reasoning.refresh()),
    { changed: false, unreachable: false },
    "The same answer must not count as a change.",
  );
  const down = createModelReasoningSupport(() => [{ ...endpoint, baseUrl: "http://127.0.0.1:9/v1" }]);
  assert.deepEqual(await Effect.runPromise(down.refresh()), { changed: false, unreachable: true });
  assert.equal(down.configs()[0]?.withoutReasoning, undefined);
  assert.equal(
    report.ollamaRequests.filter((path) => path === "/api/show").length,
    2 * endpoint.models.filter((model) => model.reasoningEfforts === undefined).length,
    "The probe must ask only about the models with no saved efforts.",
  );

  const cli = await runCauseEffect(resolveOpencodeCli({ bundledExecutable: process.env.OPENCODE_CLI }));
  report.openCodeVersion = cli.version;
  cliPath = cli.executable;
  await run(cli.executable, ["service", "set", "port", String(await freePort())], { env: process.env });

  const client = requireProviderDriver("opencode").createClient(cli, 60_000, {
    apiKey: () => null,
    customProviders: () => reasoning.configs(),
    mcpServers: () => [],
    providerStateDirectory: join(root, "provider-state"),
  });
  clients.push(client);
  client.start();

  const listed = await runCauseEffect(client.request("model/list", {}, (value) => value));
  report.models = getArray(listed, "data").flatMap((model) => getString(model, "model") ?? []);
  assert.ok(report.models.includes(`${ENDPOINT}/${AGENT_MODEL}`), "OpenCode must list the agent's model.");
  report.efforts = Object.fromEntries(
    getArray(listed, "data").map((model) => [
      getString(model, "model") ?? "",
      getArray(model, "supportedReasoningEfforts").flatMap((effort) => getString(effort, "reasoningEffort") ?? []),
    ]),
  );
  assert.deepEqual(
    report.efforts[`${ENDPOINT}/${EFFORT_MODEL}`],
    [...SAVED_EFFORTS],
    "A model with saved efforts must list exactly those efforts.",
  );
  assert.deepEqual(
    report.efforts[`${ENDPOINT}/${AGENT_MODEL}`],
    ["low", "medium", "high"],
    "A model with no saved efforts must keep OpenCode's own efforts.",
  );

  const plain = getArray(listed, "data").find((model) => getString(model, "model") === `${ENDPOINT}/${PLAIN_MODEL}`);
  assert.equal(
    isRecord(plain) && plain.reasoningEffortConfigurable,
    false,
    "A model that cannot reason must offer no effort choice.",
  );

  const thread = await startThread(client, { cwd: workspace, model: `${ENDPOINT}/${AGENT_MODEL}` });
  for (const text of ["Say one word.", "Say another word."]) {
    const turn = await runTurn(client, thread, { text, timeoutMs: 120_000 });
    report.turns.push(turn);
    assert.equal(turn.error, null, `The turn failed: ${turn.error}`);
  }

  const budgets: ReadonlyArray<readonly [string, number]> = [
    [CAPPED_MODEL, 16_384],
    [WIDE_MODEL, 16_384],
    [GUESSED_MODEL, 8_192],
  ];
  for (const [model] of budgets) {
    const modelThread = await startThread(client, { cwd: workspace, model: `${ENDPOINT}/${model}` });
    const turn = await runTurn(client, modelThread, { text: "Say one word.", timeoutMs: 120_000 });
    report.turns.push(turn);
    assert.equal(turn.error, null, `The turn on ${model} failed: ${turn.error}`);
  }

  const effortThread = await startThread(client, { cwd: workspace, model: `${ENDPOINT}/${EFFORT_MODEL}` });
  const effortTurn = await runTurn(client, effortThread, { effort: "max", text: "Say one word.", timeoutMs: 120_000 });
  report.turns.push(effortTurn);
  assert.equal(effortTurn.error, null, `The turn on ${EFFORT_MODEL} failed: ${effortTurn.error}`);
  const plainThread = await startThread(client, { cwd: workspace, model: `${ENDPOINT}/${PLAIN_MODEL}` });
  const plainTurn = await runTurn(client, plainThread, { effort: "high", text: "Say one word.", timeoutMs: 120_000 });
  report.turns.push(plainTurn);
  assert.equal(plainTurn.error, null, `The turn on ${PLAIN_MODEL} failed: ${plainTurn.error}`);
  const plainRequests = report.requests.filter((request) => request.model === PLAIN_MODEL);
  assert.ok(plainRequests.length > 0, `The endpoint got no request for ${PLAIN_MODEL}.`);
  for (const request of plainRequests) {
    assert.equal(request.reasoningEffort, null, `${PLAIN_MODEL} must get no reasoning effort.`);
  }
  const effortRequests = report.requests.filter((request) => request.model === EFFORT_MODEL);
  assert.ok(effortRequests.length > 0, `The endpoint got no request for ${EFFORT_MODEL}.`);
  for (const request of effortRequests) {
    assert.equal(request.reasoningEffort, "max", `${EFFORT_MODEL} must send the effort of the turn.`);
  }

  const image = join(workspace, "pixel.png");
  await writeFile(image, PNG);
  const visionThread = await startThread(client, { cwd: workspace, model: `${ENDPOINT}/${VISION_MODEL}` });
  const visionTurn = await runTurn(client, visionThread, {
    text: "What is in the image?",
    images: [image],
    timeoutMs: 120_000,
  });
  report.turns.push(visionTurn);
  assert.equal(visionTurn.error, null, `The turn on ${VISION_MODEL} failed: ${visionTurn.error}`);
  const visionRequests = report.requests.filter((request) => request.model === VISION_MODEL);
  assert.ok(
    visionRequests.some((request) => request.images === 1),
    "OpenCode must send the image to a model saved with image input.",
  );
  const turnRequests = async (model: string, text: string) => {
    const start = report.requests.length;
    const modelThread = await startThread(client, { cwd: workspace, model: `${ENDPOINT}/${model}` });
    const turn = await runTurn(client, modelThread, { text, images: [image], timeoutMs: 120_000 });
    report.turns.push(turn);
    const seen = report.requests.slice(start).filter((request) => request.model === model);
    assert.ok(seen.length > 0, `The endpoint got no request for ${model}.`);
    return seen;
  };
  const defaultRequests = await turnRequests(AGENT_MODEL, "What is in the image?");
  assert.ok(
    defaultRequests.some((request) => request.images === 1),
    "A model with no saved input kinds must keep OpenCode's default and get the image.",
  );
  for (const request of await turnRequests(TEXT_MODEL, "What is in the image?")) {
    assert.equal(request.images, 0, "OpenCode must not send an image to a model saved as text-only.");
  }

  await writeFile(pdfPath, PDF);
  const visionPdf = await turnRequests(VISION_MODEL, READ_PDF);
  assert.ok(visionPdf.length > 1, `${VISION_MODEL} did not get the result of the read tool.`);
  assert.ok(
    visionPdf.some((request) => request.pdf),
    "OpenCode must give the PDF to a model saved with PDF input.",
  );
  assert.ok(!visionPdf.some((request) => request.pdfRefused), "OpenCode must not refuse the PDF.");
  const defaultPdf = await turnRequests(AGENT_MODEL, READ_PDF);
  assert.ok(defaultPdf.length > 1, `${AGENT_MODEL} did not get the result of the read tool.`);
  assert.ok(!defaultPdf.some((request) => request.pdf), "OpenCode must not give a PDF to a model without PDF input.");
  assert.ok(
    defaultPdf.some((request) => request.pdfRefused),
    "OpenCode must refuse the PDF for that model.",
  );

  assert.ok(report.requests.length > 0, "The endpoint got no request.");
  const known = new Set([
    AGENT_MODEL,
    EFFORT_MODEL,
    PLAIN_MODEL,
    VISION_MODEL,
    TEXT_MODEL,
    ...budgets.map(([model]) => model),
  ]);
  const others = report.requests.filter(
    (request) => request.auth === undefined && request.model !== null && !known.has(request.model),
  );
  assert.deepEqual(others, [], "Each request must name a model OpenBot configured.");
  for (const [model, budget] of budgets) {
    const seen = report.requests.filter((request) => request.model === model);
    assert.ok(seen.length > 0, `The endpoint got no request for ${model}.`);
    for (const request of seen) {
      assert.equal(
        request.maxCompletionTokens,
        budget,
        `${model} must ask for the ${budget}-token budget OpenBot wrote, not ${request.maxCompletionTokens}.`,
      );
    }
  }

  const keyedModel = `${KEYED_ENDPOINT}/${AGENT_MODEL}`;
  const keyedTurn = async (apiKey: string | null) => {
    const keyed = requireProviderDriver("opencode").createClient(cli, 60_000, {
      apiKey: () => null,
      customProviders: () => [
        { ...endpoint, id: KEYED_ENDPOINT, name: "Vault", baseUrl: `${origin}${KEYED_PATH}`, apiKey },
      ],
      mcpServers: () => [],
      providerStateDirectory: join(root, "provider-state"),
    });
    clients.push(keyed);
    keyed.start();
    const keyedThread = await startThread(keyed, { cwd: workspace, model: keyedModel });
    const turn = await runTurn(keyed, keyedThread, { text: "Say one word.", timeoutMs: 120_000 });
    report.turns.push(turn);
    return turn;
  };
  const sent = await keyedTurn(KEY);
  assert.equal(sent.error, null, `The turn with the saved key failed: ${sent.error}`);
  assert.ok(
    report.requests.some((request) => request.auth === "key"),
    "The endpoint must get the saved key.",
  );
  const refused = await keyedTurn("e2e-refused-key");
  assert.equal(refused.error, sourceText("error.provider.customEndpointAccessRefused", { provider: "Vault" }));
  const missing = await keyedTurn(null);
  assert.equal(missing.error, sourceText("error.provider.customEndpointKeyMissing", { provider: "Vault" }));
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  await stopClients(clients);
  if (cliPath) await run(cliPath, ["service", "stop"], { env: process.env }).catch(() => undefined);
  server.close();
  await rm(root, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${report.passed ? "passed" : "failed"}: ${join(OUT, "report.json")}\n`);
}
