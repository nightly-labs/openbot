// The one GitHub sign-in of this computer, encrypted at rest by the operating system.

import { readFile, rm } from "node:fs/promises";
import { sourceText } from "@openbot/i18n/source";
import { z } from "zod";
import { writeJsonFileAtomically } from "../backend/atomic-json-file";
import type { SecretCipher } from "./provider-credential-store";

const githubConnectorRecordSchema = z.object({
  accessToken: z.string().min(1),
  accessTokenExpiresAt: z.number().nullable(),
  refreshToken: z.string().min(1).nullable(),
  refreshTokenExpiresAt: z.number().nullable(),
  login: z.string().min(1),
  userId: z.number(),
  avatarUrl: z.string().nullable(),
  /**
   * The loopback GitHub MCP server that agents reach. Its port and bearer stay the same across
   * restarts, because a resumed Codex session keeps the URL and header that it started with.
   */
  mcpProxy: z.object({ port: z.number().int().min(1).max(65_535), secret: z.string().min(32) }).nullish(),
});

export type GitHubConnectorRecord = z.infer<typeof githubConnectorRecordSchema>;

/**
 * `version` is checked, not tolerated: an envelope that this build cannot read is reported as
 * unreadable. The file stays on disk until a new sign-in replaces it.
 */
const envelopeSchema = z.object({ version: z.literal(1), record: z.string() });

/** One token set is small; a larger file is not one that this app wrote. */
const MAX_ENVELOPE_BYTES = 64 * 1024;

/**
 * Reads and writes the GitHub sign-in. The decrypted record is kept in memory only.
 *
 * `electron` is not imported: the cipher arrives as an argument, so a test can use a fake one.
 * Writes run one at a time, because a refresh and a disconnect can arrive together.
 */
export class GitHubConnectorStore {
  readonly #path: string;
  readonly #cipher: SecretCipher;
  #record: GitHubConnectorRecord | null = null;
  #queue: Promise<void> = Promise.resolve();

  constructor(path: string, cipher: SecretCipher) {
    this.#path = path;
    this.#cipher = cipher;
  }

  /** Reads the file. Returns the error when the file is there but cannot be read. */
  async load(): Promise<Error | null> {
    this.#record = null;
    try {
      this.#record = await this.#read();
      return null;
    } catch (error) {
      return error instanceof Error ? error : new Error(sourceText("error.connector.githubFileUnreadable"));
    }
  }

  read(): GitHubConnectorRecord | null {
    return this.#record;
  }

  write(record: GitHubConnectorRecord): Promise<void> {
    return this.#enqueue(async () => {
      const encrypted = this.#cipher.encrypt(JSON.stringify(record)).toString("base64");
      // Write then rename, so a crash leaves the previous sign-in readable.
      await writeJsonFileAtomically(this.#path, { version: 1, record: encrypted }, { createDirectory: true });
      this.#record = record;
    });
  }

  clear(): Promise<void> {
    return this.#enqueue(async () => {
      await rm(this.#path, { force: true });
      this.#record = null;
    });
  }

  #enqueue(change: () => Promise<void>): Promise<void> {
    const result = this.#queue.then(change, change);
    this.#queue = result.catch(() => undefined);
    return result;
  }

  async #read(): Promise<GitHubConnectorRecord | null> {
    let source: string;
    try {
      source = await readFile(this.#path, "utf8");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
      throw error;
    }
    if (source.length > MAX_ENVELOPE_BYTES) throw new Error(sourceText("error.connector.githubFileTooLarge"));
    try {
      const envelope = envelopeSchema.parse(JSON.parse(source));
      return githubConnectorRecordSchema.parse(
        JSON.parse(this.#cipher.decrypt(Buffer.from(envelope.record, "base64"))),
      );
    } catch {
      throw new Error(sourceText("error.connector.githubFileUnreadable"));
    }
  }
}
