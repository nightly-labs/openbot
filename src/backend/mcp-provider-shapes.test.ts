import type { McpServerConfig } from "@openbot/contracts/ipc";
import { describe, expect, it } from "vitest";
import { acpMcpServers, claudeMcpServers, codexMcpServers, type UsableMcpServer } from "./mcp-provider-shapes";

function config(overrides: Partial<McpServerConfig>): McpServerConfig {
  return {
    id: "mcp-1",
    name: "posthog",
    transport: "http",
    enabled: true,
    command: "",
    args: [],
    env: [],
    envPassthrough: [],
    workingDirectory: "",
    url: "https://mcp.posthog.com/mcp",
    headers: [{ key: "Authorization", value: "Bearer test-key" }],
    ...overrides,
  };
}

function usable(overrides: Partial<McpServerConfig> = {}): UsableMcpServer {
  return { config: config(overrides), command: "", workingDirectory: "", path: null };
}

describe("codexMcpServers", () => {
  it("sends an http server as url with http_headers", () => {
    expect(codexMcpServers([usable()])).toEqual({
      posthog: {
        url: "https://mcp.posthog.com/mcp",
        http_headers: { Authorization: "Bearer test-key" },
      },
    });
  });

  it("keeps sending a stdio server as command, args and env", () => {
    const server: UsableMcpServer = {
      config: config({
        id: "mcp-2",
        name: "Filesystem",
        transport: "stdio",
        command: "server",
        args: ["--fast"],
        url: "",
        headers: [],
      }),
      command: "/bin/server",
      workingDirectory: "",
      path: null,
    };
    expect(codexMcpServers([server])).toEqual({
      Filesystem: { command: "/bin/server", args: ["--fast"], env: {} },
    });
  });

  it("leaves out errored servers and stdio servers with a working directory", () => {
    const failed: UsableMcpServer = { config: config({ name: "broken" }), error: "Command not found" };
    const directory: UsableMcpServer = {
      config: config({
        id: "mcp-3",
        name: "rooted",
        transport: "stdio",
        command: "server",
        url: "",
        headers: [],
        workingDirectory: "~/data",
      }),
      command: "/bin/server",
      workingDirectory: "/Users/test/data",
      path: null,
    };
    expect(codexMcpServers([failed, directory, usable()])).toEqual({
      posthog: {
        url: "https://mcp.posthog.com/mcp",
        http_headers: { Authorization: "Bearer test-key" },
      },
    });
  });
});

describe("claudeMcpServers and acpMcpServers", () => {
  it("both keep carrying the http server with its headers", () => {
    expect(claudeMcpServers([usable()])).toEqual({
      posthog: {
        type: "http",
        url: "https://mcp.posthog.com/mcp",
        headers: { Authorization: "Bearer test-key" },
      },
    });
    expect(acpMcpServers([usable()])).toEqual([
      {
        type: "http",
        name: "posthog",
        url: "https://mcp.posthog.com/mcp",
        headers: [{ name: "Authorization", value: "Bearer test-key" }],
      },
    ]);
  });
});
