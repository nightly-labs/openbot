// @vitest-environment node
import { COMPUTER_USE_MCP_SERVER_ID, COMPUTER_USE_MCP_SERVER_NAME, type McpServerConfig } from "@openbot/contracts/ipc";
import { describe, expect, it } from "vitest";
import { FakeAgentClient } from "../agent-service-test-harness";
import { runCauseEffect } from "../effect-boundary";
import { codexDisabledServers, toMcpShapeFailed } from "../mcp-provider-shapes";
import { readCodexMcpConfig } from "./codex-mcp-config";

const server: McpServerConfig = {
  id: COMPUTER_USE_MCP_SERVER_ID,
  name: COMPUTER_USE_MCP_SERVER_NAME,
  transport: "stdio",
  enabled: true,
  command: "C:\\OpenBot\\cua-driver.exe",
  args: ["mcp", "--socket", "\\\\.\\pipe\\openbot-test"],
  env: [{ key: "PRIVATE_TOKEN", value: "must-not-be-saved" }],
  envPassthrough: [],
  workingDirectory: "",
  url: "",
  headers: [],
};

function configResponse(
  servers: Record<
    string,
    { command: string; enabled: boolean; tools?: Record<string, { approval_mode: string }> }
  > = {},
) {
  return {
    config: { mcp_servers: servers },
    layers: [
      {
        name: { type: "user", file: "C:\\Users\\Test\\.codex\\config.toml", profile: null },
        version: "config-version",
        config: { mcp_servers: servers },
        disabledReason: null,
      },
    ],
  };
}

describe("Codex Computer Use registration", () => {
  it("registers a disabled Windows server without credentials and reads the saved config", async () => {
    const saved = configResponse({ computer_use: { command: server.command, enabled: false } });
    const client = new FakeAgentClient("codex", "DONE", true, true, {}, async (method) => {
      if (method === "config/value/write") client.configRead = saved;
    });
    client.configRead = configResponse();
    expect(
      await Promise.all([
        runCauseEffect(readCodexMcpConfig(client, server)),
        runCauseEffect(readCodexMcpConfig(client, server)),
      ]),
    ).toEqual([saved, saved]);
    expect(client.requests).toEqual([
      { method: "config/read", params: { includeLayers: true } },
      {
        method: "config/value/write",
        params: {
          keyPath: "mcp_servers.computer_use",
          value: { command: server.command, enabled: false },
          mergeStrategy: "replace",
          filePath: "C:\\Users\\Test\\.codex\\config.toml",
          expectedVersion: "config-version",
        },
      },
      { method: "config/read", params: { includeLayers: false } },
      { method: "config/read", params: { includeLayers: true } },
    ]);
  });

  it("keeps saved set_value approval after restart and an executable update", async () => {
    const saved = configResponse({
      computer_use: {
        command: "C:\\OldOpenBot\\cua-driver.exe",
        enabled: false,
        tools: { set_value: { approval_mode: "approve" }, click: { approval_mode: "prompt" } },
      },
    });
    for (const client of [new FakeAgentClient("codex"), new FakeAgentClient("codex")]) {
      client.configRead = saved;
      const disabled = await runCauseEffect(
        codexDisabledServers(() => readCodexMcpConfig(client, server).pipe(toMcpShapeFailed)),
      );
      expect(disabled.computer_use).toEqual({
        enabled: false,
        tools: {
          set_value: { approval_mode: "approve" },
          click: { approval_mode: "prompt" },
        },
      });
      expect(client.requests.map((request) => request.method)).toEqual(["config/read"]);
      expect(client.configRead).toEqual(saved);
    }
  });

  it("does not register a server when Computer Use is off or unavailable", async () => {
    const client = new FakeAgentClient("codex");
    client.configRead = configResponse();
    await runCauseEffect(readCodexMcpConfig(client, undefined));
    expect(client.requests).toEqual([{ method: "config/read", params: { includeLayers: false } }]);
  });

  it("does not write without a user config version", async () => {
    const client = new FakeAgentClient("codex");
    client.configRead = { config: {} };
    await expect(runCauseEffect(readCodexMcpConfig(client, server))).rejects.toThrow("valid and writable");
    expect(client.requests.map((request) => request.method)).toEqual(["config/read"]);
  });

  it("stops when the provider rejects a stale version or a write", async () => {
    const client = new FakeAgentClient("codex", "DONE", true, true, {}, async (method) => {
      if (method === "config/value/write") throw new Error("Config version changed");
    });
    client.configRead = configResponse();
    await expect(runCauseEffect(readCodexMcpConfig(client, server))).rejects.toThrow("Config version changed");
    expect(client.requests.map((request) => request.method)).toEqual(["config/read", "config/value/write"]);
  });
});
