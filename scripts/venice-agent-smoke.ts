// Runs the real `venice` driver (`PiAgentClient` with the Venice key extension) over the real Pi CLI,
// against a fake Venice server on a loopback port. A test extension, which the wrapper adds to each
// Pi run, sends Pi's requests for https://api.venice.ai/api/v1 to that server, so the extension under
// test keeps the real Venice URL and no Venice key or account is needed. Pi uses an isolated agent
// folder (`PI_CODING_AGENT_DIR`). The checks: no key gives no models and asks for a key; the model
// list is the generated catalog with bare ids and Venice's efforts; a turn on the default model runs
// Pi's read tool; each request has the saved key and `include_venice_system_prompt: false`; an effort
// reaches the request as `reasoning_effort`; a 401 and a 402 give the saved-key texts; the key is not
// in the extension files.
// `PI_CLI=<path to pi> bun scripts/venice-agent-smoke.ts`. Writes .openbot-build/venice-agent-smoke/report.json.
import { mkdirSync, writeFileSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { agentProviderDescriptor, agentProviderName } from "@openbot/contracts/agent-providers";
import { sourceText } from "@openbot/i18n/source";
import { visibleDynamicTools } from "../src/backend/agent/tool-catalog";
import type { AgentClient } from "../src/backend/agent-client";
import { resolvePiCli } from "../src/backend/cli";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { type AppServerNotification, getArray, getRecord, getString, isRecord } from "../src/backend/protocol";
import { requireProviderDriver } from "../src/backend/provider-drivers";
import { VENICE_MODELS } from "../src/backend/venice-models";
import { stopClients } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/venice-agent-smoke");
const KEY = ["vn", "e2e", "venice", "fake0000"].join("-");
const MODEL = agentProviderDescriptor("venice").defaultModel;
const TURN_DEADLINE_MS = 120_000;
const LIST_TIMEOUT_MS = 120_000;

interface Check {
  name: string;
  passed: boolean;
  detail: unknown;
}
const checks: Check[] = [];
const check = (name: string, passed: boolean, detail: unknown) => {
  checks.push({ name, passed, detail });
  process.stdout.write(`${passed ? "pass" : "FAIL"}  ${name}\n`);
};

// ---- Fake Venice: OpenAI chat completions with streaming and tool calls ----

interface RecordedRequest {
  path: string;
  authorization: string | null;
  model: string | null;
  reasoningEffort: string | null;
  veniceParameters: unknown;
}
const requests: RecordedRequest[] = [];
let failWith: 401 | 402 | null = null;

interface ChunkDelta {
  role?: "assistant";
  content?: string;
  tool_calls?: { index: number; id: string; type: "function"; function: { name: string; arguments: string } }[];
}

const chunk = (delta: ChunkDelta, finish: string | null) =>
  `data: ${JSON.stringify({
    id: "chatcmpl-smoke",
    object: "chat.completion.chunk",
    created: 0,
    model: MODEL,
    choices: [{ index: 0, delta, finish_reason: finish }],
    ...(finish ? { usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 } } : {}),
  })}\n\n`;

function answer(body: unknown, response: ServerResponse) {
  const messages = getArray(body, "messages").filter(isRecord);
  const tools = getArray(body, "tools").filter(isRecord);
  const read = tools
    .map((tool) => getString(getRecord(tool, "function"), "name") ?? "")
    .find((name) => name === "read" || name.endsWith("__read"));
  response.writeHead(200, { "content-type": "text/event-stream" });
  const last = messages.at(-1);
  const prompt = JSON.stringify(messages.filter((message) => message.role === "user").at(-1) ?? {});
  if (last?.role !== "tool" && read && prompt.includes("count.txt")) {
    response.write(
      chunk(
        {
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id: "call_read_1",
              type: "function",
              function: { name: read, arguments: JSON.stringify({ path: "count.txt" }) },
            },
          ],
        },
        null,
      ),
    );
    response.write(chunk({}, "tool_calls"));
  } else {
    const text = last?.role === "tool" ? `count is ${JSON.stringify(last.content).includes("42") ? "42" : "?"}` : "ok";
    response.write(chunk({ role: "assistant", content: text }, null));
    response.write(chunk({}, "stop"));
  }
  response.end("data: [DONE]\n\n");
}

const server = createServer((request: IncomingMessage, response: ServerResponse) => {
  let raw = "";
  request.on("data", (part) => {
    raw += part;
  });
  request.on("end", () => {
    const body = raw ? JSON.parse(raw) : {};
    requests.push({
      path: request.url ?? "",
      authorization: request.headers.authorization ?? null,
      model: getString(body, "model") ?? null,
      reasoningEffort: getString(body, "reasoning_effort") ?? null,
      veniceParameters: getRecord(body, "venice_parameters") ?? null,
    });
    if (failWith) {
      response.writeHead(failWith, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: failWith === 401 ? "Authentication failed" : "Insufficient balance" }));
      return;
    }
    if (request.method === "POST" && request.url === "/api/v1/chat/completions") return answer(body, response);
    response.writeHead(404).end();
  });
});
await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
const address = server.address();
if (!address || typeof address === "string") throw new Error("The fake Venice server has no port.");
const fakeBase = `http://127.0.0.1:${address.port}/api/v1`;

// ---- Pi with the redirect extension, in an isolated folder ----

const REDIRECT_EXTENSION = `export default function () {
  const venice = "https://api.venice.ai/api/v1";
  const fake = process.env.OPENBOT_SMOKE_VENICE_BASE;
  if (!fake || globalThis.__openbotSmokeFetch) return;
  const original = globalThis.fetch;
  globalThis.__openbotSmokeFetch = true;
  globalThis.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith(venice)) return original(input, init);
    const target = fake + url.slice(venice.length);
    return input instanceof Request ? original(new Request(target, input), init) : original(target, init);
  };
}
`;

const quote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;
const root = await realpath(await mkdtemp(join(tmpdir(), "openbot-venice-smoke-")));
const agent = join(root, "agent");
const workspace = join(root, "workspace");
const state = join(root, "state");
await mkdir(agent, { recursive: true });
await mkdir(workspace, { recursive: true });
await writeFile(join(agent, "settings.json"), "{}");
await writeFile(join(agent, "auth.json"), "{}");
await writeFile(join(workspace, "count.txt"), "42\n");
const redirect = join(root, "redirect.mjs");
await writeFile(redirect, REDIRECT_EXTENSION);
const cli = await runCauseEffect(resolvePiCli({ bundledExecutable: process.env.PI_CLI }));
const wrapper = join(root, "pi");
await writeFile(
  wrapper,
  `#!/bin/sh\ncase "$1" in --mode) exec ${quote(cli.executable)} "$@" --extension ${quote(redirect)} ;; *) exec ${quote(cli.executable)} "$@" ;; esac\n`,
);
await chmod(wrapper, 0o755);
const smokeCli = await runCauseEffect(resolvePiCli({ bundledExecutable: wrapper }));
process.env.PI_CODING_AGENT_DIR = agent;
process.env.OPENBOT_SMOKE_VENICE_BASE = fakeBase;

const veniceClient = (key: string | null) =>
  requireProviderDriver("venice").createClient(smokeCli, TURN_DEADLINE_MS, {
    apiKey: (provider) => (provider === "venice" ? key : null),
    customProviders: () => [],
    mcpServers: () => [],
    providerStateDirectory: state,
  });

const modelList = (client: AgentClient) =>
  runCauseEffect(
    client.request(
      "model/list",
      { limit: 500, includeHidden: true },
      (value) => getArray(value, "data"),
      LIST_TIMEOUT_MS,
    ),
  );

let onTurnNotification: ((notification: AppServerNotification) => void) | null = null;

/** Runs one turn and answers with its status, the Pi tools that completed, and the error texts. */
async function runTurn(client: AgentClient, threadId: string, text: string, effort?: string) {
  const tools: string[] = [];
  const errors: string[] = [];
  let status = "";
  const done = new Promise<void>((finish) => {
    onTurnNotification = (notification) => {
      if (notification.method === "error")
        errors.push(getString(getRecord(notification.params, "error"), "message") ?? "");
      const item = getRecord(notification.params, "item");
      if (
        notification.method === "item/completed" &&
        getString(item, "type") === "dynamicToolCall" &&
        getString(item, "status") === "completed"
      )
        tools.push(getString(item, "tool") ?? "");
      if (notification.method !== "turn/completed") return;
      status = getString(getRecord(notification.params, "turn"), "status") ?? "unknown";
      onTurnNotification = null;
      finish();
    };
  });
  await runCauseEffect(
    client.request(
      "turn/start",
      { threadId, model: MODEL, ...(effort ? { effort } : {}), input: [{ type: "text", text, text_elements: [] }] },
      (value) => value,
    ),
  );
  let deadline: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    done,
    new Promise<never>((_, fail) => {
      deadline = setTimeout(
        () => fail(new Error(`The turn did not end in ${TURN_DEADLINE_MS / 1000} s.`)),
        TURN_DEADLINE_MS,
      );
    }),
  ]).finally(() => clearTimeout(deadline));
  return { status, tools, errors };
}

const clients: AgentClient[] = [];
try {
  // 1. No key: no models, no Pi request, and the account asks for a key.
  const keyless = veniceClient(null);
  clients.push(keyless);
  keyless.start();
  const keylessModels = await modelList(keyless);
  const keylessAccount = await runCauseEffect(
    keyless.request("account/read", {}, (value) => getRecord(value, "account") ?? null),
  );
  check(
    "with no key, Venice lists no models and has no account",
    keylessModels.length === 0 && keylessAccount === null,
    {
      models: keylessModels.length,
      account: keylessAccount,
    },
  );

  // 2. With a key: the generated catalog, bare ids, Venice's efforts, and no request to Venice.
  const client = veniceClient(KEY);
  clients.push(client);
  client.on("request", (request) => client.respond(request.id, { decision: "accept" }));
  client.on("notification", (notification) => onTurnNotification?.(notification));
  client.start();
  const listed = await modelList(client);
  const ids = listed.map((model) => getString(model, "model") ?? "");
  const expected = VENICE_MODELS.map((model) => model.id);
  const defaultEntry = listed.find((model) => getString(model, "model") === MODEL);
  const defaultEfforts = getArray(defaultEntry, "supportedReasoningEfforts").map((effort) =>
    getString(effort, "reasoningEffort"),
  );
  check(
    "with a key, Venice lists the generated catalog with bare ids and no request to Venice",
    ids.length === expected.length && expected.every((id) => ids.includes(id)) && requests.length === 0,
    {
      listed: ids.length,
      expected: expected.length,
      prefixed: ids.filter((id) => id.includes("venice/")),
      requests: requests.length,
    },
  );
  check(
    `the default model ${MODEL} offers Venice's efforts (none, low, high, max)`,
    JSON.stringify([...defaultEfforts].sort()) === JSON.stringify(["high", "low", "max", "none"]),
    defaultEfforts,
  );

  // 3. A turn on the default model that runs Pi's read tool.
  const threadId = await runCauseEffect(
    client.request("thread/start", { cwd: workspace, model: MODEL, dynamicTools: visibleDynamicTools("pi") }, (value) =>
      getString(getRecord(value, "thread"), "id"),
    ),
  );
  if (!threadId) throw new Error("thread/start returned no thread id.");
  const toolTurn = await runTurn(client, threadId, "Use the read tool to read count.txt, then reply with the number.");
  const turnRequests = requests.splice(0);
  check(
    "a turn on the default model calls Pi's read tool and completes",
    toolTurn.status === "completed" && toolTurn.tools.includes("read") && turnRequests.length >= 2,
    { ...toolTurn, requests: turnRequests.length },
  );

  // 4. Each request goes to chat completions with the saved key and without Venice's system prompt.
  check(
    "each request has the saved key, the default model and include_venice_system_prompt: false",
    turnRequests.length > 0 &&
      turnRequests.every(
        (request) =>
          request.path === "/api/v1/chat/completions" &&
          request.authorization === `Bearer ${KEY}` &&
          request.model === MODEL &&
          getRecord(request, "veniceParameters")?.include_venice_system_prompt === false,
      ),
    turnRequests.map((request) => ({
      path: request.path,
      authorization: request.authorization === `Bearer ${KEY}` ? "Bearer <saved key>" : request.authorization,
      model: request.model,
      venice_parameters: request.veniceParameters,
    })),
  );

  // 5. An effort reaches the request as Venice's `reasoning_effort`.
  const highTurn = await runTurn(client, threadId, "Reply with ok (high).", "high");
  const high = { status: highTurn.status, sent: requests.splice(0).map((request) => request.reasoningEffort) };
  const noneTurn = await runTurn(client, threadId, "Reply with ok (none).", "none");
  const none = { status: noneTurn.status, sent: requests.splice(0).map((request) => request.reasoningEffort) };
  check(
    "effort high sends reasoning_effort high, and none sends none",
    high.sent.length > 0 &&
      high.sent.every((value) => value === "high") &&
      none.sent.length > 0 &&
      none.sent.every((value) => value === "none"),
    { high, none },
  );

  // 6. A 401 and a 402 give the texts about the saved key and the balance.
  const name = agentProviderName("venice");
  failWith = 401;
  const refusedTurn = await runTurn(client, threadId, "Reply with ok (401).");
  failWith = 402;
  const noBalanceTurn = await runTurn(client, threadId, "Reply with ok (402).");
  failWith = null;
  requests.splice(0);
  const refused = sourceText("error.provider.keyProviderRefused", { provider: name });
  const noBalance = sourceText("error.provider.keyProviderNoBalance", { provider: name });
  check(
    "a 401 shows the refused-key text, and a 402 the balance text",
    refusedTurn.status === "failed" &&
      refusedTurn.errors.includes(refused) &&
      noBalanceTurn.status === "failed" &&
      noBalanceTurn.errors.includes(noBalance),
    { 401: refusedTurn, 402: noBalanceTurn },
  );

  // 7. The key is in no file that OpenBot wrote for Pi.
  const written: string[] = [];
  const walk = async (folder: string): Promise<void> => {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) await walk(path);
      else written.push(path);
    }
  };
  await walk(state).catch(() => undefined);
  const extensionFiles = written.filter((path) => path.endsWith("venice.mjs") || path.endsWith("venice-models.json"));
  const leaks = [];
  for (const path of written) if ((await readFile(path, "utf8").catch(() => "")).includes(KEY)) leaks.push(path);
  check("no file that OpenBot wrote for Pi contains the key", leaks.length === 0, {
    files: written.length,
    extensionFiles: extensionFiles.length,
    leaks,
  });
} catch (error) {
  check("the smoke ran to the end", false, error instanceof Error ? error.message : String(error));
} finally {
  await stopClients(clients);
  server.close();
  await rm(root, { recursive: true, force: true });
}

const passed = checks.length > 0 && checks.every((item) => item.passed);
mkdirSync(OUT, { recursive: true });
writeFileSync(
  join(OUT, "report.json"),
  `${JSON.stringify({ passed, cli: { version: cli.version }, model: MODEL, checks }, null, 2)}\n`,
);
process.stdout.write(`\n${passed ? "Passed." : "Failed."}\nReport: ${join(OUT, "report.json")}\n`);
process.exit(passed ? 0 : 1);
