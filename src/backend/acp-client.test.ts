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

import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpServerConfig } from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentClient } from "./agent-client";
import type { OpencodeCliInfo } from "./cli";
import type { CustomProviderConfig } from "./opencode-config";
import {
  decodeAccountReadResult,
  decodeModelListResponse,
  decodeRecordResponse,
  decodeThreadResponse,
} from "./protocol";
import { requireProviderDriver } from "./provider-drivers";

const started: AgentClient[] = [];

afterEach(async () => {
  await Promise.all(started.splice(0).map((client) => client.stop().catch(() => undefined)));
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
const CONFIG_MODELS = [
  ...(FAILING_MODEL ? [FAILING_MODEL] : []),
  "agent/thinker",
  ...(HANGING_MODEL ? [HANGING_MODEL] : []),
  "agent/plain",
];
const THOUGHT_LEVELS = ["minimal", "low", "medium", "high", "xhigh", "default"];
let selected = CONFIG_MODELS[0];
const configOptions = () => [
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
    : []),
];
const write = (message) => process.stdout.write(JSON.stringify(message) + NL);
process.stdout.on("error", (error) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
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
    const agentCapabilities = process.env.OPENBOT_FAKE_ACP_LOAD_SESSION === "1" ? { loadSession: true } : {};
    write({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: 1, agentCapabilities } });
    return;
  }
  if (message.method === "session/load") {
    const loadLog = process.env.OPENBOT_FAKE_ACP_LOAD_LOG;
    if (loadLog) fs.appendFileSync(loadLog, JSON.stringify(message.params) + NL);
    write({ jsonrpc: "2.0", id: message.id, result: {} });
    return;
  }
  if (message.method === "session/prompt") {
    const promptLog = process.env.OPENBOT_FAKE_ACP_PROMPT_LOG;
    if (promptLog) fs.appendFileSync(promptLog, JSON.stringify(message.params) + NL);
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
    write({ jsonrpc: "2.0", id: message.id, result: { configOptions: configOptions() } });
    return;
  }
  if (message.method === "session/new") {
    const sessionLog = process.env.OPENBOT_FAKE_ACP_SESSION_LOG;
    if (sessionLog) fs.appendFileSync(sessionLog, JSON.stringify(message.params) + NL);
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
        sessionId: "session-1",
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

async function createFakeOpencodeAgent(source?: "system" | "managed"): Promise<FakeOpencode> {
  const directory = await mkdtemp(join(tmpdir(), "openbot-acp-opencode-"));
  const executable = join(directory, "opencode");
  await writeFile(executable, FAKE_AGENT);
  await chmod(executable, 0o755);
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
    /** How long one request may take, which is also the deadline model discovery works inside. */
    requestTimeoutMs?: number;
  } = {},
): AgentClient {
  vi.stubEnv("OPENBOT_FAKE_ACP_ENV_LOG", envLog);
  const driver = requireProviderDriver("opencode");
  const context = {
    apiKey,
    customProviders: options.customProviders ?? (() => []),
    mcpServers: options.mcpServers ?? (() => []),
    servesModel: options.servesModel,
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

    await client.request("initialize", {}, decodeRecordResponse);

    // An empty `OPENCODE_API_KEY` is not the same as an absent one: the CLI reads it as an account
    // and lists nothing. A user with no account has to see the variable missing.
    const [environment] = await fake.readSpawnEnvironments();
    expect(environment).toEqual({ argv: ["acp"], apiKey: null, disableAutoupdate: null, configContent: null });
    const account = await client.request("account/read", { refreshToken: false }, decodeAccountReadResult);
    expect(account.account).not.toBeNull();
    const models = await client.request("model/list", {}, decodeModelListResponse);
    expect(models.data.map((model) => model.model)).toEqual(["opencode/big-pickle"]);
  });

  it("reads the key at every spawn, so a key saved later reaches the next process", async () => {
    const fake = await createFakeOpencodeAgent("system");
    let key: string | null = null;
    // One client across both spawns, which is what makes this about the spawn and not the client:
    // the key is read while the process is created, so the same client picks up a later save.
    const client = startOpencode(fake.cli, () => key, fake.envLog);
    await client.request("initialize", {}, decodeRecordResponse);
    await client.stop();

    key = "go-key-value";
    client.start();
    await client.request("initialize", {}, decodeRecordResponse);

    const environments = await fake.readSpawnEnvironments();
    expect(environments.map((environment) => environment.apiKey)).toEqual([null, "go-key-value"]);
    const models = await client.request("model/list", {}, decodeModelListResponse);
    expect(models.data.map((model) => model.model)).toEqual([
      "opencode-go/go-one",
      "opencode-go/go-two",
      "opencode-go/go-three",
    ]);
  });

  it("stops a managed install from updating itself past the pin", async () => {
    const managed = await createFakeOpencodeAgent("managed");
    const client = startOpencode(managed.cli, () => null, managed.envLog);
    await client.request("initialize", {}, decodeRecordResponse);

    // `verifyInstalledRuntime` compares the reported version with the pin for exact equality, so a
    // CLI that self-updates would leave OpenBot re-downloading a runtime it already has.
    expect((await managed.readSpawnEnvironments())[0]?.disableAutoupdate).toBe("1");
  });

  it("leaves the CLI a user installed free to update itself", async () => {
    const system = await createFakeOpencodeAgent("system");
    const client = startOpencode(system.cli, () => null, system.envLog);
    await client.request("initialize", {}, decodeRecordResponse);

    expect((await system.readSpawnEnvironments())[0]?.disableAutoupdate).toBeNull();
  });

  it("reports no account when OpenCode rejects the key", async () => {
    const fake = await createFakeOpencodeAgent("system");
    vi.stubEnv("OPENBOT_FAKE_ACP_REJECT_KEY", "1");
    const client = startOpencode(fake.cli, () => "not-a-key", fake.envLog);

    await client.request("initialize", {}, decodeRecordResponse);

    // A rejected key has to read as "sign in again", not as a broken CLI: this null account is what
    // `provider-runtime` turns into `sign-in-required` with the provider's own message.
    const account = await client.request("account/read", { refreshToken: false }, decodeAccountReadResult);
    expect(account.account).toBeNull();
  });

  it("spawns the ACP process with the custom endpoints the user saved", async () => {
    const fake = await createFakeOpencodeAgent("system");
    const client = startOpencode(fake.cli, () => null, fake.envLog, { customProviders: () => [customProvider()] });

    await client.request("initialize", {}, decodeRecordResponse);

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
    await client.request("initialize", {}, decodeRecordResponse);
    await client.stop();

    providers.push(customProvider());
    client.start();
    await client.request("initialize", {}, decodeRecordResponse);

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

    await client.request("initialize", {}, decodeRecordResponse);

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
    await expect(client.request("initialize", {}, decodeRecordResponse)).rejects.toThrow(
      "ACP CLI did not advertise any ACP models. OpenBot will not guess a fallback model.",
    );
  });

  it("refuses the prompt when the endpoint was removed while the turn was prepared", async () => {
    const fake = await createFakeOpencodeAgent("system");
    vi.stubEnv("OPENBOT_FAKE_ACP_PROMPT_LOG", fake.promptLog);
    // The endpoint is still saved while the thread is opened, and gone when the prompt would leave.
    let served = true;
    const client = startOpencode(fake.cli, () => null, fake.envLog, { servesModel: () => served });
    await client.request("initialize", {}, decodeRecordResponse);
    const thread = await client.request(
      "thread/start",
      { cwd: tmpdir(), runtimeWorkspaceRoots: [tmpdir()] },
      decodeRecordResponse,
    );
    const threadId = isDynamicRecord(thread.thread) ? thread.thread.id : null;
    if (typeof threadId !== "string") throw new Error("The fake agent opened no thread.");

    served = false;
    await expect(
      client.request(
        "turn/start",
        { threadId, clientUserMessageId: "delivery-1", input: [{ type: "inputText", text: "Keep working" }] },
        decodeRecordResponse,
      ),
    ).rejects.toThrow("The endpoint this agent used was removed. Choose another model for it.");

    // Nothing reached the process, which still holds the session it opened on that endpoint.
    expect(await fake.readPrompts()).toEqual([]);
  });
});

describe("OpenCode ACP reasoning efforts", () => {
  it("reports the efforts of each model, not the efforts of the model the session opened on", async () => {
    const fake = await createFakeOpencodeAgent("system");
    vi.stubEnv("OPENBOT_FAKE_ACP_CONFIG_MODELS", "1");
    vi.stubEnv("OPENBOT_FAKE_ACP_CONFIG_LOG", fake.configLog);
    const client = startOpencode(fake.cli, () => null, fake.envLog);

    const models = await client.request("model/list", {}, decodeModelListResponse);

    // `thought_level` describes the model the session is on, and a new session is on one model. Read
    // without a probe per model, the whole catalog carried that one answer: the Effort menu offered
    // `Medium` alone for a model that reasons from minimal to xhigh.
    expect(
      models.data.map((model) => [
        model.model,
        model.supportedReasoningEfforts?.map((effort) => effort.reasoningEffort),
      ]),
    ).toEqual([
      ["agent/thinker", ["low", "medium", "high", "xhigh"]],
      // A model the agent gives no `thought_level` for has one effort, which is what it had before.
      ["agent/plain", ["medium"]],
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

    const models = await client.request("model/list", {}, decodeModelListResponse);

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

    const models = await client.request("model/list", {}, decodeModelListResponse);

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

    await client.request(
      "thread/start",
      { cwd: tmpdir(), runtimeWorkspaceRoots: [tmpdir()], model: "agent/thinker", effort: "low" },
      decodeRecordResponse,
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
    await client.request("initialize", {}, decodeRecordResponse);
    await client.request("thread/start", { cwd: tmpdir(), runtimeWorkspaceRoots: [tmpdir()] }, decodeRecordResponse);

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
    expect(params.mcpServers.map((server: { name: string }) => server.name)).toEqual(["Filesystem"]);
  });
});

describe("OpenCode ACP session loading", () => {
  it("answers a read for a session this process does not hold by loading it", async () => {
    const fake = await createFakeOpencodeAgent();
    vi.stubEnv("OPENBOT_FAKE_ACP_LOAD_SESSION", "1");
    vi.stubEnv("OPENBOT_FAKE_ACP_LOAD_LOG", fake.loadLog);
    const client = startOpencode(fake.cli, () => null, fake.envLog);

    // What boot recovery sends after a restart: a session id from the database that no turn has
    // resumed yet. Before the session is loaded the client holds nothing under that id.
    const response = await client.request(
      "thread/read",
      { threadId: "ses_stored", cwd: fake.directory, includeTurns: true },
      decodeThreadResponse,
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
      client.request(
        "thread/read",
        { threadId: "ses_stored", cwd: fake.directory, includeTurns: true },
        decodeThreadResponse,
      ),
      client.request("thread/resume", { threadId: "ses_stored", cwd: fake.directory }, decodeRecordResponse),
    ]);

    expect(await fake.readLoadedSessions()).toHaveLength(1);
  });

  it("reports a session an agent cannot load as missing instead of asking for it", async () => {
    const fake = await createFakeOpencodeAgent();
    vi.stubEnv("OPENBOT_FAKE_ACP_LOAD_LOG", fake.loadLog);
    const client = startOpencode(fake.cli, () => null, fake.envLog);

    // An agent that does not advertise `loadSession` cannot give the session back. The read answers
    // an empty thread, so a restart reports no failure to the user, and the resume fails as a
    // missing session, which is what starts the replacement.
    const read = await client.request(
      "thread/read",
      { threadId: "ses_stored", cwd: fake.directory, includeTurns: true },
      decodeThreadResponse,
    );
    expect(read.thread.turns).toEqual([]);
    await expect(
      client.request("thread/resume", { threadId: "ses_stored", cwd: fake.directory }, decodeRecordResponse),
    ).rejects.toThrow(/unknown acp session/i);
    expect(await fake.readLoadedSessions()).toEqual([]);
  });
});
