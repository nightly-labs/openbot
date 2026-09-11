// The user's own MCP servers: what is on disk, and every write that changes it.
//
// A server carries env values or header values, so this file is the only place either exists
// outside the provider process OpenBot starts. The renderer is given `list()`, which cannot carry
// a secret; the backend is given `configs()`, which is what a session needs. Nothing else reads
// the file.
//
// Electron-free, with the cipher injected, so its tests need neither a keychain nor a display.

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { CUSTOM_MCP_LIMITS, type CustomMcpSummary, type SaveCustomMcpInput } from "@openbot/contracts/ipc";
import { z } from "zod";
import type { CustomMcpConfig } from "../backend/custom-mcp";

export interface CustomMcpCipher {
  canPersist: () => boolean;
  encrypt: (value: string) => Buffer;
  decrypt: (value: Buffer) => string;
}

const envSchema = z.object({ name: z.string(), value: z.string() });
const headerSchema = z.object({ name: z.string(), value: z.string() });

/**
 * A plaintext envelope around one encrypted field, rather than a wholly encrypted file: a computer
 * that loses its keychain keeps its server list, and only the credentials are gone.
 */
const stdioSchema = z.object({
  id: z.string(),
  name: z.string(),
  transport: z.literal("stdio"),
  command: z.string(),
  args: z.array(z.string()),
  secret: z.string().nullish(),
});

const httpSchema = z.object({
  id: z.string(),
  name: z.string(),
  transport: z.literal("http"),
  url: z.string(),
  secret: z.string().nullish(),
});

const entrySchema = z.discriminatedUnion("transport", [stdioSchema, httpSchema]);
const fileSchema = z.object({
  version: z.literal(1),
  servers: z.array(entrySchema),
  fullAccess: z.boolean().optional(),
});
const secretSchema = z.object({
  env: z.array(envSchema).optional(),
  headers: z.array(headerSchema).optional(),
});

type StoredEntry = z.infer<typeof entrySchema>;
type ServerFile = z.infer<typeof fileSchema>;

interface ServerSecret {
  readonly env: readonly { name: string; value: string }[];
  readonly headers: readonly { name: string; value: string }[];
}

interface Entry {
  readonly stored: StoredEntry;
  readonly secret: ServerSecret | null;
}

const READ_ONLY_MESSAGE =
  "The saved MCP servers were written by a newer version of OpenBot, or the file cannot be read. Update OpenBot to change them.";
const NO_SECURE_STORAGE_MESSAGE =
  "This computer has no secure storage, so an environment variable or a header cannot be saved. Remove them, or use a server that needs no credentials.";
const DUPLICATE_MESSAGE = "An MCP server with this ID is already saved. Remove it first, or use another ID.";
const CAPACITY_MESSAGE = "Remove a server before adding another.";

export class CustomMcpStore {
  readonly #path: string;
  readonly #cipher: CustomMcpCipher;
  #entries: Entry[] = [];
  #fullAccess = false;
  #readOnly = false;
  #writeChain = Promise.resolve();

  constructor(options: { path: string; cipher: CustomMcpCipher }) {
    this.#path = options.path;
    this.#cipher = options.cipher;
  }

  async load(): Promise<void> {
    let contents: string | null = null;
    try {
      contents = await readFile(this.#path, "utf8");
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
    if (contents === null) return;
    const file = parseServerFile(contents);
    if (!file) {
      this.#readOnly = true;
      this.#entries = [];
      return;
    }
    this.#readOnly = false;
    this.#entries = file.servers.map((stored) => ({ stored, secret: this.#openSecret(stored.secret) }));
    this.#fullAccess = file.fullAccess === true;
  }

  fullAccess(): boolean {
    return this.#fullAccess;
  }

  list(): CustomMcpSummary[] {
    return this.#entries.map(({ stored, secret }) => summaryFor(stored, secret));
  }

  configs(): readonly CustomMcpConfig[] {
    return this.#entries.map(({ stored, secret }) => configFor(stored, secret));
  }

  async save(input: SaveCustomMcpInput): Promise<CustomMcpSummary[]> {
    return this.#mutate(() => {
      if (this.#entries.some((entry) => entry.stored.id === input.id)) throw new Error(DUPLICATE_MESSAGE);
      if (this.#entries.length >= CUSTOM_MCP_LIMITS.servers) throw new Error(CAPACITY_MESSAGE);
      const secret = secretFor(input);
      if (secret && !this.#cipher.canPersist()) throw new Error(NO_SECURE_STORAGE_MESSAGE);
      const sealed = secret ? this.#cipher.encrypt(JSON.stringify(secret)).toString("base64") : null;
      const stored: StoredEntry =
        input.transport === "stdio"
          ? {
              id: input.id,
              name: input.name,
              transport: "stdio",
              command: input.command,
              args: [...input.args],
              secret: sealed,
            }
          : {
              id: input.id,
              name: input.name,
              transport: "http",
              url: input.url,
              secret: sealed,
            };
      return [...this.#entries, { stored, secret }];
    });
  }

  async setFullAccess(enabled: boolean): Promise<boolean> {
    if (this.#readOnly) throw new Error(READ_ONLY_MESSAGE);
    const operation = this.#writeChain.then(async () => {
      if (this.#readOnly) throw new Error(READ_ONLY_MESSAGE);
      this.#fullAccess = enabled;
      await this.#persist(this.#entries);
    });
    this.#writeChain = operation.catch(() => undefined);
    await operation;
    return this.#fullAccess;
  }

  async remove(id: string): Promise<CustomMcpSummary[]> {
    return this.#mutate(() => {
      const remaining = this.#entries.filter((entry) => entry.stored.id !== id);
      return remaining.length === this.#entries.length ? null : remaining;
    });
  }

  async #mutate(build: () => Entry[] | null): Promise<CustomMcpSummary[]> {
    if (this.#readOnly) throw new Error(READ_ONLY_MESSAGE);
    const operation = this.#writeChain.then(async () => {
      if (this.#readOnly) throw new Error(READ_ONLY_MESSAGE);
      const entries = build();
      if (!entries) return;
      await this.#persist(entries);
      this.#entries = entries;
    });
    this.#writeChain = operation.catch(() => undefined);
    await operation;
    return this.list();
  }

  #openSecret(sealed: string | null | undefined): ServerSecret | null {
    if (!sealed) return null;
    try {
      const parsed = secretSchema.parse(JSON.parse(this.#cipher.decrypt(Buffer.from(sealed, "base64"))));
      return { env: parsed.env ?? [], headers: parsed.headers ?? [] };
    } catch {
      return null;
    }
  }

  async #persist(entries: readonly Entry[]): Promise<void> {
    const servers = entries.map((entry) => entry.stored);
    await mkdir(dirname(this.#path), { recursive: true, mode: 0o700 });
    const temporary = `${this.#path}.${randomUUID()}.tmp`;
    try {
      await writeFile(
        temporary,
        `${JSON.stringify({ version: 1, servers, ...(this.#fullAccess ? { fullAccess: true } : {}) })}\n`,
        {
          encoding: "utf8",
          mode: 0o600,
        },
      );
      await rename(temporary, this.#path);
    } finally {
      await rm(temporary, { force: true });
    }
  }
}

function secretFor(input: SaveCustomMcpInput): ServerSecret | null {
  if (input.transport === "stdio") {
    return input.env.length > 0 ? { env: input.env, headers: [] } : null;
  }
  return input.headers.length > 0 ? { env: [], headers: input.headers } : null;
}

function summaryFor(stored: StoredEntry, secret: ServerSecret | null): CustomMcpSummary {
  const hasSecrets = Boolean(secret && (secret.env.length > 0 || secret.headers.length > 0));
  if (stored.transport === "stdio") {
    return { id: stored.id, name: stored.name, transport: "stdio", command: stored.command, hasSecrets };
  }
  return { id: stored.id, name: stored.name, transport: "http", url: stored.url, hasSecrets };
}

function configFor(stored: StoredEntry, secret: ServerSecret | null): CustomMcpConfig {
  if (stored.transport === "stdio") {
    return {
      id: stored.id,
      name: stored.name,
      transport: "stdio",
      command: stored.command,
      args: stored.args,
      env: secret?.env ?? [],
    };
  }
  return {
    id: stored.id,
    name: stored.name,
    transport: "http",
    url: stored.url,
    headers: secret?.headers ?? [],
  };
}

function parseServerFile(contents: string): ServerFile | null {
  try {
    return fileSchema.parse(JSON.parse(contents));
  } catch {
    return null;
  }
}
