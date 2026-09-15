import { describe, expect, it } from "vitest";
import { isMcpRoute, MCP_ROUTES, mcpRequest, mcpResponse } from "./mcp-v1";

const config = {
  id: "mcp-1",
  name: "Filesystem",
  transport: "stdio",
  enabled: true,
  command: "/usr/local/bin/npx",
  args: ["-y", "@modelcontextprotocol/server-filesystem"],
  env: [{ key: "TOKEN", value: "secret" }],
  envPassthrough: ["HOME"],
  workingDirectory: "/Users/one/Projects",
  url: "",
  headers: [],
};

describe("mcp-v1", () => {
  it("matches only its own routes", () => {
    for (const route of Object.values(MCP_ROUTES)) expect(isMcpRoute(route)).toBe(true);
    expect(isMcpRoute("/v1/channels")).toBe(false);
    expect(isMcpRoute("/v1/mcp-servers/unknown")).toBe(false);
  });

  it("round-trips every request", () => {
    expect(mcpRequest(MCP_ROUTES.list, {})).toEqual({});
    expect(mcpRequest(MCP_ROUTES.save, { config })).toEqual({ config });
    expect(mcpRequest(MCP_ROUTES.remove, { mcpServerId: "mcp-1" })).toEqual({ mcpServerId: "mcp-1" });
    expect(mcpRequest(MCP_ROUTES.toggle, { mcpServerId: "mcp-1", enabled: false })).toEqual({
      mcpServerId: "mcp-1",
      enabled: false,
    });
    expect(mcpRequest(MCP_ROUTES.test, { config })).toEqual({ config });
  });

  // A create sends the same shape as an edit, with an id that is not written yet.
  it("accepts a draft id on a save", () => {
    expect(mcpRequest(MCP_ROUTES.save, { config: { ...config, id: "" } })).toEqual({ config: { ...config, id: "" } });
  });

  it("rejects a malformed payload", () => {
    expect(() => mcpRequest(MCP_ROUTES.save, { config: { ...config, transport: "websocket" } })).toThrow();
    expect(() => mcpRequest(MCP_ROUTES.save, { config: { ...config, env: [{ key: "TOKEN", value: 7 }] } })).toThrow();
    expect(() => mcpRequest(MCP_ROUTES.remove, { mcpServerId: "" })).toThrow();
    expect(() => mcpRequest(MCP_ROUTES.toggle, { mcpServerId: "mcp-1" })).toThrow();
    expect(() => mcpRequest("/v1/channels", {})).toThrow();
  });

  // Every route but the test answers with the whole list, so the panel never merges a partial result.
  it("round-trips the list answer of every route", () => {
    for (const route of Object.values(MCP_ROUTES)) {
      if (route === MCP_ROUTES.test) continue;
      expect(mcpResponse(route, 200, [config])).toEqual([config]);
    }
    expect(mcpResponse(MCP_ROUTES.list, 403, { error: "Only an admin can do this." })).toEqual({
      error: "Only an admin can do this.",
    });
    expect(() => mcpResponse(MCP_ROUTES.list, 200, [{ ...config, transport: "websocket" }])).toThrow();
    expect(() => mcpResponse(MCP_ROUTES.list, 200, config)).toThrow();
  });

  // A test answers what one connection found and nothing else. A configuration in the answer would
  // be the host sending back env values and headers no one asked for.
  it("round-trips a test answer and drops anything else on it", () => {
    expect(mcpResponse(MCP_ROUTES.test, 200, { toolCount: 4, error: null })).toEqual({ toolCount: 4, error: null });
    expect(mcpResponse(MCP_ROUTES.test, 200, { toolCount: 0, error: "Command not found: npx", config })).toEqual({
      toolCount: 0,
      error: "Command not found: npx",
    });
    expect(() => mcpResponse(MCP_ROUTES.test, 200, { toolCount: -1, error: null })).toThrow();
  });
});
