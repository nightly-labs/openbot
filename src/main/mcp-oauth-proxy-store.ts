import { registerSecretValue } from "@openbot/logging";
import { Effect, Result } from "effect";
import { z } from "zod";
import { McpOperationError } from "../backend/mcp-effects";
import type { McpOAuthProxySettings, McpOAuthProxySettingsStore } from "../backend/mcp-oauth-proxy";
import { readPreferenceFile, writePreferenceFile } from "./preference-file";
import type { SecretCipher } from "./provider-credential-store";

const storedSettingsSchema = z.object({ version: z.literal(1), value: z.string() });
const settingsSchema = z.object({
  port: z.number().int().min(1).max(65_535).nullable(),
  secret: z.string().min(32),
});

/**
 * The port and the secret of the MCP OAuth proxy, encrypted with the same cipher as the other
 * secrets. Read once at startup, so the proxy reads them without I/O when it starts.
 *
 * A missing or unreadable file is not fatal: the proxy takes a new port and secret, and every Codex
 * session that holds the old address is replaced at its next turn.
 */
export class McpOAuthProxySettingsFile implements McpOAuthProxySettingsStore {
  readonly #path: string;
  readonly #cipher: SecretCipher;
  #settings: McpOAuthProxySettings | null = null;

  constructor(path: string, cipher: SecretCipher) {
    this.#path = path;
    this.#cipher = cipher;
  }

  /** The error of an unreadable file, or `null`. A missing file is not an error. */
  readonly load = Effect.fn("McpOAuthProxySettingsFile.load")(function* (this: McpOAuthProxySettingsFile) {
    const loaded = yield* Effect.result(
      readPreferenceFile(this.#path, (input) => {
        const stored = storedSettingsSchema.parse(input);
        return settingsSchema.parse(JSON.parse(this.#cipher.decrypt(Buffer.from(stored.value, "base64"))));
      }),
    );
    if (Result.isSuccess(loaded)) {
      registerSecretValue(loaded.success.secret);
      this.#settings = loaded.success;
      return null;
    }
    const error = loaded.failure.cause;
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    return error instanceof Error ? error : new Error(String(error));
  });

  read(): McpOAuthProxySettings | null {
    return this.#settings;
  }

  readonly write = Effect.fn("McpOAuthProxySettingsFile.write")(function* (
    this: McpOAuthProxySettingsFile,
    settings: McpOAuthProxySettings,
  ) {
    const encrypted = yield* Effect.try({
      try: () => this.#cipher.encrypt(JSON.stringify(settings)),
      catch: (cause) => new McpOperationError({ cause }),
    });
    yield* writePreferenceFile(
      this.#path,
      { version: 1, value: encrypted.toString("base64") },
      { createDirectory: true },
    ).pipe(Effect.mapError(({ cause }) => new McpOperationError({ cause })));
    this.#settings = settings;
  });
}
