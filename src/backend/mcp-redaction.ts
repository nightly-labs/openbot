import type { McpServerConfig } from "@openbot/contracts/ipc";
import { redactText } from "@openbot/logging";
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
  let result = text;
  for (const value of values) {
    if (value.length < 4) continue;
    result = result.split(value).join(MASK);
  }
  return redactText(result);
}

/**
 * Every secret value these configurations carry, without duplicates.
 *
 * The environment is read from `mcpEnvironment`, not from `config.env`, because that is what the
 * server is actually started with: a credential named by `envPassthrough` is inherited from this
 * machine and never appears in `config.env`, so reading the stored pairs alone would let it out.
 */
export function mcpSecretValues(configs: readonly McpServerConfig[]): string[] {
  const values = new Set<string>();
  for (const config of configs) {
    for (const value of Object.values(mcpEnvironment(config))) values.add(value);
    for (const pair of config.headers) values.add(pair.value);
  }
  // A short value is left alone - masking a two-character value would hide ordinary words.
  return [...values].filter((value) => value.length >= 4);
}
