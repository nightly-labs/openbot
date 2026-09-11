// A custom MCP server is a local command or a remote HTTP endpoint the user names themselves.
// OpenBot injects it into the next provider session. Env values and header values are credentials:
// they travel renderer-to-main on `save` and must never come back, so both directions need one
// agreed shape and the guard below is what enforces the asymmetry.

import { INPUT_LIMITS } from "./input-limits";
import { isBoundedString } from "./ipc-bounded-values";
import { isDynamicRecord, isString } from "./runtime-values";

/**
 * Bounds are the MCP config shape rather than an OpenBot object: a command line, a URL, and a
 * small env or header list. `INPUT_LIMITS` has no entry for a command or an env value because no
 * other OpenBot payload has ever carried one.
 */
export const CUSTOM_MCP_LIMITS = {
  command: 2_048,
  url: 2_048,
  args: 32,
  env: 32,
  headers: 32,
  secret: 4_096,
  servers: 32,
} as const;

/** A server name in every provider's MCP map, so lowercase and free of separators. */
export const CUSTOM_MCP_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

/** RFC 9110 field-name token characters, reused for env names. */
export const CUSTOM_MCP_NAME_PATTERN = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;

/** OpenBot's own MCP servers. A user entry under one of these names would replace the app's tools. */
export const CUSTOM_MCP_RESERVED_IDS = ["openbot", "openbot_browser"] as const;

export const CUSTOM_MCP_TRANSPORTS = ["stdio", "http"] as const;
export type CustomMcpTransport = (typeof CUSTOM_MCP_TRANSPORTS)[number];

export interface CustomMcpEnvVar {
  name: string;
  value: string;
}

export interface CustomMcpHeader {
  name: string;
  value: string;
}

/**
 * Renderer to main. This payload can carry env values or header values, so nothing on this path
 * may log it.
 */
export type SaveCustomMcpInput =
  | {
      id: string;
      name: string;
      transport: "stdio";
      command: string;
      args: string[];
      env: CustomMcpEnvVar[];
    }
  | {
      id: string;
      name: string;
      transport: "http";
      url: string;
      headers: CustomMcpHeader[];
    };

export interface DeleteCustomMcpInput {
  id: string;
}

/**
 * Main to renderer. Env values, header values, and command arguments never come back: arguments
 * are as often a token as an env value is.
 */
export type CustomMcpSummary =
  | {
      id: string;
      name: string;
      transport: "stdio";
      command: string;
      hasSecrets: boolean;
    }
  | {
      id: string;
      name: string;
      transport: "http";
      url: string;
      hasSecrets: boolean;
    };

export interface CustomMcpResult {
  servers: CustomMcpSummary[];
}

/** Whether MCP servers may act without a per-request prompt. */
export interface CustomMcpFullAccessPreference {
  enabled: boolean;
}

export interface SetCustomMcpFullAccessInput {
  enabled: boolean;
}

export function isCustomMcpId(value: unknown): value is string {
  return (
    isBoundedString(value, INPUT_LIMITS.identifier) &&
    CUSTOM_MCP_ID_PATTERN.test(value) &&
    !CUSTOM_MCP_RESERVED_IDS.some((reserved) => reserved === value)
  );
}

export function isCustomMcpNameToken(value: unknown): value is string {
  return isString(value) && value.length > 0 && CUSTOM_MCP_NAME_PATTERN.test(value);
}

/**
 * Rejects a record that carries `env`, `headers`, `args`, or a `value` key at all, not merely one
 * whose secret is a string. That makes "the renderer never sees a credential" a fact the boundary
 * checks. Like `isCustomProviderSummary`, it fails closed: one bad row empties the whole list.
 */
export function isCustomMcpSummary(value: unknown): value is CustomMcpSummary {
  if (
    !isDynamicRecord(value) ||
    "env" in value ||
    "headers" in value ||
    "args" in value ||
    "value" in value ||
    !isCustomMcpId(value.id) ||
    !isBoundedString(value.name, INPUT_LIMITS.agentName) ||
    typeof value.hasSecrets !== "boolean"
  ) {
    return false;
  }
  if (value.transport === "stdio") {
    return isBoundedString(value.command, CUSTOM_MCP_LIMITS.command) && !("url" in value);
  }
  if (value.transport === "http") {
    return isBoundedString(value.url, CUSTOM_MCP_LIMITS.url) && !("command" in value);
  }
  return false;
}

export function isCustomMcpResult(value: unknown): value is CustomMcpResult {
  return (
    isDynamicRecord(value) &&
    Array.isArray(value.servers) &&
    value.servers.length <= CUSTOM_MCP_LIMITS.servers &&
    value.servers.every(isCustomMcpSummary)
  );
}

export function isCustomMcpFullAccessPreference(value: unknown): value is CustomMcpFullAccessPreference {
  return isDynamicRecord(value) && typeof value.enabled === "boolean";
}
