// Runs the real `bf16` driver (`PiAgentClient` with the bf16.ai key extension) over the real Pi CLI,
// against a fake bf16.ai server on a loopback port. A test extension redirects Pi's requests for
// https://api.bf16.ai/v1 to that server, so the production extension keeps the real bf16.ai URL
// and no live API key is needed.
// `PI_CLI=<path to pi> bun scripts/bf16-agent-smoke.ts`. Writes .openbot-build/bf16-agent-smoke/report.json.
import { mkdirSync, writeFileSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { agentProviderDescriptor } from "@openbot/contracts/agent-providers";
import { visibleDynamicTools } from "../src/backend/agent/tool-catalog";
import type { AgentClient } from "../src/backend/agent-client";
import { BF16_MODELS } from "../src/backend/bf16-models";
import { resolvePiCli } from "../src/backend/cli";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { type AppServerNotification, getArray, getRecord, getString, isRecord } from "../src/backend/protocol";
import { requireProviderDriver } from "../src/backend/provider-drivers";
import { stopClients } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/bf16-agent-smoke");
const KEY = ["sk", "bf16", "v1", "smoke0000"].join("-");
const MODEL = agentProviderDescriptor("bf16").defaultModel;
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

interface RecordedRequest {
  path: string;
  authorization: string | null;
  model: string | null;
  reasoningEffort: string | null;
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
    id: "chatcmpl-bf16-smoke",
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
    });
    if (failWith) {
      response.writeHead(failWith, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: failWith === 401 ? "Authentication failed" : "Insufficient balance" }));
      return;
    }
    if (request.method === "POST" && request.url === "/v1/chat/completions") return answer(body, response);
    response.writeHead(404).end();
  });
});
await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
const address = server.address();
if (!address || typeof address === "string") throw new Error("The fake bf16.ai server has no port.");
const fakeBase = `http://127.0.0.1:${address.port}/v1`;

const REDIRECT_EXTENSION = `export default function () {
  const bf16 = "https://api.bf16.ai/v1";
  const fake = process.env.OPENBOT_SMOKE_BF16_BASE;
  if (!fake || globalThis.__openbotSmokeFetch) return;
  const original = globalThis.fetch;
  globalThis.__openbotSmokeFetch = true;
  globalThis.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith(bf16)) return original(input, init);
    const target = fake + url.slice(bf16.length);
    return input instanceof Request ? original(new Request(target, input), init) : original(target, init);
  };
}
`;

const quote = (value: string) => `\x27${value.replaceAll("\x27", "\x27\\\x27\x27")}\x27`;
const root = await realpath(await mkdtemp(join(tmpdir(), "openbot-bf16-smoke-")));
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
process.env.OPENBOT_SMOKE_BF16_BASE = fakeBase;

const bf16Client = (key: string | null) =>
  requireProviderDriver("bf16").createClient(smokeCli, TURN_DEADLINE_MS, {
    apiKey: (provider) => (provider === "bf16" ? key : null),
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
  const keyless = bf16Client(null);
  clients.push(keyless);
  keyless.start();
  const keylessModels = await modelList(keyless);
  const keylessAccount = await runCauseEffect(
    keyless.request("account/read", {}, (value) => getRecord(value, "account") ?? null),
  );
  check(
    "with no key, bf16.ai lists no models and has no account",
    keylessModels.length === 0 && keylessAccount === null,
    {
      models: keylessModels.length,
      account: keylessAccount,
    },
  );

  const client = bf16Client(KEY);
  clients.push(client);
  client.on("request", (request) => client.respond(request.id, { decision: "accept" }));
  client.on("notification", (notification) => onTurnNotification?.(notification));
  client.start();
  const listed = await modelList(client);
  const ids = listed.map((model) => getString(model, "model") ?? "");
  const expected = BF16_MODELS.map((model) => model.id);
  check(
    "with a key, bf16.ai lists the bundled catalog without hitting api.bf16.ai",
    ids.length === expected.length && expected.every((id) => ids.includes(id)) && requests.length === 0,
    { listed: ids.length, expected: expected.length, requests: requests.length },
  );

  const threadId = await runCauseEffect(
    client.request("thread/start", { cwd: workspace, model: MODEL, dynamicTools: visibleDynamicTools("pi") }, (value) =>
      getString(getRecord(value, "thread"), "id"),
    ),
  );
  if (!threadId) throw new Error("thread/start returned no thread id.");
  const toolTurn = await runTurn(client, threadId, "Use the read tool to read count.txt, then reply with the number.");
  const turnRequests = requests.splice(0);
  check(
    "a turn on the default model calls Pi read tool and completes",
    toolTurn.status === "completed" && toolTurn.tools.includes("read") && turnRequests.length >= 2,
    { ...toolTurn, requests: turnRequests.length },
  );
  check(
    "each request hits /v1/chat/completions with the saved Bearer key and default model",
    turnRequests.length > 0 &&
      turnRequests.every(
        (request) =>
          request.path === "/v1/chat/completions" &&
          request.authorization === `Bearer ${KEY}` &&
          request.model === MODEL,
      ),
    turnRequests.map((request) => ({
      path: request.path,
      authorized: request.authorization === `Bearer ${KEY}`,
      model: request.model,
    })),
  );

  const highTurn = await runTurn(client, threadId, "Reply with ok (high).", "high");
  const highEfforts = requests.splice(0).map((request) => request.reasoningEffort);
  check("effort high sends reasoning_effort high", highTurn.status === "completed" && highEfforts.includes("high"), {
    status: highTurn.status,
    highEfforts,
  });

  failWith = 401;
  const authFail = await runTurn(client, threadId, "Reply after 401.");
  requests.splice(0);
  check(
    "a 401 response reports refused API key",
    authFail.status === "failed" && authFail.errors.some((message) => /API key|refused|401/i.test(message)),
    authFail,
  );

  failWith = 402;
  const balanceFail = await runTurn(client, threadId, "Reply after 402.");
  requests.splice(0);
  check(
    "a 402 response reports balance/credits error",
    balanceFail.status === "failed" && balanceFail.errors.some((message) => /balance|credit|402/i.test(message)),
    balanceFail,
  );

  const leaked: string[] = [];
  const walk = async (dir: string) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if ((await readFile(full, "utf8")).includes(KEY)) leaked.push(full);
    }
  };
  await walk(root);
  check("no file written for Pi contains the API key", leaked.length === 0, { leaked });
} finally {
  await stopClients(clients);
  await new Promise<void>((done) => server.close(() => done()));
  await rm(root, { recursive: true, force: true });
}

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "report.json"), `${JSON.stringify({ checks }, null, 2)}\n`);
if (checks.some((item) => !item.passed)) process.exit(1);
