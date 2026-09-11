// The renderer-to-main payload that can carry an env value or a header value. No message here
// quotes any part of the input, because the field it would name is a credential.

import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type {
  CustomMcpEnvVar,
  CustomMcpHeader,
  DeleteCustomMcpInput,
  SaveCustomMcpInput,
} from "@openbot/contracts/ipc";
import { CUSTOM_MCP_LIMITS, isCustomMcpId, isCustomMcpNameToken } from "@openbot/contracts/ipc";
import { isString } from "@openbot/contracts/runtime-values";
import { isObject, requireString } from "./validation";

function parseServerId(value: unknown): string {
  if (!isCustomMcpId(value)) {
    throw new Error("A server ID must be lowercase letters, digits, `-` or `_`, and must not be an OpenBot server.");
  }
  return value;
}

function parseNamedValues(
  value: unknown,
  kind: "environment variable" | "header",
  limit: number,
): CustomMcpEnvVar[] | CustomMcpHeader[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`The ${kind}s are not a list.`);
  if (value.length > limit) throw new Error(`There are too many ${kind}s.`);
  const entries: CustomMcpEnvVar[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!isObject(entry)) throw new Error(`Every ${kind} needs a name and a value.`);
    if (!isCustomMcpNameToken(entry.name)) {
      throw new Error(`A ${kind} name has a character that is not allowed.`);
    }
    if (entry.name.length > INPUT_LIMITS.identifier) throw new Error(`A ${kind} name is too long.`);
    const lower = entry.name.toLowerCase();
    if (seen.has(lower)) throw new Error(`Two ${kind}s have the same name.`);
    seen.add(lower);
    if (!isString(entry.value) || entry.value.length > CUSTOM_MCP_LIMITS.secret) {
      throw new Error(`A ${kind} value is missing or too long.`);
    }
    entries.push({ name: entry.name, value: entry.value });
  }
  return entries;
}

function parseArgs(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("The arguments are not a list.");
  if (value.length > CUSTOM_MCP_LIMITS.args) throw new Error("There are too many arguments.");
  return value.map((entry) => {
    if (!isString(entry) || entry.length > CUSTOM_MCP_LIMITS.command) {
      throw new Error("An argument is missing or too long.");
    }
    if (entry.includes("\0")) throw new Error("An argument contains a character that is not allowed.");
    return entry;
  });
}

function parseCommand(value: unknown): string {
  const text = requireString(value, "Command", CUSTOM_MCP_LIMITS.command).trim();
  if (text.includes("\0") || text.includes("\n")) {
    throw new Error("The command must be an executable, not a shell line.");
  }
  return text;
}

function parseUrl(value: unknown): string {
  const text = requireString(value, "URL", CUSTOM_MCP_LIMITS.url);
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new Error("The URL is not a URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("The URL must start with http:// or https://.");
  }
  if (url.username || url.password) {
    throw new Error("The URL must hold no username or password. Put the credential in a header.");
  }
  return text;
}

export function parseSaveCustomMcp(input: unknown): SaveCustomMcpInput {
  if (!isObject(input)) throw new Error("Invalid MCP server.");
  const id = parseServerId(input.id);
  const name = requireString(input.name, "Display name", INPUT_LIMITS.agentName);
  if (input.transport === "stdio") {
    return {
      id,
      name,
      transport: "stdio",
      command: parseCommand(input.command),
      args: parseArgs(input.args),
      env: parseNamedValues(input.env, "environment variable", CUSTOM_MCP_LIMITS.env),
    };
  }
  if (input.transport === "http") {
    return {
      id,
      name,
      transport: "http",
      url: parseUrl(input.url),
      headers: parseNamedValues(input.headers, "header", CUSTOM_MCP_LIMITS.headers),
    };
  }
  throw new Error("Choose a local command or an HTTP URL.");
}

export function parseSetCustomMcpFullAccess(input: unknown): { enabled: boolean } {
  if (!isObject(input) || typeof input.enabled !== "boolean") throw new Error("Choose whether MCP has full access.");
  return { enabled: input.enabled };
}

export function parseDeleteCustomMcp(input: unknown): DeleteCustomMcpInput {
  if (!isObject(input)) throw new Error("Invalid MCP server.");
  return { id: parseServerId(input.id) };
}
