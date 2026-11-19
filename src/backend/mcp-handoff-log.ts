import type { McpServerConfig } from "@openbot/contracts/ipc";
import { mcpSecretValues } from "./mcp-redaction";

export class McpHandoffLog {
  readonly #names = new Set<string>();
  readonly #values = new Set<string>();

  record(configs: readonly McpServerConfig[]): McpServerConfig[] {
    for (const config of configs) this.#names.add(config.name);
    for (const value of mcpSecretValues(configs)) this.#values.add(value);
    return [...configs];
  }

  recordSecret(value: string): void {
    if (value.length >= 4) this.#values.add(value);
  }

  names(): string[] {
    return [...this.#names];
  }

  values(): string[] {
    return [...this.#values];
  }
}
