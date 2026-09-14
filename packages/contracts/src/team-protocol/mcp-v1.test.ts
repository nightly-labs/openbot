import { describe, expect, it } from "vitest";
import { isMcpRoute, MCP_ROUTES, mcpEvent, mcpRequest, mcpResponse } from "./mcp-v1";

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
const entry = { config, state: "connected", toolCount: 4, error: null };

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

  // Every route answers with the whole list, so the panel never merges a partial result.
  it("round-trips the list answer of every route", () => {
    for (const route of Object.values(MCP_ROUTES)) expect(mcpResponse(route, 200, [entry])).toEqual([entry]);
    expect(mcpResponse(MCP_ROUTES.list, 403, { error: "Only an admin can do this." })).toEqual({
      error: "Only an admin can do this.",
    });
    expect(() => mcpResponse(MCP_ROUTES.list, 200, [{ ...entry, state: "ready" }])).toThrow();
    expect(() => mcpResponse(MCP_ROUTES.list, 200, entry)).toThrow();
  });

  it("decodes a status event and nothing else", () => {
    const statuses = [{ id: "mcp-1", state: "failed", toolCount: 0, error: "Command not found: npx" }];
    expect(mcpEvent({ type: "mcp-servers-changed", statuses })).toEqual({ type: "mcp-servers-changed", statuses });
    expect(mcpEvent({ type: "channels-changed", channels: [] })).toBeNull();
    expect(() => mcpEvent({ type: "mcp-servers-changed", statuses: [{ ...statuses[0], state: "ready" }] })).toThrow();
  });

  // The event carries statuses only. A configuration holds env values and headers, and an event is
  // broadcast, so a decoder that let one through would send secrets to every peer.
  it("drops a configuration smuggled onto a status", () => {
    const event = mcpEvent({
      type: "mcp-servers-changed",
      statuses: [{ id: "mcp-1", state: "connected", toolCount: 4, error: null, config }],
    });
    expect(event?.statuses[0]).toEqual({ id: "mcp-1", state: "connected", toolCount: 4, error: null });
  });
});
