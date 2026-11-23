import { readFile, rm } from "node:fs/promises";
import { sourceText } from "@openbot/i18n/source";
import { registerSecretValue } from "@openbot/logging";
import { Effect, Result, Semaphore } from "effect";
import { z } from "zod";
import { writeFileAtomically } from "../backend/atomic-json-file";
import { causeHelpers } from "../backend/effect-boundary";
import { McpOperationError } from "../backend/mcp-effects";
import { type McpOAuthRecord, type McpOAuthStorage, mcpOAuthRecordSchema } from "../backend/mcp-oauth-provider";
import type { SecretCipher } from "./provider-credential-store";

const { io: mcpIO, sync: mcpSync } = causeHelpers(McpOperationError);

const envelopeSchema = z.object({
  version: z.literal(1),
  servers: z.record(z.string(), z.string()),
});

const MAX_ENVELOPE_BYTES = 256 * 1024;

export class McpOAuthStore implements McpOAuthStorage {
  readonly #path: string;
  readonly #cipher: SecretCipher;
  #records = new Map<string, McpOAuthRecord>();
  #loaded = false;
  #loadError: Error | null = null;
  #unreadableServers: Record<string, string> | null = null;
  #readFailed = false;
  #queue = Semaphore.makeUnsafe(1);

  constructor(path: string, cipher: SecretCipher) {
    this.#path = path;
    this.#cipher = cipher;
  }

  load(): Effect.Effect<Error | null> {
    return Effect.gen({ self: this }, function* () {
      this.#records = new Map();
      this.#loadError = null;
      this.#unreadableServers = null;
      const result = yield* Effect.result(this.#read());
      if (Result.isSuccess(result)) {
        this.#records = result.success;
        for (const record of result.success.values()) registerAppSecret(record);
      } else
        this.#loadError =
          result.failure.cause instanceof Error
            ? result.failure.cause
            : new Error(sourceText("error.mcp.signInFileUnreadable"));
      this.#loaded = true;
      return this.#loadError;
    });
  }

  read(resource: string): McpOAuthRecord | null {
    if (!this.#loaded) throw new Error("The MCP sign-in store is not loaded.");
    return this.#records.get(resource) ?? null;
  }

  write(resource: string, record: McpOAuthRecord): Effect.Effect<void, McpOperationError> {
    return this.#enqueue(
      Effect.gen({ self: this }, function* () {
        yield* this.#reloadIfUnreadable();
        if (this.#readFailed && this.#loadError)
          return yield* new McpOperationError({ cause: new Error(sourceText("error.mcp.signInFileUnreadable")) });
        const next = yield* mcpSync(() => this.#editableRecords());
        registerAppSecret(record);
        if (
          record.app === undefined &&
          record.client === undefined &&
          record.tokens === undefined &&
          record.discovery === undefined &&
          record.lostAt === undefined
        )
          next.delete(resource);
        else next.set(resource, record);
        yield* this.#commit(next);
      }),
    );
  }

  clear(resource: string): Effect.Effect<void, McpOperationError> {
    return this.#enqueue(
      Effect.gen({ self: this }, function* () {
        if (!this.#loaded)
          return yield* new McpOperationError({ cause: new Error("The MCP sign-in store is not loaded.") });
        yield* this.#reloadIfUnreadable();
        if (this.#loadError || !this.#records.has(resource)) return;
        const next = yield* mcpSync(() => this.#editableRecords());
        next.delete(resource);
        yield* this.#commit(next);
      }),
    );
  }

  #reloadIfUnreadable = Effect.fn("McpOAuthStore.reload")(function* (this: McpOAuthStore) {
    if (!this.#loadError && !this.#unreadableServers) return;
    const result = yield* Effect.result(this.#read());
    if (Result.isSuccess(result)) {
      for (const [resource, record] of this.#records)
        if (!result.success.has(resource) && this.#unreadableServers?.[resource] !== undefined)
          result.success.set(resource, record);
      this.#records = result.success;
      for (const record of result.success.values()) registerAppSecret(record);
      this.#loadError = null;
    }
  });

  #enqueue(change: Effect.Effect<void, McpOperationError>): Effect.Effect<void, McpOperationError> {
    return this.#queue.withPermit(Effect.uninterruptible(change));
  }

  #editableRecords(): Map<string, McpOAuthRecord> {
    if (!this.#loaded) throw new Error("The MCP sign-in store is not loaded.");
    return new Map(this.#loadError ? [] : this.#records);
  }

  #commit = Effect.fn("McpOAuthStore.commit")(function* (this: McpOAuthStore, next: Map<string, McpOAuthRecord>) {
    const preserved = preservedUnread(this.#unreadableServers, next);
    if (next.size === 0 && !preserved) yield* mcpIO(() => rm(this.#path, { force: true }));
    else yield* this.#write(next, preserved);
    this.#records = next;
    this.#unreadableServers = preserved;
    this.#loadError = null;
  });

  #read = Effect.fn("McpOAuthStore.read")(function* (this: McpOAuthStore) {
    const source = yield* mcpIO(() => readFile(this.#path, "utf8")).pipe(
      Effect.catch(({ cause }) => {
        if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") return Effect.succeed(null);
        this.#readFailed = true;
        return Effect.fail(new McpOperationError({ cause }));
      }),
    );
    this.#readFailed = false;
    if (source === null) {
      this.#unreadableServers = null;
      return new Map<string, McpOAuthRecord>();
    }
    return yield* mcpSync(() => {
      if (source.length > MAX_ENVELOPE_BYTES) throw new Error(sourceText("error.mcp.signInFileTooLarge"));
      let envelope: { version: 1; servers: Record<string, string> };
      try {
        envelope = envelopeSchema.parse(JSON.parse(source));
      } catch {
        this.#unreadableServers = null;
        throw new Error(sourceText("error.mcp.signInFileUnreadable"));
      }
      const records = new Map<string, McpOAuthRecord>();
      const unreadable: Record<string, string> = {};
      for (const [resource, encrypted] of Object.entries(envelope.servers)) {
        try {
          records.set(
            resource,
            mcpOAuthRecordSchema.parse(JSON.parse(this.#cipher.decrypt(Buffer.from(encrypted, "base64")))),
          );
        } catch {
          unreadable[resource] = encrypted;
        }
      }
      if (records.size === 0 && Object.keys(unreadable).length > 0) {
        this.#unreadableServers = unreadable;
        throw new Error(sourceText("error.mcp.signInFileUnreadable"));
      }
      this.#unreadableServers = Object.keys(unreadable).length > 0 ? unreadable : null;
      return records;
    });
  });

  #write = Effect.fn("McpOAuthStore.write")(function* (
    this: McpOAuthStore,
    records: Map<string, McpOAuthRecord>,
    preserved: Record<string, string> | null,
  ) {
    const content = yield* mcpSync(() => {
      const servers: Record<string, string> = {};
      for (const [resource, record] of records)
        servers[resource] = this.#cipher.encrypt(JSON.stringify(record)).toString("base64");
      if (preserved) Object.assign(servers, preserved);
      return `${JSON.stringify({ version: 1, servers })}\n`;
    });
    yield* writeFileAtomically(this.#path, content, { createDirectory: true }).pipe(
      Effect.mapError(({ cause }) => new McpOperationError({ cause })),
    );
  });
}

function registerAppSecret(record: McpOAuthRecord): void {
  if (record.app?.clientSecret) registerSecretValue(record.app.clientSecret);
}

function preservedUnread(
  unreadable: Record<string, string> | null,
  next: Map<string, McpOAuthRecord>,
): Record<string, string> | null {
  if (!unreadable) return null;
  const preserved: Record<string, string> = {};
  for (const [resource, encrypted] of Object.entries(unreadable)) {
    const record = next.get(resource);
    if (record?.tokens === undefined && record?.app === undefined) preserved[resource] = encrypted;
  }
  return Object.keys(preserved).length > 0 ? preserved : null;
}
