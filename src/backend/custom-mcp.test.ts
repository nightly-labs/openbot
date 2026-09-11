import { describe, expect, it } from "vitest";
import { type CustomMcpConfig, toAcpMcpServers, toClaudeMcpServers, toCodexMcpServers } from "./custom-mcp";

const stdio: CustomMcpConfig = {
  id: "notes",
  name: "Notes",
  transport: "stdio",
  command: "npx",
  args: ["-y", "@example/notes"],
  env: [{ name: "NOTES_TOKEN", value: "secret" }],
};

const http: CustomMcpConfig = {
  id: "linear",
  name: "Linear",
  transport: "http",
  url: "https://mcp.linear.app/mcp",
  headers: [{ name: "Authorization", value: "Bearer token" }],
};

describe("custom MCP provider translations", () => {
  it("names an ACP stdio server by its id and keeps env as name/value pairs", () => {
    expect(toAcpMcpServers([stdio, http])).toEqual([
      {
        type: "stdio",
        name: "notes",
        command: "npx",
        args: ["-y", "@example/notes"],
        env: [{ name: "NOTES_TOKEN", value: "secret" }],
      },
      {
        type: "http",
        name: "linear",
        url: "https://mcp.linear.app/mcp",
        headers: [{ name: "Authorization", value: "Bearer token" }],
      },
    ]);
  });

  it("keys Claude and Codex servers by id and turns env into a record", () => {
    expect(toClaudeMcpServers([stdio, http])).toEqual({
      notes: { command: "npx", args: ["-y", "@example/notes"], env: { NOTES_TOKEN: "secret" } },
      linear: {
        type: "http",
        url: "https://mcp.linear.app/mcp",
        headers: { Authorization: "Bearer token" },
      },
    });
    expect(toCodexMcpServers([stdio, http])).toEqual({
      notes: {
        command: "npx",
        args: ["-y", "@example/notes"],
        env: { NOTES_TOKEN: "secret" },
        enabled: true,
      },
      linear: {
        url: "https://mcp.linear.app/mcp",
        http_headers: { Authorization: "Bearer token" },
        enabled: true,
      },
    });
  });
});
