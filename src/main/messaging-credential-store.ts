// The tokens of the messaging connections (a Slack bot token and app-level token per agent, or the
// credentials of a managed Slack app), and the manager token of each connected Slack workspace,
// encrypted at rest by the operating system. Every value is registered for redaction, including the
// few that are not secret, such as a workspace name: none of them belongs in a log.

import { readFile, rm } from "node:fs/promises";
import type { MessagingCredentialState } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { registerSecretValue } from "@openbot/logging";
import { Effect, Result, Semaphore } from "effect";
import { z } from "zod";
import { writeFileAtomically } from "../backend/atomic-json-file";
import { causeHelpers } from "../backend/effect-boundary";
import { type MessagingCredentials, MessagingOperationFailed } from "../backend/messaging/messaging-service";
import type { SecretCipher } from "./provider-credential-store";

const { io: messagingIO, sync: messagingSync } = causeHelpers(MessagingOperationFailed);

/**
 * One envelope with the tokens of every connection, each connection encrypted on its own. The
 * version is checked for the reason `ProviderCredentialStore` gives: an envelope that cannot be
 * read is not an empty one.
 */
const envelopeSchema = z.object({
  version: z.literal(1),
  connections: z.record(z.string(), z.string()),
});
const valuesSchema = z.record(z.string(), z.string());

const MAX_ENVELOPE_BYTES = 256 * 1024;

/**
 * Reads and writes the connection tokens, holding the decrypted values only in memory. `electron`
 * is never imported here: the cipher arrives as callbacks. Only the state of a connection's tokens
 * (`missing`, `saved` or `unreadable`) leaves this class towards a client.
 */
export class MessagingCredentialStore implements MessagingCredentials {
  readonly #path: string;
  readonly #cipher: SecretCipher;
  #values = new Map<string, Record<string, string>>();
  #loaded = false;
  #loadError: Error | null = null;
  #writes = Semaphore.makeUnsafe(1);

  constructor(path: string, cipher: SecretCipher) {
    this.#path = path;
    this.#cipher = cipher;
  }

  /** Reads the envelope. A file that cannot be read does not stop startup, and stays until the user saves. */
  load(): Effect.Effect<Error | null> {
    return Effect.gen({ self: this }, function* () {
      this.#values = new Map();
      this.#loadError = null;
      const result = yield* Effect.result(this.#read());
      if (Result.isSuccess(result)) this.#values = result.success;
      else {
        const error = result.failure.cause;
        this.#loadError =
          error instanceof Error ? error : new Error(sourceText("error.provider.credentialFileUnreadable"));
      }
      this.#loaded = true;
      return this.#loadError;
    });
  }

  get(connectionId: string): Record<string, string> | null {
    if (!this.#loaded) throw new Error("The messaging credential store is not loaded.");
    const values = this.#values.get(connectionId);
    return values ? { ...values } : null;
  }

  keys(): string[] {
    if (!this.#loaded) throw new Error("The messaging credential store is not loaded.");
    return [...this.#values.keys()];
  }

  status(connectionId: string): MessagingCredentialState {
    if (this.get(connectionId) !== null) return "saved";
    return this.#loadError ? "unreadable" : "missing";
  }

  set(connectionId: string, values: Record<string, string>): Effect.Effect<void, MessagingOperationFailed> {
    return this.#edit((next) => {
      for (const value of Object.values(values)) registerSecretValue(value);
      next.set(connectionId, { ...values });
      return true;
    });
  }

  clear(connectionId: string): Effect.Effect<void, MessagingOperationFailed> {
    return this.#edit((next) => next.delete(connectionId));
  }

  retain(connectionIds: ReadonlySet<string>): Effect.Effect<void, MessagingOperationFailed> {
    return this.#edit((next) => {
      let changed = false;
      for (const connectionId of [...next.keys()])
        if (!connectionIds.has(connectionId)) changed = next.delete(connectionId) || changed;
      return changed;
    });
  }

  /** One change after the previous one, each from the values the previous change committed. */
  #edit(change: (next: Map<string, Record<string, string>>) => boolean): Effect.Effect<void, MessagingOperationFailed> {
    return this.#writes.withPermit(
      Effect.gen({ self: this }, function* () {
        const next = yield* messagingSync(() => {
          if (!this.#loaded) throw new Error("The messaging credential store is not loaded.");
          const values = new Map(this.#loadError ? [] : this.#values);
          return change(values) ? values : null;
        });
        if (!next) return;
        if (next.size === 0) yield* messagingIO(() => rm(this.#path, { force: true }));
        else yield* this.#write(next);
        this.#values = next;
        this.#loadError = null;
      }).pipe(Effect.uninterruptible),
    );
  }

  #read = Effect.fn("MessagingCredentialStore.read")(function* (this: MessagingCredentialStore) {
    const source = yield* messagingIO(() => readFile(this.#path, "utf8")).pipe(
      Effect.catch(({ cause }) =>
        cause instanceof Error && "code" in cause && cause.code === "ENOENT"
          ? Effect.succeed(null)
          : Effect.fail(new MessagingOperationFailed({ cause })),
      ),
    );
    if (source === null) return new Map<string, Record<string, string>>();
    return yield* messagingSync(() => {
      if (source.length > MAX_ENVELOPE_BYTES) throw new Error(sourceText("error.provider.credentialFileTooLarge"));
      const envelope = envelopeSchema.parse(JSON.parse(source));
      const values = new Map<string, Record<string, string>>();
      for (const [connectionId, encrypted] of Object.entries(envelope.connections)) {
        const decoded = valuesSchema.parse(JSON.parse(this.#cipher.decrypt(Buffer.from(encrypted, "base64"))));
        for (const value of Object.values(decoded)) registerSecretValue(value);
        values.set(connectionId, decoded);
      }
      return values;
    });
  });

  #write = Effect.fn("MessagingCredentialStore.write")(function* (
    this: MessagingCredentialStore,
    values: Map<string, Record<string, string>>,
  ) {
    const content = yield* messagingSync(() => {
      const connections: Record<string, string> = {};
      for (const [connectionId, value] of values)
        connections[connectionId] = this.#cipher.encrypt(JSON.stringify(value)).toString("base64");
      return `${JSON.stringify({ version: 1, connections })}\n`;
    });
    yield* writeFileAtomically(this.#path, content, { createDirectory: true }).pipe(
      Effect.mapError(({ cause }) => new MessagingOperationFailed({ cause })),
    );
  });
}
