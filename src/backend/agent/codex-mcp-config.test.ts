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

describe("Codex MCP registration", () => {
  it("registers a disabled Windows server without credentials and reads the saved config", async () => {
    const saved = configResponse({ computer_use: { command: "openbot-mcp", enabled: false } });
    const client = new FakeAgentClient("codex", "DONE", true, true, {}, async (method) => {
      if (method === "config/batchWrite") client.configRead = saved;
    });
    client.configRead = configResponse();
    expect(
      await Promise.all([
        runCauseEffect(readCodexMcpConfig(client, [server])),
        runCauseEffect(readCodexMcpConfig(client, [server])),
      ]),
    ).toEqual([saved, saved]);
    expect(client.requests).toEqual([
      { method: "config/read", params: { includeLayers: true } },
      {
        method: "config/batchWrite",
        params: {
          edits: [
            {
              keyPath: "mcp_servers.computer_use",
              value: { command: "openbot-mcp", enabled: false },
              mergeStrategy: "replace",
            },
          ],
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
        codexDisabledServers(() => readCodexMcpConfig(client, [server]).pipe(toMcpShapeFailed)),
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

  it("registers custom HTTP and stdio servers without URLs, arguments, or secrets", async () => {
    const client = new FakeAgentClient("codex");
    client.configRead = configResponse();
    const configs: McpServerConfig[] = [
      {
        ...server,
        id: "http",
        name: "T3 MCP",
        transport: "http",
        url: "https://example.com/mcp?secret=private-url",
        headers: [{ key: "Authorization", value: "private-header" }],
      },
      { ...server, id: "stdio", name: "Local MCP", args: ["private-argument"] },
      { ...server, id: "duplicate", name: "T3_MCP" },
      { ...server, id: "disabled", name: "Disabled", enabled: false },
    ];
    const response = await runCauseEffect(readCodexMcpConfig(client, configs));
    expect(response).toMatchObject({
      config: {
        mcp_servers: {
          T3_MCP: { url: "http://127.0.0.1:1", enabled: false },
          Local_MCP: { command: "openbot-mcp", enabled: false },
        },
      },
    });
    expect(client.requests.filter((request) => request.method === "config/batchWrite")).toEqual([
      {
        method: "config/batchWrite",
        params: {
          edits: ["T3_MCP", "Local_MCP"].map((name) => ({
            keyPath: `mcp_servers.${name}`,
            value:
              name === "T3_MCP"
                ? { url: "http://127.0.0.1:1", enabled: false }
                : { command: "openbot-mcp", enabled: false },
            mergeStrategy: "replace",
          })),
          filePath: "C:\\Users\\Test\\.codex\\config.toml",
          expectedVersion: "config-version",
        },
      },
    ]);
  });

  it("keeps custom tool approvals and revocations across client restarts without changing user entries", async () => {
    const custom = { ...server, id: "custom", name: "T3 MCP", transport: "http" as const };
    for (const mode of ["approve", "prompt"]) {
      const tools = { t3_thread_read: { approval_mode: mode } };
      const saved = configResponse({ T3_MCP: { command: "user-command", enabled: true, tools } });
      const client = new FakeAgentClient("codex");
      client.configRead = saved;
      expect(
        await runCauseEffect(codexDisabledServers(() => readCodexMcpConfig(client, [custom]).pipe(toMcpShapeFailed))),
      ).toEqual({ T3_MCP: { enabled: false, tools } });
      expect(client.requests.map((request) => request.method)).toEqual(["config/read"]);
      expect(client.configRead).toEqual(saved);
    }
  });

  it("keeps tool policies when a managed server changes transport in either direction", async () => {
    const client = new FakeAgentClient("codex");
    const tools = { t3_thread_read: { approval_mode: "prompt" } };
    client.configRead = configResponse({ T3_MCP: { command: "openbot-mcp", enabled: false, tools } });
    const custom = { ...server, id: "custom", name: "T3 MCP" };
    for (const transport of ["http", "stdio"] as const) {
      const response = await runCauseEffect(readCodexMcpConfig(client, [{ ...custom, transport }]));
      expect(response).toMatchObject({
        config: {
          mcp_servers: {
            T3_MCP: {
              ...(transport === "http" ? { url: "http://127.0.0.1:1" } : { command: "openbot-mcp" }),
              enabled: false,
              tools,
            },
          },
        },
      });
    }
    expect(client.requests.filter((request) => request.method === "config/batchWrite")).toHaveLength(2);
  });

  it("does not register a server when no MCP servers are enabled", async () => {
    const client = new FakeAgentClient("codex");
    client.configRead = configResponse();
    await runCauseEffect(readCodexMcpConfig(client, []));
    expect(client.requests).toEqual([{ method: "config/read", params: { includeLayers: false } }]);
  });

  it("does not write without a user config version", async () => {
    const client = new FakeAgentClient("codex");
    client.configRead = { config: {} };
    await expect(runCauseEffect(readCodexMcpConfig(client, [server]))).rejects.toThrow("valid and writable");
    expect(client.requests.map((request) => request.method)).toEqual(["config/read"]);
  });

  it("stops when the provider rejects a stale version or a write", async () => {
    const client = new FakeAgentClient("codex", "DONE", true, true, {}, async (method) => {
      if (method === "config/batchWrite") throw new Error("Config version changed");
    });
    client.configRead = configResponse();
    await expect(runCauseEffect(readCodexMcpConfig(client, [server]))).rejects.toThrow("Config version changed");
    expect(client.requests.map((request) => request.method)).toEqual(["config/read", "config/batchWrite"]);
  });
});
