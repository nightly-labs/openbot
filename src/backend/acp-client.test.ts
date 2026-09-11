// @vitest-environment node

/*
 * The OpenCode driver's environment seam, through a real spawn.
 *
 * OpenCode's whole account is one variable: with `OPENCODE_API_KEY` the CLI lists the paid Zen
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
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentClient } from "./agent-client";
import type { OpencodeCliInfo } from "./cli";
import type { CustomProviderConfig } from "./opencode-config";
import { decodeAccountReadResult, decodeModelListResponse, decodeRecordResponse } from "./protocol";
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
    write({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: 1, agentCapabilities: {} } });
    return;
  }
  if (message.method === "session/prompt") {
    const promptLog = process.env.OPENBOT_FAKE_ACP_PROMPT_LOG;
    if (promptLog) fs.appendFileSync(promptLog, JSON.stringify(message.params) + NL);
    write({ jsonrpc: "2.0", id: message.id, result: { stopReason: "end_turn" } });
    return;
  }
  if (message.method === "session/new") {
    if (process.env.OPENBOT_FAKE_ACP_REJECT_KEY === "1") {
      write({ jsonrpc: "2.0", id: message.id, error: { code: -32000, message: "Invalid api key." } });
      return;
    }
    if (process.env.OPENBOT_FAKE_ACP_EMPTY_MODELS === "1") {
      write({ jsonrpc: "2.0", id: message.id, result: { sessionId: "session-1" } });
      return;
    }
    const ids = process.env.OPENCODE_API_KEY
      ? ["opencode/zen-one", "opencode/zen-two", "opencode/zen-three"]
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
  envLog: string;
  promptLog: string;
  readPrompts: () => Promise<string[]>;
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
  return {
    cli: { executable, version: "1.18.30", ...(source ? { source } : {}) },
    envLog,
    promptLog,
    readPrompts: async () => {
      const source = await readFile(promptLog, "utf8").catch(() => "");
      return source.split("\n").filter((line) => line.trim());
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
  } = {},
): AgentClient {
  vi.stubEnv("OPENBOT_FAKE_ACP_ENV_LOG", envLog);
  const driver = requireProviderDriver("opencode");
  const context = {
    apiKey,
    customProviders: options.customProviders ?? (() => []),
    servesModel: options.servesModel,
  };
  const client = options.profile
    ? (driver.createProfileClient?.(cli, 10_000, context) ?? driver.createClient(cli, 10_000, context))
    : driver.createClient(cli, 10_000, context);
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

    key = "zen-key-value";
    client.start();
    await client.request("initialize", {}, decodeRecordResponse);

    const environments = await fake.readSpawnEnvironments();
    expect(environments.map((environment) => environment.apiKey)).toEqual([null, "zen-key-value"]);
    const models = await client.request("model/list", {}, decodeModelListResponse);
    expect(models.data.map((model) => model.model)).toEqual([
      "opencode/zen-one",
      "opencode/zen-two",
      "opencode/zen-three",
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
