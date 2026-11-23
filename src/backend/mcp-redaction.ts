import type { McpServerConfig } from "@openbot/contracts/ipc";
import { isSecretName, type LogValue, redactText, registerSecretValue, toSecretSafeValue } from "@openbot/logging";
import { mcpEnvironment } from "./mcp-provider-shapes";

const MASK = "•••";

export function redactMcpSecrets(text: string, config: McpServerConfig): string {
  return redactMcpValues(text, mcpSecretValues([config]));
}

export function redactMcpValues(text: string, values: Iterable<string>, rules = redactText): string {
  return rules(maskValues(text, values));
}

export function redactMcpRecord(record: unknown, values: Iterable<string>): LogValue {
  const known = [...values];
  const mask = (value: LogValue): LogValue => {
    if (typeof value === "string") return maskValues(value, known);
    if (typeof value === "number") {
      const masked = maskValues(String(value), known);
      return masked === String(value) ? value : masked;
    }
    if (Array.isArray(value)) return value.map(mask);
    if (value === null || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [maskValues(key, known), mask(entry)]));
  };
  return mask(toSecretSafeValue(record));
}

const CONFIG_LITERALS = new Set(["true", "false", "null", "none"]);

function maskValues(text: string, values: Iterable<string>): string {
  let result = text;
  for (const value of values) {
    if (value.length < 4 || CONFIG_LITERALS.has(value.toLowerCase())) continue;
    result = result.split(value).join(MASK);
  }
  return result;
}

export function registerMcpSecretValues(config: McpServerConfig): void {
  for (const [name, value] of Object.entries(mcpEnvironment(config))) {
    if (isSecretName(name)) registerSecretValue(value);
  }
  for (const pair of config.headers) {
    if (isSecretName(pair.key)) registerSecretValue(pair.value);
  }
}

export function mcpSecretValues(configs: readonly McpServerConfig[]): string[] {
  const values = new Set<string>();
  for (const config of configs) {
    for (const [name, value] of Object.entries(mcpEnvironment(config))) {
      if (!isInheritedProfileValue(name, value)) values.add(value);
    }
    for (const pair of config.headers) values.add(pair.value);
    for (const value of urlQueryValues(config.url)) values.add(value);
  }
  return [...values].filter((value) => value.length >= 4);
}

const USER_PROFILE_VARIABLES = new Set([
  "HOME",
  "USER",
  "LOGNAME",
  "TMPDIR",
  "PATH",
  "SHELL",
  "USERNAME",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "TEMP",
  "TMP",
  "SYSTEMROOT",
  "WINDIR",
]);

export function isInheritedProfileValue(name: string, value: string): boolean {
  return USER_PROFILE_VARIABLES.has(name.toUpperCase()) && process.env[name] === value;
}

function urlQueryValues(url: string): string[] {
  if (!url) return [];
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return [];
  }
  if (!parsed.search) return [];
  return [parsed.search.slice(1)];
}
