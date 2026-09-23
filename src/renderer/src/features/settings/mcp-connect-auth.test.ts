/**
 * Where a typed credential ends up, which is the one thing in the connect step that the user cannot
 * see: a header on an http server, an environment value on a command, written byte for byte.
 */

import type { McpServerConfig } from "@openbot/contracts/ipc";
import { isPluginAppConfig } from "@openbot/ui/features/settings/marketplace-plugins";
import {
  applyMcpFlow,
  type McpKeyFlow,
  mcpFlowComplete,
  mcpFlowError,
} from "@openbot/ui/features/settings/mcp-connect-auth";
import { describe, expect, it } from "vitest";
import { createPluginAppConfig, MARKETPLACE_PLUGINS } from "./marketplace-plugin-catalog";

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

describe("a link the user brings", () => {
  const COMPOSIO: McpServerConfig = { ...HTTP, name: "composio", url: "https://composio.dev/", headers: [] };
  const LINK: McpKeyFlow = {
    id: "link",
    kind: "key",
    label: "MCP link",
    fields: [
      { id: "url", label: "MCP URL", url: true },
      { id: "key", label: "API key", header: "x-api-key", optional: true },
    ],
  };
  const link = "https://backend.composio.dev/v3/mcp/server-id?user_id=me";

  it("connects to the typed link, with the key only when one is given", () => {
    expect(applyMcpFlow(COMPOSIO, LINK, { url: ` ${link} ` })).toMatchObject({ url: link, headers: [] });
    expect(applyMcpFlow(COMPOSIO, LINK, { url: link, key: "ak_1" }).headers).toEqual([
      { key: "x-api-key", value: "ak_1" },
    ]);
    expect(mcpFlowComplete(LINK, { url: link })).toBe(true);
    expect(mcpFlowComplete(LINK, { key: "ak_1" })).toBe(false);
  });

  it("refuses a link from another host or without https", () => {
    expect(mcpFlowError(COMPOSIO, LINK, { url: link })).toBeNull();
    for (const url of ["https://composio.dev.example.com/mcp", "http://backend.composio.dev/mcp", "not a link"]) {
      expect(mcpFlowError(COMPOSIO, LINK, { url })).toBe("Enter an https link from composio.dev.");
    }
  });
});

describe("isPluginAppConfig with a link the user brings", () => {
  const app = MARKETPLACE_PLUGINS.find((plugin) => plugin.slug === "composio")?.apps[0];

  it("owns the user's Composio link, and not a server of the same name elsewhere", () => {
    if (!app) throw new Error("The catalog has no Composio listing.");
    const saved = { ...createPluginAppConfig(app), url: "https://backend.composio.dev/v3/mcp/server-id?user_id=me" };
    expect(isPluginAppConfig(saved, app)).toBe(true);
    expect(isPluginAppConfig({ ...saved, url: "https://example.com/mcp" }, app)).toBe(false);
  });
});
