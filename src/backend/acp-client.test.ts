import { Effect } from "effect";

import type { McpAuthorizationSource } from "./mcp-provider-shapes";
// @vitest-environment node

/*
 * The OpenCode driver's environment seam, through a real spawn.
 *
 * OpenCode's whole account is one variable: with `OPENCODE_API_KEY` the CLI lists the paid Go
 * catalog, without it the free one. Nothing else in OpenBot reads that variable, so this file spawns
 * a fake ACP agent that reports the environment it was given, and asserts what a user gets: free
 * models with no account, the paid list after a key is saved, and no forced sign-in in between.
 *
 * A custom endpoint travels the same way, on `OPENCODE_CONFIG_CONTENT`, so the same spawn record
 * answers what the CLI was told about the endpoints the user saved.
 */

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpServerConfig } from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { ACP_IDLE_SESSION_LIMIT, AcpAgentClient, type AcpHistoryPersistence } from "./acp-client";
import { isMissingProviderSessionError } from "./agent/thread-items";
import { VISIBLE_DYNAMIC_TOOLS } from "./agent/tool-catalog";
import { type AgentClient, AgentProcessExitError } from "./agent-client";
import type { OpencodeCliInfo } from "./cli";
import { runCauseEffect } from "./effect-boundary";
import type { CustomProviderConfig } from "./opencode-config";
import {
  decodeAccountReadResult,
  decodeModelListResponse,
  decodeRecordResponse,
  decodeThreadResponse,
} from "./protocol";
import { ProviderClientOperationError } from "./provider-client-effects";
import { requireProviderDriver } from "./provider-drivers";

const started: AgentClient[] = [];

afterEach(async () => {
  await Promise.all(started.splice(0).map((client) => runCauseEffect(client.stop()).catch(() => undefined)));
  // The fake agent reads its behaviour from the environment, so a stub left in place would decide
  // the next test as well.
  vi.unstubAllEnvs();
});

/** An ACP agent that answers `initialize` and `session/new`, and records the env it was spawned with. */
const FAKE_AGENT = `#!/usr/bin/env node
const fs = require("node:fs");
const NL = String.fromCharCode(10);
const envLog = process.env.OPENBOT_FAKE_ACP_ENV_LOG;
if (envLog) {
  fs.appendFileSync(
    envLog,
    JSON.stringify({
      argv: process.argv.slice(2),
      apiKey: process.env.OPENCODE_API_KEY ?? null,
      disableAutoupdate: process.env.OPENCODE_DISABLE_AUTOUPDATE ?? null,
      configContent: process.env.OPENCODE_CONFIG_CONTENT ?? null,
    }) + NL,
  );
}
let buffer = "";
// An agent of the second kind: no \`models\` in \`session/new\`, one \`model\` config option, and a
// \`thought_level\` option that exists only while the session is on a model that reasons. OpenCode
// works this way, and \`minimal\` next to \`low\` is its own naming.
const FAILING_MODEL = process.env.OPENBOT_FAKE_ACP_CONFIG_FAIL ?? null;
const HANGING_MODEL = process.env.OPENBOT_FAKE_ACP_CONFIG_HANG ?? null;
// OpenCode's MiniMax M3: thinking is on or off, and there is no other level.
const SWITCH_MODEL = process.env.OPENBOT_FAKE_ACP_CONFIG_SWITCH ?? null;
const CONFIG_MODELS = [
  ...(FAILING_MODEL ? [FAILING_MODEL] : []),
  "agent/thinker",
  ...(HANGING_MODEL ? [HANGING_MODEL] : []),
  "agent/plain",
  ...(SWITCH_MODEL ? [SWITCH_MODEL] : []),
];
const THOUGHT_LEVELS = ["minimal", "low", "medium", "high", "xhigh", "default"];
let selected = CONFIG_MODELS[0];
let sessionCount = 0;
let discoveryCount = 0;
let loadCount = 0;
let compact = false;
const additionalOptions = () => process.env.OPENBOT_FAKE_ACP_SETTINGS === "1" ? [
  { id: "compact", name: "Compact replies", type: "boolean", currentValue: compact },
  { id: "tone", name: "Tone", category: "model_config", type: "select", currentValue: "short", options: [
    { group: "style", name: "Style", options: [{ value: "short", name: "Short" }, { value: "full", name: "Full" }] },
  ] },
  { id: "approval", name: "Approval policy", type: "boolean", currentValue: false },
  { id: "session_mode", name: "Mode", type: "select", currentValue: "default", options: [{ value: "default", name: "Default" }] },
  { id: "autoApprove", name: "Auto approve", type: "boolean", currentValue: false },
  { id: "behavior", name: "Behavior", type: "select", currentValue: "normal", options: [{ value: "normal", name: "Normal" }, { value: "bypassPermissions", name: "Fast" }] },
  { id: "execution", name: "Execution", type: "select", currentValue: "ask", options: [{ group: "execution", name: "Execution", options: [{ value: "ask", name: "Ask" }, { value: "yolo", name: "Automatic" }] }] },
  { id: "operating", name: "Operating mode", category: "mode", type: "select", currentValue: "ask", options: [{value: "ask", name: "Ask"}, {value: "auto", name: "Auto"}] },
] : [];
const SERVICE_FAILURE = {
  code: -32603,
  message: "Internal error: OpenCode service failure",
  data: { service: "session" },
};
const configOptions = () => [
  ...additionalOptions(),
  {
    id: "model",
    name: "Model",
    category: "model",
    type: "select",
    currentValue: selected,
    options: CONFIG_MODELS.map((value) => ({ value, name: value })),
  },
  ...(selected === "agent/thinker"
    ? [
        {
          id: "effort",
          name: "Effort",
          category: "thought_level",
          type: "select",
          currentValue: "minimal",
          options: THOUGHT_LEVELS.map((value) => ({ value, name: value })),
        },
      ]
    : selected === SWITCH_MODEL
      ? [
          {
            id: "effort",
            name: "Effort",
            category: "thought_level",
            type: "select",
            currentValue: "none",
            options: ["none", "thinking", "default"].map((value) => ({ value, name: value })),
          },
        ]
      : []),
];
const write = (message) => process.stdout.write(JSON.stringify(message) + NL);
process.stdout.on("error", (error) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  // A CLI that fails at start: it reads the request, says why on stderr, and exits unanswered.
  if (process.env.OPENBOT_FAKE_ACP_CRASH) {
    process.stderr.write("Error: " + process.env.OPENBOT_FAKE_ACP_CRASH + NL);
    process.exit(3);
  }
  buffer += chunk;
  let index = buffer.indexOf(NL);
  while (index >= 0) {
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    if (line.trim()) handle(JSON.parse(line));
    index = buffer.indexOf(NL);
  }
});
function handle(message) {
  if (typeof message.id === "undefined") return;
  if (message.method === "initialize") {
    const agentCapabilities = process.env.OPENBOT_FAKE_ACP_RESUME
      ? { sessionCapabilities: { resume: {} } }
      : process.env.OPENBOT_FAKE_ACP_CLOSE_LOG
      ? { loadSession: true, sessionCapabilities: { close: {} } }
      : process.env.OPENBOT_FAKE_ACP_LIST
        ? { loadSession: true, sessionCapabilities: { list: {} } }
        : process.env.OPENBOT_FAKE_ACP_LOAD_SESSION === "1"
          ? { loadSession: true }
          : {};
    write({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: 1, agentCapabilities } });
    return;
  }
  // "fail" is an internal server that fails every call, as OpenCode reports it. "paged" holds
  // "ses_stored" on its second page.
  if (message.method === "session/list") {
    const mode = process.env.OPENBOT_FAKE_ACP_LIST;
    if (mode === "fail") {
      write({ jsonrpc: "2.0", id: message.id, error: SERVICE_FAILURE });
      return;
    }
    const cwd = message.params.cwd;
    const result =
      mode !== "paged"
        ? { sessions: [] }
        : message.params.cursor === "page-2"
          ? { sessions: [{ sessionId: "ses_stored", cwd }] }
          : { sessions: [{ sessionId: "ses_other", cwd }], nextCursor: "page-2" };
    write({ jsonrpc: "2.0", id: message.id, result });
    return;
  }
  if (message.method === "session/load") {
    const loadLog = process.env.OPENBOT_FAKE_ACP_LOAD_LOG;
    if (loadLog) fs.appendFileSync(loadLog, JSON.stringify(message.params) + NL);
    if (process.env.OPENBOT_FAKE_ACP_LOAD_ERROR) {
      write({ jsonrpc: "2.0", id: message.id, error: JSON.parse(process.env.OPENBOT_FAKE_ACP_LOAD_ERROR) });
      return;
    }
    // OpenCode's answer when its internal server fails the lookup, a session missing from its
    // store included.
    loadCount += 1;
    if (loadCount <= Number(process.env.OPENBOT_FAKE_ACP_LOAD_FAIL ?? 0)) {
      write({ jsonrpc: "2.0", id: message.id, error: SERVICE_FAILURE });
      return;
    }
    if (process.env.OPENBOT_FAKE_ACP_REPLAY) {
      const count = Number(process.env.OPENBOT_FAKE_ACP_REPLAY_COUNT ?? 1);
      for (let index = 0; index < count; index += 1) {
        write({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: message.params.sessionId,
            update: {
              sessionUpdate: "agent_message_chunk",
              messageId: "replayed-message-" + index,
              content: { type: "text", text: "Restored" },
            },
          },
        });
      }
      if (process.env.OPENBOT_FAKE_ACP_REPLAY_READY)
        fs.writeFileSync(process.env.OPENBOT_FAKE_ACP_REPLAY_READY, "ready");
    }
    write({ jsonrpc: "2.0", id: message.id, result: {} });
    return;
  }
  if (message.method === "session/resume") {
    // Grok's answer: it does not advertise additionalDirectories and refuses them on resume.
    if (message.params.additionalDirectories?.length) {
      write({ jsonrpc: "2.0", id: message.id, error: { code: -32602, message: "Invalid params",
        data: "session/resume does not support additionalDirectories" } });
      return;
    }
    write({ jsonrpc: "2.0", id: message.id, result: {} });
    return;
  }
  if (message.method === "session/close") {
    if (process.env.OPENBOT_FAKE_ACP_IGNORE_CLOSE === "1") return;
    const closeLog = process.env.OPENBOT_FAKE_ACP_CLOSE_LOG;
    if (closeLog) fs.appendFileSync(closeLog, JSON.stringify(message.params) + NL);
    write({ jsonrpc: "2.0", id: message.id, result: {} });
    return;
  }
  if (message.method === "session/prompt" && process.env.OPENBOT_FAKE_ACP_PROMPT_LOG)
    fs.appendFileSync(process.env.OPENBOT_FAKE_ACP_PROMPT_LOG, JSON.stringify(message.params) + NL);
  const failureFile = process.env.OPENBOT_FAKE_ACP_FAILURE_FILE;
  if (failureFile && fs.existsSync(failureFile)) {
    const failure = JSON.parse(fs.readFileSync(failureFile, "utf8"));
    if (message.method === failure.method) {
      write({ jsonrpc: "2.0", id: message.id, error: failure.error });
      return;
    }
  }
  if (message.method === "session/prompt") {
    if (process.env.OPENBOT_FAKE_ACP_PROMPT_TOOL) {
      write({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: message.params.sessionId,
          update: {
            sessionUpdate: "tool_call",
            toolCallId: "tool-1",
            title: "Read README.md",
            name: "read_file",
            kind: "read",
            status: "in_progress",
            rawInput: { path: "README.md" },
            locations: [{ path: "/private/tool-history/README.md" }],
          },
        },
      });
      write({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: message.params.sessionId,
          update: {
            sessionUpdate: "tool_call_update",
            toolCallId: "tool-1",
            status: "completed",
            rawOutput: { text: "OpenBot" },
            locations: [{ path: "/private/tool-history/updated.md" }],
          },
        },
      });
    }
    if (process.env.OPENBOT_FAKE_ACP_PROMPT_OUTPUT) {
      write({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: message.params.sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            messageId: "prompt-message",
            content: { type: "text", text: "Answer" },
          },
        },
      });
    }
    write({ jsonrpc: "2.0", id: message.id, result: { stopReason: "end_turn" } });
    return;
  }
  if (message.method === "session/set_config_option") {
    const configLog = process.env.OPENBOT_FAKE_ACP_CONFIG_LOG;
    if (configLog) fs.appendFileSync(configLog, JSON.stringify(message.params) + NL);
    // No answer at all, which is what a hung agent gives.
    if (message.params.value === HANGING_MODEL) return;
    if (message.params.value === FAILING_MODEL) {
      write({ jsonrpc: "2.0", id: message.id, error: { code: -32000, message: "Model unavailable." } });
      return;
    }
    if (message.params.configId === "model") selected = message.params.value;
    if (message.params.configId === "compact") compact = message.params.value;
    write({ jsonrpc: "2.0", id: message.id, result: { configOptions: configOptions() } });
    if (message.params.configId === "compact") {
      compact = false;
      write({ jsonrpc: "2.0", method: "session/update", params: { sessionId: message.params.sessionId,
        update: { sessionUpdate: "config_option_update", configOptions: configOptions() } } });
    }
    return;
  }
  if (message.method === "session/new") {
    const sessionLog = process.env.OPENBOT_FAKE_ACP_SESSION_LOG;
    if (sessionLog) fs.appendFileSync(sessionLog, JSON.stringify(message.params) + NL);
    discoveryCount += 1;
    if (process.env.OPENBOT_FAKE_ACP_FAIL_MODEL_REFRESH === "1" && discoveryCount > 1) {
      write({ jsonrpc: "2.0", id: message.id, error: { code: -32000, message: "Temporary discovery failure." } });
      return;
    }
    if (process.env.OPENBOT_FAKE_ACP_REJECT_KEY === "1") {
      write({ jsonrpc: "2.0", id: message.id, error: { code: -32000, message: "Invalid api key." } });
      return;
    }
    if (process.env.OPENBOT_FAKE_ACP_CONFIG_MODELS === "1") {
      selected = CONFIG_MODELS[0];
      write({ jsonrpc: "2.0", id: message.id, result: { sessionId: "session-1", configOptions: configOptions() } });
      return;
    }
    if (process.env.OPENBOT_FAKE_ACP_EMPTY_MODELS === "1") {
      write({ jsonrpc: "2.0", id: message.id, result: { sessionId: "session-1" } });
      return;
    }
    const ids = process.env.OPENCODE_API_KEY
      ? ["opencode-go/go-one", "opencode-go/go-two", "opencode-go/go-three"]
      : ["opencode/big-pickle"];
    write({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        // An agent that closes sessions is asked for several, and each needs its own id.
        sessionId: process.env.OPENBOT_FAKE_ACP_CLOSE_LOG ? "session-" + ++sessionCount : "session-1",
        models: { availableModels: ids.map((modelId) => ({ modelId, name: modelId })), currentModelId: ids[0] },
      },
    });
    return;
  }
  write({ jsonrpc: "2.0", id: message.id, result: {} });
}
`;

interface FakeOpencode {
  cli: OpencodeCliInfo;
  directory: string;
  envLog: string;
  promptLog: string;
  configLog: string;
  loadLog: string;
  readLoadedSessions: () => Promise<Array<{ sessionId: string; cwd: string }>>;
  readPrompts: () => Promise<string[]>;
  readConfigCalls: () => Promise<Array<{ configId: string; value: string }>>;
  readSpawnEnvironments: () => Promise<
    Array<{
      argv: string[];
      apiKey: string | null;
      disableAutoupdate: string | null;
      configContent: string | null;
    }>
  >;
}

/**
 * The fake agent, written once for this file and not once for each test. macOS checks an executable
 * the first time it runs from a new path, and that check cost about 200 ms in each test that wrote
 * its own copy. The agent reads its behaviour and its log paths from the environment, so each test
 * still gets its own directory for the logs.
 */
let fakeAgentDirectory: Promise<string> | null = null;
const FAKE_AGENT_NAME = process.platform === "win32" ? "opencode.cmd" : "opencode";

afterAll(async () => {
  if (fakeAgentDirectory) await rm(await fakeAgentDirectory, { recursive: true, force: true });
});

async function fakeAgentExecutable(): Promise<string> {
  fakeAgentDirectory ??= (async () => {
    const directory = await mkdtemp(join(tmpdir(), "openbot-acp-opencode-cli-"));
    const executable = join(directory, FAKE_AGENT_NAME);
    if (process.platform === "win32") {
      const script = join(directory, "fake-opencode.js");
      await writeFile(script, FAKE_AGENT);
      await writeFile(executable, `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`);
    } else {
      await writeFile(executable, FAKE_AGENT, { mode: 0o755 });
    }
    return directory;
  })();
  return join(await fakeAgentDirectory, FAKE_AGENT_NAME);
}

async function createFakeOpencodeAgent(source?: "system" | "managed"): Promise<FakeOpencode> {
  const directory = await mkdtemp(join(tmpdir(), "openbot-acp-opencode-"));
  const executable = await fakeAgentExecutable();
  const envLog = join(directory, "spawn-env.ndjson");
  const promptLog = join(directory, "prompts.ndjson");
  const configLog = join(directory, "config-options.ndjson");
  const loadLog = join(directory, "loaded-sessions.ndjson");
  return {
    cli: { executable, version: "1.18.30", ...(source ? { source } : {}) },
    directory,
    envLog,
    promptLog,
    configLog,
    loadLog,
    readLoadedSessions: async () => {
      const source = await readFile(loadLog, "utf8").catch(() => "");
      return source
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line));
    },
    readPrompts: async () => {
      const source = await readFile(promptLog, "utf8").catch(() => "");
      return source.split("\n").filter((line) => line.trim());
    },
    readConfigCalls: async () => {
      const source = await readFile(configLog, "utf8").catch(() => "");
      return source
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line));
    },
    readSpawnEnvironments: async () => {
      const source = await readFile(envLog, "utf8").catch(() => "");
      return source
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line));
    },
  };
}

function startOpencode(
  cli: OpencodeCliInfo,
  apiKey: () => string | null,
  envLog: string,
  options: {
    /** Read at every spawn, so a test can save an endpoint between two processes. */
    customProviders?: () => CustomProviderConfig[];
    /** The one-shot client that generates a profile, which must stay unable to act. */
    profile?: boolean;
    /** Read at every prompt, so a test can remove an endpoint while a turn is prepared. */
    servesModel?: (modelId: string) => boolean;
    /** Read at every session, the same way the real source is. */
    mcpServers?: () => McpServerConfig[];
    /** The bearer token a signed-in http server is given, minted at the hand-off and never stored. */
    mcpAuthorization?: McpAuthorizationSource;
    /** How long one request may take, which is also the deadline model discovery works inside. */
    requestTimeoutMs?: number;
    history?: AcpHistoryPersistence;
  } = {},
): AgentClient {
  vi.stubEnv("OPENBOT_FAKE_ACP_ENV_LOG", envLog);
  const driver = requireProviderDriver("opencode");
  const context = {
    apiKey,
    customProviders: options.customProviders ?? (() => []),
    mcpServers: options.mcpServers ?? (() => []),
    ...(options.mcpAuthorization === undefined ? {} : { mcpAuthorization: options.mcpAuthorization }),
    ...(options.servesModel === undefined ? {} : { servesModel: options.servesModel }),
    ...(options.history === undefined ? {} : { history: () => options.history }),
  };
  const timeoutMs = options.requestTimeoutMs ?? 10_000;
  const client = options.profile
    ? (driver.createProfileClient?.(cli, timeoutMs, context) ?? driver.createClient(cli, timeoutMs, context))
    : driver.createClient(cli, timeoutMs, context);
  started.push(client);
  client.start();
  return client;
}

function customProvider(): CustomProviderConfig {
  return {
    id: "studio-local",
    name: "Studio Local",
    baseUrl: "http://127.0.0.1:11434/v1",
    apiKey: "test-key",
    models: [{ id: "qwen3-coder:30b", name: "Qwen3 Coder 30B" }],
    headers: [],
  };
}

describe("OpenCode ACP environment", () => {
  it("spawns the free tier without the key variable at all", async () => {
    const fake = await createFakeOpencodeAgent("system");
    const client = startOpencode(fake.cli, () => null, fake.envLog);

    await runCauseEffect(client.request("initialize", {}, decodeRecordResponse));

    // An empty `OPENCODE_API_KEY` is not the same as an absent one: the CLI reads it as an account
    // and lists nothing. A user with no account has to see the variable missing.
    const [environment] = await fake.readSpawnEnvironments();
    expect(environment).toEqual({ argv: ["acp"], apiKey: null, disableAutoupdate: null, configContent: null });
    const account = await runCauseEffect(
      client.request("account/read", { refreshToken: false }, decodeAccountReadResult),
    );
    expect(account.account).not.toBeNull();
    const models = await runCauseEffect(client.request("model/list", {}, decodeModelListResponse));
    expect(models.data.map((model) => model.model)).toEqual(["opencode/big-pickle"]);
  });

  it("keeps the initialized model list when a later refresh fails", async () => {
    const fake = await createFakeOpencodeAgent("system");
    vi.stubEnv("OPENBOT_FAKE_ACP_FAIL_MODEL_REFRESH", "1");
    const client = startOpencode(fake.cli, () => null, fake.envLog);

    const models = await runCauseEffect(client.request("model/list", {}, decodeModelListResponse));

    // Initialization discovered this model successfully. The next `model/list` refresh fails, but
    // that temporary failure must not erase the catalogue users can already select.
    expect(models.data.map((model) => model.model)).toEqual(["opencode/big-pickle"]);
  });

  it("reads the key at every spawn, so a key saved later reaches the next process", async () => {
    const fake = await createFakeOpencodeAgent("system");
    let key: string | null = null;
    // One client across both spawns, which is what makes this about the spawn and not the client:
    // the key is read while the process is created, so the same client picks up a later save.
    const client = startOpencode(fake.cli, () => key, fake.envLog);
    await runCauseEffect(client.request("initialize", {}, decodeRecordResponse));
    await runCauseEffect(client.stop());

    key = "go-key-value";
    client.start();
    await runCauseEffect(client.request("initialize", {}, decodeRecordResponse));

    const environments = await fake.readSpawnEnvironments();
    expect(environments.map((environment) => environment.apiKey)).toEqual([null, "go-key-value"]);
    const models = await runCauseEffect(client.request("model/list", {}, decodeModelListResponse));
    expect(models.data.map((model) => model.model)).toEqual([
      "opencode-go/go-one",
      "opencode-go/go-two",
      "opencode-go/go-three",
    ]);
  });

  it("stops a managed install from updating itself past the pin", async () => {
    const managed = await createFakeOpencodeAgent("managed");
    const client = startOpencode(managed.cli, () => null, managed.envLog);
    await runCauseEffect(client.request("initialize", {}, decodeRecordResponse));

    // `verifyInstalledRuntime` compares the reported version with the pin for exact equality, so a
    // CLI that self-updates would leave OpenBot re-downloading a runtime it already has.
    expect((await managed.readSpawnEnvironments())[0]?.disableAutoupdate).toBe("1");
  });

  it("leaves the CLI a user installed free to update itself", async () => {
    const system = await createFakeOpencodeAgent("system");
    const client = startOpencode(system.cli, () => null, system.envLog);
    await runCauseEffect(client.request("initialize", {}, decodeRecordResponse));

    expect((await system.readSpawnEnvironments())[0]?.disableAutoupdate).toBeNull();
  });

  it("reports no account when OpenCode rejects the key", async () => {
    const fake = await createFakeOpencodeAgent("system");
    vi.stubEnv("OPENBOT_FAKE_ACP_REJECT_KEY", "1");
    const client = startOpencode(fake.cli, () => "not-a-key", fake.envLog);

    await runCauseEffect(client.request("initialize", {}, decodeRecordResponse));

    // A rejected key has to read as "sign in again", not as a broken CLI: this null account is what
    // `provider-runtime` turns into `sign-in-required` with the provider's own message.
    const account = await runCauseEffect(
      client.request("account/read", { refreshToken: false }, decodeAccountReadResult),
    );
    expect(account.account).toBeNull();
  });

  it("spawns the ACP process with the custom endpoints the user saved", async () => {
    const fake = await createFakeOpencodeAgent("system");
    const client = startOpencode(fake.cli, () => null, fake.envLog, { customProviders: () => [customProvider()] });

    await runCauseEffect(client.request("initialize", {}, decodeRecordResponse));

    const [environment] = await fake.readSpawnEnvironments();
    expect(JSON.parse(environment?.configContent ?? "")).toEqual({
      provider: {
        "studio-local": {
          npm: "@ai-sdk/openai-compatible",
          name: "Studio Local",
          options: { baseURL: "http://127.0.0.1:11434/v1", apiKey: "test-key" },
          models: { "qwen3-coder:30b": { name: "Qwen3 Coder 30B" } },
        },
      },
    });
  });

  it("reads the endpoints at every spawn, so one saved later reaches the next process", async () => {
    const fake = await createFakeOpencodeAgent("system");
    const providers: CustomProviderConfig[] = [];
    // One `opencode acp` process serves the whole app, so a saved endpoint can only reach it through
    // a respawn of a client that was built long before the save.
    const client = startOpencode(fake.cli, () => null, fake.envLog, { customProviders: () => providers });
    await runCauseEffect(client.request("initialize", {}, decodeRecordResponse));
    await runCauseEffect(client.stop());

    providers.push(customProvider());
    client.start();
    await runCauseEffect(client.request("initialize", {}, decodeRecordResponse));

    const environments = await fake.readSpawnEnvironments();
    // No endpoint means no config layer at all: an empty layer is not the same as no layer.
    expect(environments[0]?.configContent).toBeNull();
    expect(environments[1]?.configContent).toContain("studio-local");
  });

  it("keeps the deny-all layer while a profile client carries an endpoint", async () => {
    // Profile generation must not let the model act. Both layers travel on one environment variable,
    // so a custom endpoint that replaced the layer rather than joining it would give a one-shot
    // prompt full permissions.
    const fake = await createFakeOpencodeAgent("system");
    const client = startOpencode(fake.cli, () => null, fake.envLog, {
      customProviders: () => [customProvider()],
      profile: true,
    });

    await runCauseEffect(client.request("initialize", {}, decodeRecordResponse));

    const config = JSON.parse((await fake.readSpawnEnvironments())[0]?.configContent ?? "");
    expect(config.permission).toEqual({ "*": "deny" });
    expect(Object.keys(config.provider)).toEqual(["studio-local"]);
  });

  it("refuses to start on an OpenCode that lists no model at all", async () => {
    const fake = await createFakeOpencodeAgent("managed");
    vi.stubEnv("OPENBOT_FAKE_ACP_EMPTY_MODELS", "1");
    const client = startOpencode(fake.cli, () => null, fake.envLog);

    // Not an authentication failure, so it is not softened into "sign in": an empty catalog is a CLI
    // OpenBot cannot drive, and guessing a model id here would send every prompt to a model the CLI
    // rejects. The provider row reports it as a failed connection.
    await expect(runCauseEffect(client.request("initialize", {}, decodeRecordResponse))).rejects.toThrow(
      "ACP CLI did not advertise any ACP models. OpenBot will not guess a fallback model.",
    );
  });

  it("reports why OpenCode stopped instead of a closed connection", async () => {
    const fake = await createFakeOpencodeAgent("managed");
    vi.stubEnv("OPENBOT_FAKE_ACP_CRASH", "config key OPENCODE_API_KEY=sk-live-secret is invalid");
    const client = startOpencode(fake.cli, () => null, fake.envLog);

    // The SDK rejects with "ACP connection closed" as soon as stdout ends. That phrase was all a user
    // saw when an update's CLI failed to start, so the exit and the CLI's own reason replace it.
    const failure = runCauseEffect(client.request("initialize", {}, decodeRecordResponse));
    await expect(failure).rejects.toBeInstanceOf(AgentProcessExitError);
    await expect(failure).rejects.toThrow("OpenCode stopped before it answered (exit code 3).");
    const error = await failure.catch((reason: unknown) => reason);
    if (!(error instanceof AgentProcessExitError)) throw error;
    const reported = error.withDetail((text) => text).message;
    expect(reported).toMatch(/^OpenCode stopped before it answered \(exit code 3\)\. Error: config key /u);
    expect(reported).not.toContain("sk-live-secret");
  });

  it("refuses the prompt when the endpoint was removed while the turn was prepared", async () => {
    const fake = await createFakeOpencodeAgent("system");
    vi.stubEnv("OPENBOT_FAKE_ACP_PROMPT_LOG", fake.promptLog);
    // The endpoint is still saved while the thread is opened, and gone when the prompt would leave.
    let served = true;
    const client = startOpencode(fake.cli, () => null, fake.envLog, { servesModel: () => served });
    await runCauseEffect(client.request("initialize", {}, decodeRecordResponse));
    const thread = await runCauseEffect(
      client.request("thread/start", { cwd: tmpdir(), runtimeWorkspaceRoots: [tmpdir()] }, decodeRecordResponse),
    );
    const threadId = isDynamicRecord(thread.thread) ? thread.thread.id : null;
    if (typeof threadId !== "string") throw new Error("The fake agent opened no thread.");

    served = false;
    await expect(
      runCauseEffect(
        client.request(
          "turn/start",
          { threadId, clientUserMessageId: "delivery-1", input: [{ type: "inputText", text: "Keep working" }] },
          decodeRecordResponse,
        ),
      ),
    ).rejects.toThrow("The endpoint this agent used was removed. Choose another model for it.");

    // Nothing reached the process, which still holds the session it opened on that endpoint.
    expect(await fake.readPrompts()).toEqual([]);
  });
});

describe("ACP session settings", () => {
  // Failure mode: a saved option removed by a provider update prevents all future prompts.
  it("applies only available saved settings without blocking the next prompt", async () => {
    const fake = await createFakeOpencodeAgent("system");
    vi.stubEnv("OPENBOT_FAKE_ACP_CONFIG_MODELS", "1");
    vi.stubEnv("OPENBOT_FAKE_ACP_SETTINGS", "1");
    vi.stubEnv("OPENBOT_FAKE_ACP_CONFIG_LOG", fake.configLog);
    vi.stubEnv("OPENBOT_FAKE_ACP_PROMPT_LOG", fake.promptLog);
    const client = startOpencode(fake.cli, () => null, fake.envLog);
    const { thread } = await runCauseEffect(
      client.request("thread/start", { cwd: fake.directory }, decodeThreadResponse),
    );
    await runCauseEffect(
      client.request(
        "turn/start",
        {
          threadId: thread.id,
          clientUserMessageId: "saved-options",
          input: [{ type: "inputText", text: "Continue" }],
          sessionSettings: { removed: true, tone: "removed-choice", compact: true },
        },
        decodeRecordResponse,
      ),
    );
    await vi.waitFor(async () => expect(await fake.readPrompts()).toHaveLength(1));
    const changes = await fake.readConfigCalls();
    expect(changes).toContainEqual(expect.objectContaining({ configId: "compact", value: true }));
    expect(changes.some((change) => change.configId === "removed" || change.configId === "tone")).toBe(false);
  });

  // Failure modes: a setting bypasses approval, an invalid choice reaches the agent, or an idle
  // option update is lost. This test uses the real ACP process and stream for all three paths.
  it("keeps permission controls private and accepts configuration updates while idle", async () => {
    const fake = await createFakeOpencodeAgent("system");
    vi.stubEnv("OPENBOT_FAKE_ACP_CONFIG_MODELS", "1");
    vi.stubEnv("OPENBOT_FAKE_ACP_SETTINGS", "1");
    vi.stubEnv("OPENBOT_FAKE_ACP_CONFIG_LOG", fake.configLog);
    const client = startOpencode(fake.cli, () => null, fake.envLog);
    const { thread } = await runCauseEffect(
      client.request("thread/start", { cwd: fake.directory }, decodeThreadResponse),
    );
    if (!client.readSessionSettings || !client.setSessionSetting) throw new Error("ACP settings are unavailable.");
    const snapshot = await runCauseEffect(client.readSessionSettings(thread.id));
    expect(snapshot.options).toEqual([
      { id: "compact", name: "Compact replies", type: "boolean", currentValue: false },
      {
        id: "tone",
        name: "Tone",
        category: "model_config",
        type: "select",
        currentValue: "short",
        options: [
          { value: "short", name: "Short", group: "Style" },
          { value: "full", name: "Full", group: "Style" },
        ],
      },
    ]);
    await expect(runCauseEffect(client.setSessionSetting(thread.id, "approval", true))).rejects.toThrow(
      sourceText("error.provider.sessionSettingUnavailable"),
    );
    await expect(runCauseEffect(client.setSessionSetting(thread.id, "operating", "auto"))).rejects.toThrow(
      sourceText("error.provider.sessionSettingUnavailable"),
    );
    for (const [id, value] of [
      ["session_mode", "default"],
      ["autoApprove", true],
      ["behavior", "bypassPermissions"],
      ["execution", "yolo"],
    ] as const) {
      await expect(runCauseEffect(client.setSessionSetting(thread.id, id, value))).rejects.toThrow(
        sourceText("error.provider.sessionSettingUnavailable"),
      );
    }
    await expect(runCauseEffect(client.setSessionSetting(thread.id, "tone", "invalid"))).rejects.toThrow(
      sourceText("error.provider.sessionSettingInvalid"),
    );
    await expect(runCauseEffect(client.setSessionSetting(thread.id, "compact", "true"))).rejects.toThrow(
      sourceText("error.provider.sessionSettingInvalid"),
    );
    const idleUpdate = new Promise<void>((resolve) => {
      const onNotification = (notification: import("./protocol").AppServerNotification) => {
        if (notification.method !== "openbot/sessionSettings/updated") return;
        const params = notification.params;
        if (!isDynamicRecord(params) || !Array.isArray(params.options)) return;
        if (
          params.options.some(
            (option) => isDynamicRecord(option) && option.id === "compact" && option.currentValue === false,
          )
        ) {
          client.off("notification", onNotification);
          resolve();
        }
      };
      client.on("notification", onNotification);
    });
    await runCauseEffect(client.setSessionSetting(thread.id, "compact", true));
    await idleUpdate;
    expect(
      (await runCauseEffect(client.readSessionSettings(thread.id))).options.find((option) => option.id === "compact")
        ?.currentValue,
    ).toBe(false);
    const calls = await fake.readConfigCalls();
    expect(
      calls.filter((call) =>
        ["approval", "operating", "tone", "session_mode", "autoApprove", "behavior", "execution"].includes(
          call.configId,
        ),
      ),
    ).toEqual([]);
  });
});

describe("OpenCode ACP reasoning efforts", () => {
  it("reports the efforts of each model, not the efforts of the model the session opened on", async () => {
    const fake = await createFakeOpencodeAgent("system");
    vi.stubEnv("OPENBOT_FAKE_ACP_CONFIG_MODELS", "1");
    vi.stubEnv("OPENBOT_FAKE_ACP_CONFIG_LOG", fake.configLog);
    vi.stubEnv("OPENBOT_FAKE_ACP_CONFIG_SWITCH", "agent/switch");
    const client = startOpencode(fake.cli, () => null, fake.envLog);

    const models = await runCauseEffect(client.request("model/list", {}, decodeModelListResponse));

    // `thought_level` describes the model the session is on, and a new session is on one model. Read
    // without a probe per model, the whole catalog carried that one answer: the Effort menu offered
    // `Medium` alone for a model that reasons from minimal to xhigh.
    expect(
      models.data.map((model) => [
        model.model,
        model.supportedReasoningEfforts?.map((effort) => effort.reasoningEffort),
        model.reasoningEffortConfigurable,
      ]),
    ).toEqual([
      ["agent/thinker", ["low", "medium", "high", "xhigh"], undefined],
      // A model the agent gives no `thought_level` for keeps `medium` for older clients, and says
      // that the agent, not the user, decides its reasoning: nothing is sent for it.
      ["agent/plain", ["medium"], false],
      // `low` alone was thinking off, with no way to turn it on.
      ["agent/switch", ["low", "high"], undefined],
    ]);
    // The sweep ends on the model the session opened on. An agent that remembers a last used model
    // outside the session would otherwise start the user's own next session on `agent/plain`.
    expect((await fake.readConfigCalls()).at(-1)).toEqual({
      sessionId: "session-1",
      configId: "model",
      value: "agent/thinker",
    });
  });

  it("keeps reading the rest of the catalog when one model refuses to be selected", async () => {
    const fake = await createFakeOpencodeAgent("system");
    vi.stubEnv("OPENBOT_FAKE_ACP_CONFIG_MODELS", "1");
    vi.stubEnv("OPENBOT_FAKE_ACP_CONFIG_LOG", fake.configLog);
    // The session opens on this model, and the agent rejects every attempt to select it.
    vi.stubEnv("OPENBOT_FAKE_ACP_CONFIG_FAIL", "agent/broken");
    const client = startOpencode(fake.cli, () => null, fake.envLog);

    const models = await runCauseEffect(client.request("model/list", {}, decodeModelListResponse));

    // A model an agent will not answer for keeps the efforts the session published, and costs the
    // models after it nothing: a catalog is what the user picks from, so one refusal must not empty it.
    expect(
      models.data.map((model) => [
        model.model,
        model.supportedReasoningEfforts?.map((effort) => effort.reasoningEffort),
      ]),
    ).toEqual([
      ["agent/broken", ["medium"]],
      ["agent/thinker", ["low", "medium", "high", "xhigh"]],
      ["agent/plain", ["medium"]],
    ]);
  });

  it("returns the catalog when a model's probe never answers", async () => {
    const fake = await createFakeOpencodeAgent("system");
    vi.stubEnv("OPENBOT_FAKE_ACP_CONFIG_MODELS", "1");
    vi.stubEnv("OPENBOT_FAKE_ACP_CONFIG_LOG", fake.configLog);
    // The agent accepts the selection of this model and then says nothing more about it.
    vi.stubEnv("OPENBOT_FAKE_ACP_CONFIG_HANG", "agent/silent");
    const client = startOpencode(fake.cli, () => null, fake.envLog, { requestTimeoutMs: 4_000 });

    const models = await runCauseEffect(client.request("model/list", {}, decodeModelListResponse));

    // The sweep runs inside the caller's own timeout, so a probe that never answers has to end
    // before that timeout does. A sweep that waited for it would time `model/list` out, and the
    // user would have no models to pick from instead of one model with imprecise efforts.
    expect(
      models.data.map((model) => [
        model.model,
        model.supportedReasoningEfforts?.map((effort) => effort.reasoningEffort),
      ]),
    ).toEqual([
      ["agent/thinker", ["low", "medium", "high", "xhigh"]],
      // What the session published, which is the efforts of the model it opened on.
      ["agent/silent", ["low", "medium", "high", "xhigh"]],
      // The model after the silent one keeps its own answer: one probe ends, not the sweep.
      ["agent/plain", ["medium"]],
    ]);
  });

  it("sends the agent's own low effort, not the lowest effort the model has", async () => {
    const fake = await createFakeOpencodeAgent("system");
    vi.stubEnv("OPENBOT_FAKE_ACP_CONFIG_MODELS", "1");
    vi.stubEnv("OPENBOT_FAKE_ACP_CONFIG_LOG", fake.configLog);
    const client = startOpencode(fake.cli, () => null, fake.envLog);

    await runCauseEffect(
      client.request(
        "thread/start",
        { cwd: tmpdir(), runtimeWorkspaceRoots: [tmpdir()], model: "agent/thinker", effort: "low" },
        decodeRecordResponse,
      ),
    );

    // `minimal` also reads as low effort and comes first in the agent's list, so a first-match
    // mapping sent the model's lowest setting whenever the user asked for low.
    expect((await fake.readConfigCalls()).slice(-2)).toEqual([
      { sessionId: "session-1", configId: "model", value: "agent/thinker" },
      { sessionId: "session-1", configId: "effort", value: "low" },
    ]);
  });
});

describe("OpenCode ACP MCP servers", () => {
  it("sends the enabled servers as ACP name/value pairs", async () => {
    const fake = await createFakeOpencodeAgent("system");
    const sessionLog = join(tmpdir(), `openbot-acp-session-${Date.now()}.ndjson`);
    vi.stubEnv("OPENBOT_FAKE_ACP_SESSION_LOG", sessionLog);
    const configs: McpServerConfig[] = [
      {
        id: "mcp-1",
        name: "Filesystem",
        transport: "stdio",
        enabled: true,
        command: "/bin/echo",
        args: ["ready"],
        env: [{ key: "TOKEN", value: "secret" }],
        envPassthrough: [],
        workingDirectory: "",
        url: "",
        headers: [],
      },
      {
        id: "mcp-2",
        name: "Off",
        transport: "stdio",
        enabled: false,
        command: "/bin/echo",
        args: [],
        env: [],
        envPassthrough: [],
        workingDirectory: "",
        url: "",
        headers: [],
      },
      {
        id: "mcp-3",
        name: "Database",
        transport: "stdio",
        enabled: true,
        command: "/bin/echo",
        args: ["--database", "./data.db"],
        env: [],
        envPassthrough: [],
        workingDirectory: tmpdir(),
        url: "",
        headers: [],
      },
    ];
    const client = startOpencode(fake.cli, () => null, fake.envLog, { mcpServers: () => configs });
    await runCauseEffect(client.request("initialize", {}, decodeRecordResponse));
    await runCauseEffect(
      client.request(
        "thread/start",
        { cwd: tmpdir(), runtimeWorkspaceRoots: [tmpdir()], dynamicTools: VISIBLE_DYNAMIC_TOOLS },
        decodeRecordResponse,
      ),
    );

    const logged = (await readFile(sessionLog, "utf8")).split("\n").filter((line) => line.trim());
    // The first session is the model probe the client opens in its own directory; the thread is the
    // last one.
    const params = JSON.parse(logged.at(-1) ?? "{}");
    // ACP takes an array whose env is `{ name, value }` pairs, not a record. The launch `PATH` is
    // in there as well, which `claude-client.test.ts` covers.
    expect(params.mcpServers[0]).toMatchObject({
      name: "Filesystem",
      command: "/bin/echo",
      args: ["ready"],
      env: expect.arrayContaining([{ name: "TOKEN", value: "secret" }]),
    });
    // A disabled server is not sent, and OpenBot's own bridge entries append after these, so a
    // user's server can never displace one. `Database` is not sent either: ACP carries no working
    // directory, and a server told to open `./data.db` somewhere else creates a second database
    // rather than reading the one the user named.
    expect(params.mcpServers.map((server: { name: string }) => server.name)).toEqual(["Filesystem", "openbot"]);
  });
});

describe("OpenCode MCP sign-in", () => {
  it("gives the session the token OpenBot minted for an http server", async () => {
    const fake = await createFakeOpencodeAgent();
    const sessionLog = join(tmpdir(), `openbot-acp-signin-${Date.now()}.ndjson`);
    vi.stubEnv("OPENBOT_FAKE_ACP_SESSION_LOG", sessionLog);
    const config: McpServerConfig = {
      id: "mcp-1",
      name: "Signed in",
      transport: "http",
      enabled: true,
      command: "",
      args: [],
      env: [],
      envPassthrough: [],
      workingDirectory: "",
      url: "https://mcp.example.com/mcp",
      headers: [],
    };
    const client = startOpencode(fake.cli, () => null, fake.envLog, {
      mcpServers: () => [config],
      mcpAuthorization: () => Effect.succeed("minted-access-token"),
    });
    await runCauseEffect(client.request("initialize", {}, decodeRecordResponse));
    await runCauseEffect(
      client.request("thread/start", { cwd: tmpdir(), runtimeWorkspaceRoots: [tmpdir()] }, decodeRecordResponse),
    );

    // The row holds no credential: a native sign-in keeps the token in OpenBot's own store, so the
    // only way OpenCode can reach the server is the header written here, at the hand-off.
    const logged = (await readFile(sessionLog, "utf8")).split("\n").filter((line) => line.trim());
    const params = JSON.parse(logged.at(-1) ?? "{}");
    expect(params.mcpServers).toEqual([
      {
        type: "http",
        name: "Signed in",
        url: "https://mcp.example.com/mcp",
        headers: [{ name: "Authorization", value: "Bearer minted-access-token" }],
      },
    ]);
  });
});

describe("ACP missing session errors", () => {
  it("does not replay a failed prompt and reloads for the next input", async () => {
    const fake = await createFakeOpencodeAgent();
    const failureFile = join(fake.directory, "failure.json");
    vi.stubEnv("OPENBOT_FAKE_ACP_FAILURE_FILE", failureFile);
    vi.stubEnv("OPENBOT_FAKE_ACP_IGNORE_CLOSE", "1");
    vi.stubEnv("OPENBOT_FAKE_ACP_LOAD_SESSION", "1");
    vi.stubEnv("OPENBOT_FAKE_ACP_LOAD_LOG", fake.loadLog);
    vi.stubEnv("OPENBOT_FAKE_ACP_PROMPT_LOG", fake.promptLog);
    const client = new AcpAgentClient(fake.cli, 10_000, {
      provider: "acp",
      argv: [],
      env: {},
      signInMessage: "Sign in",
    });
    started.push(client);
    client.start();
    const response = await runCauseEffect(
      client.request("thread/start", { cwd: fake.directory }, decodeThreadResponse),
    );
    const threadId = response.thread.id;
    await writeFile(
      failureFile,
      JSON.stringify({
        method: "session/prompt",
        error: { code: -32603, message: "Internal error", data: { details: `Unsupported ACP session: ${threadId}` } },
      }),
    );
    const completed: unknown[] = [];
    client.on("notification", (notification) => {
      if (notification.method === "turn/completed") completed.push(notification.params);
    });
    await runCauseEffect(
      client.request("turn/start", { threadId, input: [{ type: "text", text: "Old input" }] }, decodeRecordResponse),
    );
    await vi.waitFor(() => expect(completed).toHaveLength(1));
    expect(completed[0]).toMatchObject({ turn: { status: "failed" } });
    await rm(failureFile);
    await runCauseEffect(client.request("thread/resume", { threadId, cwd: fake.directory }, decodeRecordResponse));
    expect(await fake.readLoadedSessions()).toHaveLength(1);
    await runCauseEffect(
      client.request("turn/start", { threadId, input: [{ type: "text", text: "New input" }] }, decodeRecordResponse),
    );
    await vi.waitFor(() => expect(completed).toHaveLength(2));
    expect(completed[1]).toMatchObject({ turn: { status: "completed" } });
    const prompts = await fake.readPrompts();
    expect(prompts.map((prompt) => JSON.parse(prompt))).toMatchObject([
      { prompt: [{ type: "text", text: "Old input" }] },
      { prompt: [{ type: "text", text: "New input" }] },
    ]);
    expect(prompts).toHaveLength(2);
  });

  it.each([
    { code: -32002, data: { uri: "session-1" }, missing: true },
    { code: -32603, data: { details: "Unsupported ACP session: session-1" }, missing: true },
    { code: -32603, data: { details: "Unsupported ACP session: another-session" }, missing: false },
    { code: -32603, data: { details: "Upstream session not found; credential=private-value" }, missing: false },
  ])("recovers only confirmed startup session failures: $data", async ({ code, data, missing }) => {
    const fake = await createFakeOpencodeAgent();
    const failureFile = join(fake.directory, "failure.json");
    vi.stubEnv("OPENBOT_FAKE_ACP_FAILURE_FILE", failureFile);
    vi.stubEnv("OPENBOT_FAKE_ACP_IGNORE_CLOSE", "1");
    vi.stubEnv("OPENBOT_FAKE_ACP_CONFIG_MODELS", "1");
    vi.stubEnv("OPENBOT_FAKE_ACP_LOAD_SESSION", "1");
    vi.stubEnv("OPENBOT_FAKE_ACP_LOAD_LOG", fake.loadLog);
    vi.stubEnv("OPENBOT_FAKE_ACP_PROMPT_LOG", fake.promptLog);
    const client = new AcpAgentClient(fake.cli, 10_000, {
      provider: "acp",
      argv: [],
      env: {},
      signInMessage: "Sign in",
      redactValues: () => ["private-value"],
    });
    started.push(client);
    client.start();
    const response = await runCauseEffect(
      client.request("thread/start", { cwd: fake.directory }, decodeThreadResponse),
    );
    const threadId = response.thread.id;
    await writeFile(
      failureFile,
      JSON.stringify({ method: "session/set_config_option", error: { code, message: "Internal error", data } }),
    );
    const notifications: string[] = [];
    client.on("notification", (notification) => notifications.push(notification.method));
    const error = await runCauseEffect(
      client.request(
        "turn/start",
        { threadId, model: "agent/thinker", input: [{ type: "text", text: "Continue" }] },
        decodeRecordResponse,
      ),
    ).catch((reason: unknown) => reason);
    expect(isMissingProviderSessionError(error, "acp")).toBe(missing);
    expect(notifications).not.toContain("turn/started");
    expect(await fake.readPrompts()).toEqual([]);
    if (!missing) {
      expect(String(error)).toContain(data.details?.replace("private-value", "[redacted]"));
      expect(String(error)).not.toContain("private-value");
    }
    await rm(failureFile);
    await runCauseEffect(client.request("thread/resume", { threadId, cwd: fake.directory }, decodeRecordResponse));
    expect(await fake.readLoadedSessions()).toHaveLength(missing ? 1 : 0);
    await runCauseEffect(
      client.request("turn/start", { threadId, input: [{ type: "text", text: "Continue" }] }, decodeRecordResponse),
    );
    await vi.waitFor(() => expect(notifications).toContain("turn/completed"));
    const prompts = await fake.readPrompts();
    expect(prompts).toHaveLength(1);
    expect(JSON.parse(prompts[0] ?? "{}")).toMatchObject({
      sessionId: threadId,
      prompt: [{ type: "text", text: "Continue" }],
    });
  });

  it.each([
    { provider: "cursor", code: -32602, data: { message: 'Session "ses_stored" not found' }, missing: true },
    { provider: "cursor", code: -32602, data: { message: 'Session "ses_other" not found' }, missing: false },
    { provider: "cursor", code: -32602, data: { message: "Invalid model value: retired-model" }, missing: false },
    { provider: "cursor", code: -32602, data: null, missing: false },
    { provider: "cursor", code: -32603, data: { message: 'Session "ses_stored" not found' }, missing: false },
    { provider: "opencode", code: -32602, data: { message: 'Session "ses_stored" not found' }, missing: false },
    { provider: "cursor", code: -32002, data: { uri: "ses_stored" }, missing: true },
  ] as const)("classifies $provider load error $code with $data", async ({ provider, code, data, missing }) => {
    const fake = await createFakeOpencodeAgent();
    vi.stubEnv("OPENBOT_FAKE_ACP_LOAD_SESSION", "1");
    const responseError = { code, message: "Invalid params", data };
    vi.stubEnv("OPENBOT_FAKE_ACP_LOAD_ERROR", JSON.stringify(responseError));
    const client = requireProviderDriver(provider).createClient(fake.cli, 10_000, {
      apiKey: () => null,
      customProviders: () => [],
      mcpServers: () => [],
    });
    started.push(client);
    client.start();

    const error = await runCauseEffect(
      client.request("thread/resume", { threadId: "ses_stored", cwd: fake.directory }, decodeRecordResponse),
    ).catch((reason: unknown) => reason);

    expect(isMissingProviderSessionError(error, provider)).toBe(missing);
    if (!missing) expect(error).toMatchObject(responseError);
    else {
      const read = await runCauseEffect(
        client.request(
          "thread/read",
          { threadId: "ses_stored", cwd: fake.directory, includeTurns: true },
          decodeThreadResponse,
        ),
      );
      expect(read.thread.turns).toEqual([]);
    }
  });
});

describe("OpenCode ACP session loading", () => {
  it("keeps a live non-resumable ACP session when provider idle release runs", async () => {
    const fake = await createFakeOpencodeAgent();
    const client = startOpencode(fake.cli, () => null, fake.envLog);
    await runCauseEffect(client.request("initialize", {}, decodeRecordResponse));
    expect(client.canReleaseProcess?.()).toBe(true);
    await runCauseEffect(client.request("thread/start", { cwd: fake.directory }, decodeRecordResponse));
    expect(client.canReleaseProcess?.()).toBe(false);
  });

  it("resumes a session when ACP advertises resume without load", async () => {
    const fake = await createFakeOpencodeAgent();
    vi.stubEnv("OPENBOT_FAKE_ACP_RESUME", "1");
    const client = startOpencode(fake.cli, () => null, fake.envLog);
    await runCauseEffect(client.request("initialize", {}, decodeRecordResponse));

    await expect(
      runCauseEffect(
        client.request(
          "thread/resume",
          { threadId: "ses_resume_only", cwd: fake.directory, runtimeWorkspaceRoots: [fake.directory] },
          decodeRecordResponse,
        ),
      ),
    ).resolves.toEqual(expect.any(Object));
    expect(client.canReleaseProcess?.()).toBe(true);
    expect(await fake.readLoadedSessions()).toEqual([]);
  });

  it("streams load replay through readHistory without publishing live updates", async () => {
    const fake = await createFakeOpencodeAgent();
    vi.stubEnv("OPENBOT_FAKE_ACP_LOAD_SESSION", "1");
    vi.stubEnv("OPENBOT_FAKE_ACP_REPLAY", "1");
    const client = startOpencode(fake.cli, () => null, fake.envLog);
    const live: unknown[] = [];
    const fragments: string[] = [];
    client.on("notification", (notification) => live.push(notification));
    await runCauseEffect(client.request("initialize", {}, decodeRecordResponse));
    if (!client.readHistory) throw new Error("ACP client has no history reader.");
    await runCauseEffect(
      client.readHistory({ threadId: "ses_stored", cwd: fake.directory, items: "full" }, (fragment) =>
        Effect.sync(() => {
          fragments.push(fragment.items.map((item) => item.text ?? "").join(""));
          return true;
        }),
      ),
    );
    expect(fragments.join("")).toContain("Restored");
    expect(live).toEqual([]);
  });

  it("bounds replay work when the history consumer is slower than the provider", async () => {
    const fake = await createFakeOpencodeAgent();
    vi.stubEnv("OPENBOT_FAKE_ACP_LOAD_SESSION", "1");
    vi.stubEnv("OPENBOT_FAKE_ACP_REPLAY", "1");
    vi.stubEnv("OPENBOT_FAKE_ACP_REPLAY_COUNT", "300");
    const replayReady = join(fake.directory, "replay-ready");
    vi.stubEnv("OPENBOT_FAKE_ACP_REPLAY_READY", replayReady);
    const client = startOpencode(fake.cli, () => null, fake.envLog);
    await runCauseEffect(client.request("initialize", {}, decodeRecordResponse));
    if (!client.readHistory) throw new Error("ACP client has no history reader.");
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const consumerStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const pending = runCauseEffect(
      client.readHistory({ threadId: "ses_stored", cwd: fake.directory, items: "full" }, () =>
        Effect.promise(async () => {
          started();
          await gate;
          return true;
        }),
      ),
    );
    const rejected = expect(pending).rejects.toThrow(/history consumer is too slow/i);
    await consumerStarted;
    await vi.waitFor(async () => expect(await readFile(replayReady, "utf8")).toBe("ready"));
    release();
    await rejected;
  });

  it("reports a failed turn when durable history persistence fails", async () => {
    const fake = await createFakeOpencodeAgent();
    vi.stubEnv("OPENBOT_FAKE_ACP_PROMPT_OUTPUT", "1");
    const client = startOpencode(fake.cli, () => null, fake.envLog, {
      history: {
        append: () => Effect.fail(new ProviderClientOperationError({ cause: new Error("history write failed") })),
      },
    });
    const completed: unknown[] = [];
    client.on("notification", (notification) => {
      if (notification.method === "turn/completed") completed.push(notification);
    });
    await runCauseEffect(client.request("initialize", {}, decodeRecordResponse));
    const thread = await runCauseEffect(client.request("thread/start", { cwd: fake.directory }, decodeRecordResponse));
    const threadId = isDynamicRecord(thread.thread) ? thread.thread.id : null;
    if (typeof threadId !== "string") throw new Error("The fake agent opened no thread.");
    await runCauseEffect(
      client.request(
        "turn/start",
        { threadId, clientUserMessageId: "turn-persist-failure", input: [{ type: "inputText", text: "Hi" }] },
        decodeRecordResponse,
      ),
    );
    await vi.waitFor(() => expect(completed).toHaveLength(1));
    expect(completed[0]).toMatchObject({ params: { turn: { status: "failed" } } });
  });

  it("persists completed ACP tool items before releasing a turn", async () => {
    const fake = await createFakeOpencodeAgent();
    vi.stubEnv("OPENBOT_FAKE_ACP_PROMPT_TOOL", "1");
    const appended: Array<Parameters<NonNullable<AcpHistoryPersistence["append"]>>> = [];
    const client = startOpencode(fake.cli, () => null, fake.envLog, {
      history: {
        append: (...args) => {
          appended.push(args);
          return Effect.void;
        },
      },
    });
    const filePaths: unknown[] = [];
    client.on("notification", (event) => {
      if (isDynamicRecord(event.params) && event.params.filePaths) filePaths.push(event.params.filePaths);
    });
    await runCauseEffect(client.request("initialize", {}, decodeRecordResponse));
    const thread = await runCauseEffect(client.request("thread/start", { cwd: fake.directory }, decodeRecordResponse));
    const threadId = isDynamicRecord(thread.thread) ? thread.thread.id : null;
    if (typeof threadId !== "string") throw new Error("The fake agent opened no thread.");
    await runCauseEffect(
      client.request(
        "turn/start",
        { threadId, clientUserMessageId: "turn-tool-history", input: [{ type: "inputText", text: "Read it" }] },
        decodeRecordResponse,
      ),
    );
    await vi.waitFor(() => expect(appended).toHaveLength(1));
    expect(filePaths).toEqual([["/private/tool-history/README.md"], ["/private/tool-history/updated.md"]]);
    expect(JSON.stringify(appended)).not.toContain("/private/tool-history/");
    expect(appended[0]?.[1]).toMatchObject({
      complete: true,
      items: [
        expect.objectContaining({
          id: "tool-1",
          type: "toolCall",
          name: "read_file",
          status: "completed",
          arguments: { path: "README.md" },
          result: { text: "OpenBot" },
        }),
      ],
    });
  });

  it("answers a read for a session this process does not hold by loading it", async () => {
    const fake = await createFakeOpencodeAgent();
    vi.stubEnv("OPENBOT_FAKE_ACP_LOAD_SESSION", "1");
    vi.stubEnv("OPENBOT_FAKE_ACP_LOAD_LOG", fake.loadLog);
    const client = startOpencode(fake.cli, () => null, fake.envLog);

    // What boot recovery sends after a restart: a session id from the database that no turn has
    // resumed yet. Before the session is loaded the client holds nothing under that id.
    const response = await runCauseEffect(
      client.request(
        "thread/read",
        { threadId: "ses_stored", cwd: fake.directory, includeTurns: true },
        decodeThreadResponse,
      ),
    );

    expect(response.thread.id).toBe("ses_stored");
    expect(await fake.readLoadedSessions()).toMatchObject([{ sessionId: "ses_stored", cwd: fake.directory }]);
  });

  it("loads a session once when a read and a resume ask for it together", async () => {
    const fake = await createFakeOpencodeAgent();
    vi.stubEnv("OPENBOT_FAKE_ACP_LOAD_SESSION", "1");
    vi.stubEnv("OPENBOT_FAKE_ACP_LOAD_LOG", fake.loadLog);
    const client = startOpencode(fake.cli, () => null, fake.envLog);
    // The startup race: the history read and the first drain reach the same stored session id in
    // the same tick. Two loads would leave two threads and two MCP bridge sessions under one id.
    await Promise.all([
      runCauseEffect(
        client.request(
          "thread/read",
          { threadId: "ses_stored", cwd: fake.directory, includeTurns: true },
          decodeThreadResponse,
        ),
      ),
      runCauseEffect(
        client.request("thread/resume", { threadId: "ses_stored", cwd: fake.directory }, decodeRecordResponse),
      ),
    ]);

    expect(await fake.readLoadedSessions()).toHaveLength(1);
  });

  it("closes the longest idle session over the limit and loads it again for its next turn", async () => {
    const fake = await createFakeOpencodeAgent();
    const closeLog = join(fake.directory, "closed-sessions.ndjson");
    vi.stubEnv("OPENBOT_FAKE_ACP_CLOSE_LOG", closeLog);
    vi.stubEnv("OPENBOT_FAKE_ACP_LOAD_LOG", fake.loadLog);
    const client = startOpencode(fake.cli, () => null, fake.envLog);
    let completed = 0;
    client.on("notification", (notification) => {
      if (notification.method === "turn/completed") completed += 1;
    });
    const threadIds: string[] = [];
    // The model catalog probe opens and closes a session of its own.
    const closedSessions = async () =>
      (await readFile(closeLog, "utf8").catch(() => ""))
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line).sessionId)
        .filter((sessionId) => threadIds.includes(sessionId));
    const input = [{ type: "inputText", text: "Keep working" }];
    for (let index = 0; index <= ACP_IDLE_SESSION_LIMIT; index += 1) {
      const thread = await runCauseEffect(
        client.request(
          "thread/start",
          { cwd: fake.directory, runtimeWorkspaceRoots: [fake.directory] },
          decodeRecordResponse,
        ),
      );
      const threadId = isDynamicRecord(thread.thread) ? thread.thread.id : null;
      if (typeof threadId !== "string") throw new Error("The fake agent opened no thread.");
      threadIds.push(threadId);
    }
    for (const [index, threadId] of threadIds.entries()) {
      await runCauseEffect(
        client.request("turn/start", { threadId, clientUserMessageId: `turn-${index}`, input }, decodeRecordResponse),
      );
      await vi.waitFor(() => expect(completed).toBe(index + 1));
    }

    // Each open session holds its own set of the user's MCP servers until the agent closes it.
    await vi.waitFor(async () => expect(await closedSessions()).toEqual([threadIds[0]]));
    await runCauseEffect(
      client.request(
        "turn/start",
        { threadId: threadIds[0], clientUserMessageId: "turn-again", input },
        decodeRecordResponse,
      ),
    );
    expect(await fake.readLoadedSessions()).toMatchObject([{ sessionId: threadIds[0], cwd: fake.directory }]);
  });

  it("counts a session loaded only for a read toward the idle limit", async () => {
    const fake = await createFakeOpencodeAgent();
    const closeLog = join(fake.directory, "closed-sessions.ndjson");
    vi.stubEnv("OPENBOT_FAKE_ACP_CLOSE_LOG", closeLog);
    vi.stubEnv("OPENBOT_FAKE_ACP_LOAD_LOG", fake.loadLog);
    const client = startOpencode(fake.cli, () => null, fake.envLog);
    const threadIds = Array.from({ length: ACP_IDLE_SESSION_LIMIT + 1 }, (_, index) => `ses_stored_${index}`);
    const closedSessions = async () =>
      (await readFile(closeLog, "utf8").catch(() => ""))
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line).sessionId)
        .filter((sessionId) => threadIds.includes(sessionId));

    // What boot recovery does after a restart: it reads every stored session, and each read loads one.
    for (const threadId of threadIds) {
      await runCauseEffect(
        client.request("thread/read", { threadId, cwd: fake.directory, includeTurns: true }, decodeThreadResponse),
      );
    }

    // Each open session holds its own set of the user's MCP servers until the agent closes it.
    await vi.waitFor(async () => expect(await closedSessions()).toEqual([threadIds[0]]));
  });

  it("reports a session an agent cannot load as missing instead of asking for it", async () => {
    const fake = await createFakeOpencodeAgent();
    vi.stubEnv("OPENBOT_FAKE_ACP_LOAD_LOG", fake.loadLog);
    const client = startOpencode(fake.cli, () => null, fake.envLog);

    // An agent that does not advertise `loadSession` cannot give the session back. The read answers
    // an empty thread, so a restart reports no failure to the user, and the resume fails as a
    // missing session, which is what starts the replacement.
    const read = await runCauseEffect(
      client.request(
        "thread/read",
        { threadId: "ses_stored", cwd: fake.directory, includeTurns: true },
        decodeThreadResponse,
      ),
    );
    expect(read.thread.turns).toEqual([]);
    await expect(
      runCauseEffect(
        client.request("thread/resume", { threadId: "ses_stored", cwd: fake.directory }, decodeRecordResponse),
      ),
    ).rejects.toThrow(/unknown acp session/i);
    expect(await fake.readLoadedSessions()).toEqual([]);
  });

  // OpenCode answers a session missing from its store with the same error as a fault of its internal
  // server. A missing session is replaced, and a server fault must not cost the agent its session.
  it("reports a session as missing when OpenCode's server answers, without a diagnostic", async () => {
    const fake = await createFakeOpencodeAgent();
    vi.stubEnv("OPENBOT_FAKE_ACP_LIST", "ok");
    vi.stubEnv("OPENBOT_FAKE_ACP_LOAD_LOG", fake.loadLog);
    vi.stubEnv("OPENBOT_FAKE_ACP_LOAD_FAIL", "2");
    const client = startOpencode(fake.cli, () => null, fake.envLog);
    const diagnostics: string[] = [];
    client.on("diagnostic", (message) => diagnostics.push(message));

    // The boot read shows nothing to the user, and the resume fails as a missing session, which is
    // what starts the replacement.
    const read = await runCauseEffect(
      client.request(
        "thread/read",
        { threadId: "ses_stored", cwd: fake.directory, includeTurns: true },
        decodeThreadResponse,
      ),
    );
    expect(read.thread.turns).toEqual([]);
    const error = await runCauseEffect(
      client.request("thread/resume", { threadId: "ses_stored", cwd: fake.directory }, decodeRecordResponse),
    ).catch((reason: unknown) => reason);
    expect(isMissingProviderSessionError(error, "opencode")).toBe(true);
    expect(diagnostics).toEqual([]);
    expect(await fake.readLoadedSessions()).toHaveLength(2);
  });

  it("loads the session again after one failure while OpenCode's server fails", async () => {
    const fake = await createFakeOpencodeAgent();
    vi.stubEnv("OPENBOT_FAKE_ACP_LIST", "fail");
    vi.stubEnv("OPENBOT_FAKE_ACP_LOAD_LOG", fake.loadLog);
    vi.stubEnv("OPENBOT_FAKE_ACP_LOAD_FAIL", "1");
    const client = startOpencode(fake.cli, () => null, fake.envLog);

    await runCauseEffect(
      client.request("thread/resume", { threadId: "ses_stored", cwd: fake.directory }, decodeRecordResponse),
    );

    expect(await fake.readLoadedSessions()).toMatchObject([{ sessionId: "ses_stored" }, { sessionId: "ses_stored" }]);
  });

  it.each([
    ["its list fails", "fail"],
    ["it lists the session", "paged"],
    // An older OpenCode cannot show that a session is missing.
    ["it has no session list", ""],
  ])("keeps the session and explains the fault when OpenCode fails the load and %s", async (_, list) => {
    const fake = await createFakeOpencodeAgent();
    vi.stubEnv("OPENBOT_FAKE_ACP_LOAD_SESSION", "1");
    vi.stubEnv("OPENBOT_FAKE_ACP_LIST", list);
    vi.stubEnv("OPENBOT_FAKE_ACP_LOAD_FAIL", "2");
    const client = startOpencode(fake.cli, () => null, fake.envLog);

    const error = await runCauseEffect(
      client.request("thread/resume", { threadId: "ses_stored", cwd: fake.directory }, decodeRecordResponse),
    ).catch((reason: unknown) => reason);

    expect(isMissingProviderSessionError(error, "opencode")).toBe(false);
    expect(error).toHaveProperty("message", sourceText("error.provider.opencodeServiceFailure"));
  });
});
