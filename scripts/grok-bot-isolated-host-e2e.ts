// Proves an OpenBot Grok turn stays on http://127.0.0.1:1340.
// A loopback peer stands in for the private gateway. Docker is a double.
// bun scripts/grok-bot-isolated-host-e2e.ts
// Writes .openbot-build/grok-bot-isolated-host-e2e/report.json.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Result } from "effect";
import { cursorLoginHandshake } from "../src/backend/agent/cursor-login-poll";
import { GrokBotAccountFailed, GrokBotAccountStore } from "../src/backend/grok-bot/grok-bot-account";
import { createGrokBotAgent, sendGrokBotPrompt } from "../src/backend/grok-bot/grok-bot-gateway";
import { startGrokBotEventStream } from "../src/backend/grok-bot/grok-bot-gateway-events";
import {
  type DockerCommandResult,
  GrokBotLocalHost,
  OPENBOT_LOCAL_GATEWAY_URL,
  OPENBOT_LOCAL_VM_CONTAINER,
  OPENBOT_LOCAL_VM_IMAGE,
} from "../src/backend/grok-bot/grok-bot-local-host";
import { runLocalExecClient } from "../src/backend/host-tools/local-exec-client";

const OUT = resolve(import.meta.dirname, "../.openbot-build/grok-bot-isolated-host-e2e");
const ACCESS = "grok-access-e2e";
const REFRESH = "grok-refresh-e2e";
const cipher = {
  encrypt: (value: string) => Buffer.from(value, "utf8"),
  decrypt: (value: Buffer) => value.toString("utf8"),
};

const report: {
  passed: boolean;
  ensureSandBox: number;
  cursorvm: number;
  redirectTarget: string;
  sandScheme: number;
  turnUrl: string;
  eventUrl: string;
  createAgentUrl: string;
  localExecBearer: "gateway" | "";
  fallback: string;
  stopped: string;
  blocked: string;
} = {
  passed: false,
  ensureSandBox: 0,
  cursorvm: 0,
  redirectTarget: "",
  sandScheme: 0,
  turnUrl: "",
  eventUrl: "",
  createAgentUrl: "",
  localExecBearer: "",
  fallback: "",
  stopped: "",
  blocked: "",
};

const requested: string[] = [];
const authorizations: string[] = [];

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((ready, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => ready(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function inputUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function failureText(error: unknown): string {
  const cause = error instanceof GrokBotAccountFailed ? error.cause : error;
  return cause instanceof Error ? cause.message : "";
}

async function bundleDirectory(parent: string): Promise<string> {
  const directory = join(parent, "sand-host");
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, "host-main.cjs"),
    "const DEFAULT_NOTIFY_ON_AGENT_UPDATES = true;\nconst agent = { notifyOnAgentUpdates: true };\n",
  );
  return directory;
}

async function expectHostError(
  parent: string,
  runDocker: (args: readonly string[]) => Promise<DockerCommandResult>,
  key: "error.provider.grokBotLocalHostFailed" | "error.provider.grokBotLocalHostStopped",
): Promise<string> {
  const directory = await mkdtemp(join(parent, "case-"));
  const host = new GrokBotLocalHost({
    directory,
    runDocker,
    bundleDirectory: await bundleDirectory(directory),
    readyTimeoutMs: 200,
    pollMs: 1,
    fetchImpl: Object.assign(
      async (input: Parameters<typeof fetch>[0]) => {
        requested.push(inputUrl(input));
        throw new Error("the private host double has no gateway");
      },
      { preconnect: fetch.preconnect },
    ),
  });
  const store = new GrokBotAccountStore(join(directory, "account.json"), cipher);
  await Effect.runPromise(store.save({ accessToken: ACCESS, refreshToken: REFRESH, gateway: null }));
  const result = await Effect.runPromise(
    Effect.result(
      sendGrokBotPrompt(
        store,
        { agentId: "sand-agent-e2e", prompt: "hi", clientNonce: "nonce-e2e" },
        { allowLoopback: false, localHost: host },
      ),
    ),
  );
  assert.equal(Result.isFailure(result), true);
  const message = Result.isFailure(result) ? failureText(result.failure) : "";
  assert.equal(message, sourceText(key));
  return message;
}

const root = await mkdtemp(join(tmpdir(), "openbot-grok-isolated-"));
const hostSource = readFileSync(resolve(import.meta.dirname, "../src/backend/grok-bot/grok-bot-local-host.ts"), "utf8");
const gatewaySource = readFileSync(resolve(import.meta.dirname, "../src/backend/grok-bot/grok-bot-gateway.ts"), "utf8");
const login = cursorLoginHandshake("https://cursor.com");

try {
  report.redirectTarget = new URL(login.loginUrl).searchParams.get("redirectTarget") ?? "";
  assert.equal(report.redirectTarget, "cli");
  assert.equal(login.loginUrl.includes("sand:"), false);
  report.sandScheme =
    hostSource.includes("sand://") || hostSource.includes('setAsDefaultProtocolClient("sand")') ? 1 : 0;
  assert.equal(report.sandScheme, 0);
  assert.equal(gatewaySource.includes("GrokBotService/EnsureSandBox"), false);
  assert.equal(hostSource.includes("GrokBotService/EnsureSandBox"), false);

  const discarded = new GrokBotAccountStore(join(root, "discard.json"), cipher);
  await Effect.runPromise(
    discarded.save({
      accessToken: ACCESS,
      refreshToken: REFRESH,
      gateway: { url: "https://box.example.cursorvm.com", token: "shared-box-token", headers: {} },
    }),
  );
  const loaded = await Effect.runPromise(discarded.load());
  assert.equal(loaded?.gateway ?? null, null);

  const downArgs: string[][] = [];
  report.fallback = await expectHostError(
    root,
    async (args) => {
      downArgs.push([...args]);
      return { ok: false, output: "" };
    },
    "error.provider.grokBotLocalHostFailed",
  );
  assert.equal(
    downArgs.some((args) => args[0] === "stop"),
    false,
  );

  const busyArgs: string[][] = [];
  await expectHostError(
    root,
    async (args) => {
      busyArgs.push([...args]);
      if (args[0] === "info") return { ok: true, output: "1" };
      if (args[0] === "inspect") return { ok: false, output: "" };
      if (args[0] === "ps") return { ok: true, output: "botai-local-vm|127.0.0.1:1340->1340/tcp" };
      return { ok: false, output: "" };
    },
    "error.provider.grokBotLocalHostFailed",
  );
  assert.equal(
    busyArgs.some((args) => args.includes("botai-local-vm")),
    false,
  );

  report.stopped = await expectHostError(
    root,
    async (args) => {
      if (args[0] === "info") return { ok: true, output: "1" };
      if (args[0] === "inspect") return { ok: true, output: `false|1|${OPENBOT_LOCAL_VM_IMAGE}` };
      if (args[0] === "ps") return { ok: true, output: "" };
      if (args[0] === "start") return { ok: false, output: "" };
      return { ok: false, output: "" };
    },
    "error.provider.grokBotLocalHostStopped",
  );

  let prompts = 0;
  const peer = createServer((request, response: ServerResponse) => {
    void (async () => {
      await readBody(request);
      const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
      authorizations.push(request.headers.authorization ?? "");
      if (path === "/health") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end("{}");
        return;
      }
      if (path === "/api/createAgent") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ agent: { id: "sand-agent-e2e", name: "OpenBot" } }));
        return;
      }
      if (path === "/api/sendPrompt") {
        prompts += 1;
        response.writeHead(prompts === 1 ? 401 : 200, { "content-type": "application/json" });
        response.end(prompts === 1 ? "" : JSON.stringify({ accepted: true }));
        return;
      }
      if (path === "/events" || path === "/local-exec/requests") {
        response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
        response.end(`data: ${JSON.stringify({ kind: "welcome", providerId: "e2e" })}\n\n`);
        return;
      }
      if (path === "/local-exec/responses") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end("{}");
        return;
      }
      response.writeHead(404).end();
    })().catch((error: unknown) => {
      response.writeHead(500).end(error instanceof Error ? error.message : "failed");
    });
  });
  await new Promise<void>((ready) => peer.listen(0, "127.0.0.1", ready));
  const bound = peer.address();
  assert.ok(bound !== null && typeof bound === "object");
  const peerUrl = `http://127.0.0.1:${bound.port}`;
  const fetchImpl = Object.assign(
    async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = inputUrl(input);
      requested.push(url);
      const target = new URL(url);
      return fetch(new URL(`${target.pathname}${target.search}`, peerUrl), init);
    },
    { preconnect: fetch.preconnect },
  );
  const liveDirectory = await mkdtemp(join(root, "live-"));
  let created = false;
  const runArgs: string[][] = [];
  const host = new GrokBotLocalHost({
    directory: liveDirectory,
    bundleDirectory: await bundleDirectory(liveDirectory),
    fetchImpl,
    readyTimeoutMs: 2_000,
    pollMs: 1,
    runDocker: async (args) => {
      runArgs.push([...args]);
      if (args[0] === "info") return { ok: true, output: "1" };
      if (args[0] === "ps") return { ok: true, output: "" };
      if (args[0] === "inspect") {
        return created ? { ok: true, output: `true|1|${OPENBOT_LOCAL_VM_IMAGE}` } : { ok: false, output: "" };
      }
      if (args[0] === "run") {
        created = true;
        return { ok: true, output: "id" };
      }
      if (args[0] === "start" || args[0] === "stop") return { ok: true, output: "" };
      return { ok: false, output: "" };
    },
  });
  const store = new GrokBotAccountStore(join(liveDirectory, "account.json"), cipher);
  await Effect.runPromise(store.save({ accessToken: ACCESS, refreshToken: REFRESH, gateway: null }));
  const options = { allowLoopback: false, localHost: host, fetchImpl };
  const createdAgent = await Effect.runPromise(
    createGrokBotAgent(store, { name: "OpenBot", description: "" }, options),
  );
  assert.equal(createdAgent.id, "sand-agent-e2e");
  const sent = await Effect.runPromise(
    sendGrokBotPrompt(store, { agentId: createdAgent.id, prompt: "hi", clientNonce: "nonce-e2e" }, options),
  );
  assert.equal(typeof sent, "object");
  const session = (await Effect.runPromise(store.load()))?.gateway;
  assert.ok(session);
  assert.equal(session.url, OPENBOT_LOCAL_GATEWAY_URL);
  assert.notEqual(session.token, ACCESS);
  const events = new AbortController();
  const stream = startGrokBotEventStream({
    session,
    signal: events.signal,
    fetchImpl,
    onEvent: () => undefined,
  });
  assert.equal(await stream.ready, "open");
  events.abort();
  await stream.done.catch(() => undefined);
  const exec = new AbortController();
  await runLocalExecClient({
    baseUrl: session.url,
    session: { token: session.token, headers: session.headers },
    signal: exec.signal,
    fetchImpl,
    hello: () => ({
      kind: "hello",
      localRoot: "/tmp",
      terminalsFolder: "/tmp",
      computerId: "this-computer",
      label: "e2e",
    }),
    onFrame: async () => null,
  }).catch(() => undefined);
  exec.abort();

  const run = runArgs.find((args) => args[0] === "run") ?? [];
  assert.equal(run.includes(OPENBOT_LOCAL_VM_CONTAINER), true);
  assert.equal(run.includes("BOTAI_ISOLATED_RUNTIME=1"), true);
  assert.equal(run.includes(OPENBOT_LOCAL_VM_IMAGE), true);
  assert.equal(run.includes("--restart"), true);
  assert.equal(run.includes("unless-stopped"), true);
  const publishes: string[] = [];
  for (let index = 0; index < run.length; index += 1) {
    if (run[index] === "--publish") publishes.push(run[index + 1] ?? "");
  }
  assert.deepEqual(publishes, [
    "127.0.0.1:1337:1337",
    "127.0.0.1:1339:1339",
    "127.0.0.1:1340:1340",
    "127.0.0.1:6080:6080",
    "127.0.0.1:6081:6081",
    "127.0.0.1:8790:8790",
  ]);
  assert.equal(
    run.some((arg) => arg.includes(session.token)),
    false,
  );
  assert.equal(
    run.some((arg) => arg.startsWith("0.0.0.0:")),
    false,
  );
  const mount = run.find((arg) => arg.startsWith("type=bind,src="));
  assert.ok(mount);
  const staged = mount.slice("type=bind,src=".length).split(",dst=")[0] ?? "";
  const stagedHost = readFileSync(join(staged, "host-main.cjs"), "utf8");
  assert.equal(stagedHost.includes("notifyOnAgentUpdates: true"), false);
  assert.equal(stagedHost.includes("DEFAULT_NOTIFY_ON_AGENT_UPDATES = false"), true);
  const envStat = statSync(join(liveDirectory, "openbot-local-vm.env"));
  assert.equal(envStat.mode & 0o777, 0o600);
  const tokenStat = statSync(join(liveDirectory, "openbot-local-vm.json"));
  assert.equal(tokenStat.mode & 0o777, 0o600);

  for (const url of requested) {
    assert.equal(url.includes("cursorvm.com"), false);
    assert.equal(url.includes("GrokBotService/EnsureSandBox"), false);
    const parsed = new URL(url);
    assert.equal(parsed.hostname, "127.0.0.1");
    assert.equal(parsed.port, "1340");
  }
  report.turnUrl = requested.find((url) => url.includes("/api/sendPrompt")) ?? "";
  report.eventUrl = requested.find((url) => url.endsWith("/events")) ?? "";
  report.createAgentUrl = requested.find((url) => url.includes("/api/createAgent")) ?? "";
  assert.equal(report.turnUrl.startsWith(`${OPENBOT_LOCAL_GATEWAY_URL}/api/sendPrompt`), true);
  assert.equal(report.eventUrl, `${OPENBOT_LOCAL_GATEWAY_URL}/events`);
  assert.equal(report.createAgentUrl, `${OPENBOT_LOCAL_GATEWAY_URL}/api/createAgent`);
  report.ensureSandBox = requested.filter((url) => url.includes("GrokBotService/EnsureSandBox")).length;
  report.cursorvm = requested.filter((url) => url.includes("cursorvm.com")).length;
  assert.equal(report.ensureSandBox, 0);
  assert.equal(report.cursorvm, 0);
  assert.equal(prompts, 2);
  assert.equal(
    authorizations.some((value) => value === `Bearer ${ACCESS}`),
    false,
  );
  const gatewayBearer = authorizations.find((value) => value === `Bearer ${session.token}`) ?? "";
  assert.equal(gatewayBearer, `Bearer ${session.token}`);
  report.localExecBearer = gatewayBearer.length > 0 ? "gateway" : "";
  await Effect.runPromise(host.stop());
  report.passed = true;
  await new Promise<void>((ready, reject) => peer.close((error) => (error ? reject(error) : ready())));
} catch (error) {
  report.blocked = error instanceof Error ? error.message : "isolated host check failed";
  throw error;
} finally {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
}

if (!report.passed) process.exit(1);
