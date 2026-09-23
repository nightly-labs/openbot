/**
 * Where a typed credential ends up, which is the one thing in the connect step that the user cannot
 * see: a header on an http server, an environment value on a command, written byte for byte.
 */

import type { McpServerConfig } from "@openbot/contracts/ipc";
import { applyMcpFlow, type McpKeyFlow, mcpFlowComplete } from "@openbot/ui/features/settings/mcp-connect-auth";
import { describe, expect, it } from "vitest";

const HTTP: McpServerConfig = {
  id: "",
  name: "figma",
  transport: "http",
  enabled: true,
  command: "",
  args: [],
  env: [],
  envPassthrough: [],
  workingDirectory: "",
  url: "https://mcp.figma.com/mcp",
  headers: [{ key: "X-Figma-Token", value: "stale" }],
};

const STDIO: McpServerConfig = { ...HTTP, transport: "stdio", command: "npx", args: ["-y", "a-bridge"], headers: [] };

const KEY: McpKeyFlow = {
  id: "token",
  kind: "key",
  label: "Token",
  fields: [{ id: "token", label: "Token", header: "X-Figma-Token", env: "FIGMA_TOKEN", prefix: "Bearer " }],
};

describe("applyMcpFlow", () => {
  it("writes the prefix and the typed value as one header, replacing the one already there", () => {
    expect(applyMcpFlow(HTTP, KEY, { token: "figd_1" }).headers).toEqual([
      { key: "X-Figma-Token", value: "Bearer figd_1" },
    ]);
  });

  it("writes the value into the environment of a server that runs a command", () => {
    const applied = applyMcpFlow(STDIO, KEY, { token: "figd_1" });
    expect(applied.env).toEqual([{ key: "FIGMA_TOKEN", value: "Bearer figd_1" }]);
    expect(applied.headers).toEqual([]);
  });

  it("keeps the value the user typed, including the spaces around it", () => {
    const flow: McpKeyFlow = { ...KEY, fields: [{ id: "token", label: "Token", header: "X-Figma-Token" }] };
    expect(applyMcpFlow(HTTP, flow, { token: " figd_1 " }).headers).toEqual([
      { key: "X-Figma-Token", value: " figd_1 " },
    ]);
  });

  it("leaves a blank field out rather than sending an empty credential", () => {
    expect(applyMcpFlow(HTTP, KEY, { token: "" }).headers).toEqual([{ key: "X-Figma-Token", value: "stale" }]);
  });

  it("changes nothing for a sign-in, which types no credential", () => {
    expect(applyMcpFlow(HTTP, { id: "oauth", kind: "link", label: "Sign in" }, {})).toEqual(HTTP);
  });
});

describe("mcpFlowComplete", () => {
  it("asks for every field, and counts spaces as nothing typed", () => {
    expect(mcpFlowComplete(KEY, {})).toBe(false);
    expect(mcpFlowComplete(KEY, { token: "   " })).toBe(false);
    expect(mcpFlowComplete(KEY, { token: "figd_1" })).toBe(true);
  });

  it("is complete when the flow asks for nothing", () => {
    expect(mcpFlowComplete({ id: "oauth", kind: "link", label: "Sign in" }, {})).toBe(true);
  });
});
