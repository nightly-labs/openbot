import type { McpServerConfig } from "@openbot/contracts/ipc";
import { redactText } from "@openbot/logging";

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
  let result = text;
  for (const { value } of [...config.env, ...config.headers]) {
    if (value.length < 4) continue;
    result = result.split(value).join(MASK);
  }
  return redactText(result);
}
