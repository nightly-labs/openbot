// @vitest-environment node

/*
 * The OpenCode driver's environment seam, through a real spawn.
 *
 * OpenCode's whole account is one variable: with `OPENCODE_API_KEY` the CLI lists the paid Zen
 * catalog, without it the free one. Nothing else in OpenBot reads that variable, so this file spawns
 * a fake ACP agent that reports the environment it was given, and asserts what a user gets: free
 * models with no account, the paid list after a key is saved, and no forced sign-in in between.
 */

import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentClient } from "./agent-client";
import type { OpencodeCliInfo } from "./cli";
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
  readSpawnEnvironments: () => Promise<Array<{ apiKey: string | null; disableAutoupdate: string | null }>>;
}

async function createFakeOpencodeAgent(source?: "system" | "managed"): Promise<FakeOpencode> {
  const directory = await mkdtemp(join(tmpdir(), "openbot-acp-opencode-"));
  const executable = join(directory, "opencode");
  await writeFile(executable, FAKE_AGENT);
  await chmod(executable, 0o755);
  const envLog = join(directory, "spawn-env.ndjson");
  return {
    cli: { executable, version: "1.18.30", ...(source ? { source } : {}) },
    envLog,
    readSpawnEnvironments: async () => {
      const source = await readFile(envLog, "utf8").catch(() => "");
      return source
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line));
    },
  };
}

function startOpencode(cli: OpencodeCliInfo, apiKey: () => string | null, envLog: string): AgentClient {
  vi.stubEnv("OPENBOT_FAKE_ACP_ENV_LOG", envLog);
  const client = requireProviderDriver("opencode").createClient(cli, 10_000, { apiKey });
  started.push(client);
  client.start();
  return client;
}

describe("OpenCode ACP environment", () => {
  it("spawns the free tier without the key variable at all", async () => {
    const fake = await createFakeOpencodeAgent("system");
    const client = startOpencode(fake.cli, () => null, fake.envLog);

    await client.request("initialize", {}, decodeRecordResponse);

    // An empty `OPENCODE_API_KEY` is not the same as an absent one: the CLI reads it as an account
    // and lists nothing. A user with no account has to see the variable missing.
    const [environment] = await fake.readSpawnEnvironments();
    expect(environment).toEqual({ apiKey: null, disableAutoupdate: null, configContent: null });
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
});
