// Frozen optional mcp-servers-v1 wire contract. Keep IPC types and limits out of this file: every
// bound is written as a literal, so a change to `INPUT_LIMITS` cannot move a shipped wire contract.
//
// What this contract grants was a deliberate product decision and is recorded here because freezing
// it makes it permanent: an admin session on a joined server can save an enabled stdio
// configuration, which makes the host machine spawn that process, and every response carries the
// full `env` and header values the host holds. `requireAdmin` on all four routes is the only gate.
// Narrowing that later needs a second capability string, never an edit to this one.
import { isDynamicRecord, isString } from "../runtime-values";
import type { TeamProtocolV2Json } from "./v2";

export const MCP_ROUTES = {
  list: "/v1/mcp-servers",
  save: "/v1/mcp-servers/save",
  remove: "/v1/mcp-servers/delete",
  toggle: "/v1/mcp-servers/toggle",
} as const;

type Decoder = (value: unknown) => TeamProtocolV2Json;
type Fields = Record<string, Decoder>;

const MCP_STATES = ["connected", "connecting", "failed", "disabled"] as const;

// The typed primitives come first and the combinators wrap them, so `mcpEvent` can build the event
// it promises without an assertion.
function text(value: unknown, maximum: number): string {
  if (!isString(value) || value.length > maximum) throw new Error("Invalid MCP text.");
  return value;
}
function identifierText(value: unknown): string {
  if (!isString(value) || !value.length || value.length > 128) throw new Error("Invalid MCP identifier.");
  return value;
}
function toolCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 10_000)
    throw new Error("Invalid MCP tool count.");
  return value;
}
function connectionState(value: unknown): McpServersChangedEvent["statuses"][number]["state"] {
  const state = MCP_STATES.find((candidate) => candidate === value);
  if (!state) throw new Error("Invalid MCP state.");
  return state;
}

const string =
  (maximum: number): Decoder =>
  (value) =>
    text(value, maximum);
const identifier: Decoder = identifierText;
const boolean: Decoder = (value) => {
  if (typeof value !== "boolean") throw new Error("Invalid MCP flag.");
  return value;
};
const count: Decoder = toolCount;
const oneOf =
  (...choices: string[]): Decoder =>
  (value) => {
    if (!isString(value) || !choices.includes(value)) throw new Error("Invalid MCP state.");
    return value;
  };
const nullable =
  (decode: Decoder): Decoder =>
  (value) =>
    value === null ? null : decode(value);
const list =
  (decode: Decoder, maximum: number): Decoder =>
  (value) => {
    if (!Array.isArray(value) || value.length > maximum) throw new Error("Invalid MCP list.");
    return value.map(decode);
  };
function record(value: unknown, fields: Fields): Record<string, TeamProtocolV2Json> {
  if (!isDynamicRecord(value)) throw new Error("Invalid MCP record.");
  return Object.fromEntries(Object.entries(fields).map(([key, decode]) => [key, decode(value[key])]));
}

const pair: Decoder = (value) => record(value, { key: string(255), value: string(8_192) });
// An id that is empty means "not saved yet", which `identifier` rejects, so the draft id is its own
// bound: the create form and the edit form send the same shape.
const draftIdentifier: Decoder = (value) => {
  if (!isString(value) || value.length > 128) throw new Error("Invalid MCP identifier.");
  return value;
};
const configFields: Fields = {
  id: draftIdentifier,
  name: string(80),
  transport: oneOf("stdio", "http"),
  enabled: boolean,
  command: string(4_096),
  args: list(string(4_096), 64),
  env: list(pair, 64),
  envPassthrough: list(string(255), 64),
  workingDirectory: string(4_096),
  url: string(2_048),
  headers: list(pair, 32),
};
const config: Decoder = (value) => record(value, configFields);
const entry: Decoder = (value) =>
  record(value, {
    config,
    state: oneOf(...MCP_STATES),
    toolCount: count,
    error: nullable(string(2_000)),
  });
const entries: Decoder = list(entry, 32);

const MCP_ROUTE_PATHS: ReadonlySet<string> = new Set(Object.values(MCP_ROUTES));

export function isMcpRoute(path: string): boolean {
  return MCP_ROUTE_PATHS.has(new URL(path, "http://openbot.invalid").pathname);
}

export function mcpRequest(path: string, value: unknown): TeamProtocolV2Json {
  const pathname = new URL(path, "http://openbot.invalid").pathname;
  if (pathname === MCP_ROUTES.list) return {};
  if (pathname === MCP_ROUTES.save) return record(value, { config });
  if (pathname === MCP_ROUTES.remove) return record(value, { mcpServerId: identifier });
  if (pathname === MCP_ROUTES.toggle) return record(value, { mcpServerId: identifier, enabled: boolean });
  throw new Error("Unknown MCP route.");
}

export function mcpResponse(path: string, status: number, value: unknown): TeamProtocolV2Json {
  if (status >= 400) return record(value, { error: string(100_000) });
  const pathname = new URL(path, "http://openbot.invalid").pathname;
  // Every route answers with the whole list, so the panel never merges a partial result.
  if (MCP_ROUTE_PATHS.has(pathname)) return entries(value);
  throw new Error("Unknown MCP route.");
}

/**
 * Statuses only. A configuration carries `env` values and header values, so it must never ride a
 * broadcast event; the separate status shape is the reason it cannot.
 */
export type McpServersChangedEvent = {
  type: "mcp-servers-changed";
  statuses: Array<{
    id: string;
    // Written out rather than imported: the states are part of the frozen contract, and a later
    // state added to the IPC union must not change what a shipped peer is promised here.
    state: "connected" | "connecting" | "failed" | "disabled";
    toolCount: number;
    error: string | null;
  }>;
};

export function mcpEvent(value: unknown): McpServersChangedEvent | null {
  if (!isDynamicRecord(value) || value.type !== "mcp-servers-changed") return null;
  const raw = value.statuses;
  if (!Array.isArray(raw) || raw.length > 32) throw new Error("Invalid MCP list.");
  const statuses = raw.map((item) => {
    if (!isDynamicRecord(item)) throw new Error("Invalid MCP record.");
    return {
      id: identifierText(item.id),
      state: connectionState(item.state),
      toolCount: toolCount(item.toolCount),
      error: item.error === null ? null : text(item.error, 2_000),
    };
  });
  return { type: "mcp-servers-changed", statuses };
}
