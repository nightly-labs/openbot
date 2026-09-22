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
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentClient } from "./agent-client";
import type { OpencodeCliInfo } from "./cli";
import type { CustomProviderConfig } from "./opencode-config";
import { decodeRecordResponse, decodeThreadResponse } from "./protocol";
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
    /** The bearer token a signed-in http server is given, minted at the hand-off and never stored. */
    mcpAuthorization?: (config: McpServerConfig) => Promise<string | null>;
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
    mcpAuthorization: options.mcpAuthorization,
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
