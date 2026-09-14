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
  return redactText(maskSecretsOf(text, config));
}

/**
 * The same, for a piece of text that could quote any of several configurations - a provider's
 * stderr, which carries every MCP server that provider was given.
 */
export function redactAllMcpSecrets(text: string, configs: readonly McpServerConfig[]): string {
  let result = text;
  for (const config of configs) result = maskSecretsOf(result, config);
  return redactText(result);
}

/**
 * The values are read from `mcpEnvironment`, not from `config.env`, because that is the environment
 * the server was actually started with: a credential named by `envPassthrough` is inherited from
 * this machine and never appears in `config.env`, so reading the stored pairs alone would let it
 * out. A short value is left alone - masking a two-character value would hide ordinary words.
 */
function maskSecretsOf(text: string, config: McpServerConfig): string {
  let result = text;
  const values = [...Object.values(mcpEnvironment(config)), ...config.headers.map((pair) => pair.value)];
  for (const value of values) {
    if (value.length < 4) continue;
    result = result.split(value).join(MASK);
  }
  return result;
}
