import type { McpServerConfig } from "@openbot/contracts/ipc";
import {
  isSecretName,
  isStandardProcessVariable,
  type LogValue,
  redactText,
  registerSecretValue,
  toLogValue,
} from "@openbot/logging";
import { mcpEnvironment } from "./mcp-provider-shapes";

const MASK = "•••";

/**
 * Removes one configuration's own secrets from a piece of text.
 *
 * Storing the values was a product decision; showing them again was not. A transport reports a
 * failure by quoting what it sent, so a header value or an API key reaches an error message, a log
 * line, and an `McpTestResult.error` unless this runs first. `redactText` covers the patterns
 * shared across the app; this covers the values only this configuration knows.
 */
export function redactMcpSecrets(text: string, config: McpServerConfig): string {
  return redactMcpValues(text, mcpSecretValues([config]));
}

/**
 * The same against values collected earlier, for a reader that cannot use the configuration as it
 * stands now.
 *
 * A provider process keeps the credentials it was given until it stops, and the user can edit or
 * disable a server while that process still runs. Its stderr then quotes the old value, which the
 * new configuration no longer names. The caller retains what it handed over and passes it here.
 */
export function redactMcpValues(text: string, values: Iterable<string>): string {
  return redactText(maskValues(text, values));
}

/**
 * The same for a record that a provider sends, such as a notification or a history item.
 *
 * The shared rules run first, so a key such as `refresh_token` is redacted before a known value can
 * change its name. Then each string, key and number is masked on its own. Masking the serialized
 * record instead would cut a JSON literal out of it when a known value is `true` or `null`.
 */
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
  return mask(toLogValue(record));
}

function maskValues(text: string, values: Iterable<string>): string {
  let result = text;
  for (const value of values) {
    if (value.length < 4) continue;
    result = result.split(value).join(MASK);
  }
  return result;
}

/**
 * Adds this configuration's labelled secrets to the process-wide mask, so a log line that has no
 * configuration at hand still hides them.
 *
 * Only values under a secret name go there: `Content-Type: application/json` or `NODE_ENV=production`
 * would erase ordinary text from every log. The unlabelled rest stays masked by
 * `redactMcpSecrets` on the paths that know the configuration.
 */
export function registerMcpSecretValues(config: McpServerConfig): void {
  for (const [name, value] of Object.entries(mcpEnvironment(config))) {
    if (isSecretName(name)) registerSecretValue(value);
  }
  for (const pair of config.headers) {
    if (isSecretName(pair.key)) registerSecretValue(pair.value);
  }
}

/**
 * Every secret value these configurations carry, without duplicates.
 *
 * The environment is read from `mcpEnvironment`, not from `config.env`, because that is what the
 * server is actually started with: a credential named by `envPassthrough` is inherited from this
 * machine and never appears in `config.env`, so reading the stored pairs alone would let it out.
 *
 * A standard process variable is not a secret. A stdio server may be configured with `USER`, `HOME`
 * and `PATH`, so `USER` holds an account name and `HOME` a path; masking `USER=openbot` hides that
 * name in every line an agent writes, while `DATABASE_URL` and other unlabelled credentials stay
 * masked because their names are not on the list.
 */
export function mcpSecretValues(configs: readonly McpServerConfig[]): string[] {
  const values = new Set<string>();
  for (const config of configs) {
    for (const [name, value] of Object.entries(mcpEnvironment(config))) {
      if (!isStandardProcessVariable(name)) values.add(value);
    }
    for (const pair of config.headers) values.add(pair.value);
    for (const value of urlQueryValues(config.url)) values.add(value);
  }
  // A short value is left alone - masking a two-character value would hide ordinary words.
  return [...values].filter((value) => value.length >= 4);
}

/**
 * A link from a service such as Composio names the user or the session in its query, and anyone
 * with the link can use it. The whole query is masked as a transport quotes it. Each value alone is
 * not: a value such as `default` would then be masked in every error. The path is left alone so the
 * error still says which server failed.
 */
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
