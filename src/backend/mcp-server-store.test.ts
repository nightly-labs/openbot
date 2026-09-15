// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { McpServerConfig } from "@openbot/contracts/ipc";
import { afterEach, describe, expect, it } from "vitest";
import { McpServerStore } from "./mcp-server-store";
import { OpenBotDatabase } from "./openbot-database";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("McpServerStore", () => {
  it("keeps the order of args, env, and headers across a restart", async () => {
    const { database, store } = await setup();
    const saved = store.save(
      stdioConfig({
        args: ["--database", "./openbot.db", "--verbose"],
        env: [
          { key: "SQLITE_READONLY", value: "1" },
          { key: "TOKEN", value: "secret-value" },
        ],
        envPassthrough: ["HOME", "PATH"],
      }),
    );
    database.close();

    const reopened = new OpenBotDatabase(database.userDataPath);
    await reopened.initialize();
    const [config] = new McpServerStore(reopened).list();
    expect(config).toEqual({ ...saved, id: saved.id });
    expect(config?.args).toEqual(["--database", "./openbot.db", "--verbose"]);
    expect(config?.env).toEqual([
      { key: "SQLITE_READONLY", value: "1" },
      { key: "TOKEN", value: "secret-value" },
    ]);
    expect(config?.envPassthrough).toEqual(["HOME", "PATH"]);
    reopened.close();
  });

  // A value is a credential. A password with a leading or trailing space is a different password,
  // and the form's change check runs the same normalization, so a stored one could not be corrected.
  it("keeps a credential's own spaces and drops a row with no name", async () => {
    const { store } = await setup();
    const saved = store.save(
      stdioConfig({
        env: [
          { key: " TOKEN ", value: " padded secret " },
          { key: "   ", value: "no name" },
        ],
      }),
    );
    expect(saved.env).toEqual([{ key: "TOKEN", value: " padded secret " }]);
  });

  it("clears the fields of the transport that is not in use", async () => {
    const { store } = await setup();
    const saved = store.save({
      ...stdioConfig(),
      transport: "http",
      url: "https://mcp.example.com/mcp",
      headers: [{ key: "Authorization", value: "Bearer abc" }],
    });
    expect(saved.command).toBe("");
    expect(saved.args).toEqual([]);
    expect(saved.env).toEqual([]);
    expect(saved.workingDirectory).toBe("");
  });

  it("explains a duplicate name and a reserved name instead of raising a constraint error", async () => {
    const { store } = await setup();
    store.save(stdioConfig({ name: "Local SQLite" }));
    expect(() => store.save(stdioConfig({ name: "Local SQLite" }))).toThrow(
      "An MCP server named Local SQLite already exists.",
    );
    expect(() => store.save(stdioConfig({ name: "openbot" }))).toThrow("OpenBot already uses the name openbot.");
  });

  it("omits a disabled server from the enabled list", async () => {
    const { store } = await setup();
    const enabled = store.save(stdioConfig({ name: "Kept" }));
    const disabled = store.save(stdioConfig({ name: "Turned off" }));
    store.setEnabled(disabled.id, false);
    expect(store.listEnabled().map((config) => config.id)).toEqual([enabled.id]);
    expect(store.list()).toHaveLength(2);
  });

  it("stops at the configured number of MCP servers", async () => {
    const { store } = await setup();
    for (let index = 0; index < INPUT_LIMITS.mcpServers; index += 1)
      store.save(stdioConfig({ name: `Server ${index}` }));
    expect(() => store.save(stdioConfig({ name: "One too many" }))).toThrow(
      `OpenBot keeps up to ${INPUT_LIMITS.mcpServers} MCP servers.`,
    );
  });

  it("rejects a row whose environment is not a list of string pairs", async () => {
    const { database, store } = await setup();
    const saved = store.save(stdioConfig());
    database.connection
      .prepare("UPDATE projection_mcp_servers SET env_json = ? WHERE mcp_server_id = ?")
      .run(JSON.stringify([{ key: "TOKEN", value: 7 }]), saved.id);
    expect(() => store.list()).toThrow("Invalid SQLite column env_json.");
  });

  it("removes a server and keeps the rest", async () => {
    const { store } = await setup();
    const first = store.save(stdioConfig({ name: "First" }));
    const second = store.save(stdioConfig({ name: "Second" }));
    store.remove(first.id);
    expect(store.list().map((config) => config.id)).toEqual([second.id]);
  });
});

function stdioConfig(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    id: "",
    name: "Local SQLite",
    transport: "stdio",
    enabled: true,
    command: "openbot-dev-mcp",
    args: [],
    env: [],
    envPassthrough: [],
    workingDirectory: "",
    url: "",
    headers: [],
    ...overrides,
  };
}

async function setup(): Promise<{ database: OpenBotDatabase; store: McpServerStore }> {
  const root = await mkdtemp(join(tmpdir(), "openbot-mcp-store-"));
  roots.push(root);
  const database = new OpenBotDatabase(root);
  await database.initialize();
  return { database, store: new McpServerStore(database) };
}
