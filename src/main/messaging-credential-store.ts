// The tokens of the messaging connections (a Slack bot token and app-level token per agent, or the
// credentials of a managed Slack app), and the manager token of each connected Slack workspace,
// encrypted at rest by the operating system. Every value is registered for redaction, except the
// names that people read in the chat; see `DISPLAY_NAMES`.

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
 * The names of a chat, a bot and a server. Text that an agent posts to a chat is redacted, so a
 * registered name became `[redacted]` each time the agent wrote it, such as a sector that has the
 * name of its Telegram group. A key that is not in this list stays registered, so a new token is
 * redacted by default.
 */
const DISPLAY_NAMES = new Set(["chatTitle", "botUsername", "guildName"]);

function registerSecrets(values: Record<string, string>): void {
  for (const [key, value] of Object.entries(values)) if (!DISPLAY_NAMES.has(key)) registerSecretValue(value);
}

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
  /**
   * The still encrypted values of each connection, when the file is a valid envelope that this computer
   * cannot decrypt, such as after a change of the system keyring. A disconnect removes one of them and
   * keeps the others, which the keyring can read again later.
   */
  #undecrypted: Map<string, string> | null = null;
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
      this.#undecrypted = null;
      const envelope = yield* Effect.result(this.#readEnvelope());
      const result = Result.isFailure(envelope)
        ? Result.fail(envelope.failure)
        : yield* Effect.result(this.#decrypt(envelope.success));
      if (Result.isSuccess(result)) this.#values = result.success;
      else {
        const error = result.failure.cause;
        this.#loadError =
          error instanceof Error ? error : new Error(sourceText("error.provider.credentialFileUnreadable"));
        // A valid envelope whose values this computer cannot decrypt.
        if (Result.isSuccess(envelope) && envelope.success)
          this.#undecrypted = new Map(Object.entries(envelope.success.connections));
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
    if (!this.#loadError) return "missing";
    // A connection that the unreadable file does not hold has no tokens, such as one disconnected since.
    return !this.#undecrypted || this.#undecrypted.has(connectionId) ? "unreadable" : "missing";
  }

  set(connectionId: string, values: Record<string, string>): Effect.Effect<void, MessagingOperationFailed> {
    return this.#edit((next) => {
      registerSecrets(values);
      next.set(connectionId, { ...values });
      return true;
    });
  }

  clear(connectionId: string): Effect.Effect<void, MessagingOperationFailed> {
    return this.#writes.withPermit(
      Effect.gen({ self: this }, function* () {
        const undecrypted = this.#loadError ? this.#undecrypted : null;
        if (!undecrypted) return yield* this.#apply((next) => next.delete(connectionId));
        // Only this connection's entry goes. The others stay encrypted as they are, not decrypted.
        if (!undecrypted.has(connectionId)) return;
        const rest = new Map(undecrypted);
        rest.delete(connectionId);
        yield* this.#writeEnvelope(rest);
        this.#undecrypted = rest;
        if (rest.size === 0) this.#loadError = null;
      }).pipe(Effect.uninterruptible),
    );
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
    return this.#writes.withPermit(this.#apply(change).pipe(Effect.uninterruptible));
  }

  /** The change of `#edit`, for a caller that holds the write permit. */
  #apply = Effect.fn("MessagingCredentialStore.apply")(function* (
    this: MessagingCredentialStore,
    change: (next: Map<string, Record<string, string>>) => boolean,
  ) {
    const next = yield* messagingSync(() => {
      if (!this.#loaded) throw new Error("The messaging credential store is not loaded.");
      const values = new Map(this.#loadError ? [] : this.#values);
      return change(values) ? values : null;
    });
    if (!next) return;
    yield* this.#write(next);
    this.#values = next;
    this.#loadError = null;
    this.#undecrypted = null;
  });

  /** The envelope as it is in the file, without decrypting it, or null when there is no file. */
  #readEnvelope = Effect.fn("MessagingCredentialStore.readEnvelope")(function* (this: MessagingCredentialStore) {
    const source = yield* messagingIO(() => readFile(this.#path, "utf8")).pipe(
      Effect.catch(({ cause }) =>
        cause instanceof Error && "code" in cause && cause.code === "ENOENT"
          ? Effect.succeed(null)
          : Effect.fail(new MessagingOperationFailed({ cause })),
      ),
    );
    if (source === null) return null;
    return yield* messagingSync(() => {
      if (source.length > MAX_ENVELOPE_BYTES) throw new Error(sourceText("error.provider.credentialFileTooLarge"));
      return envelopeSchema.parse(JSON.parse(source));
    });
  });

  #decrypt = Effect.fn("MessagingCredentialStore.decrypt")(function* (
    this: MessagingCredentialStore,
    envelope: z.infer<typeof envelopeSchema> | null,
  ) {
    if (envelope === null) return new Map<string, Record<string, string>>();
    return yield* messagingSync(() => {
      const values = new Map<string, Record<string, string>>();
      for (const [connectionId, encrypted] of Object.entries(envelope.connections)) {
        const decoded = valuesSchema.parse(JSON.parse(this.#cipher.decrypt(Buffer.from(encrypted, "base64"))));
        registerSecrets(decoded);
        values.set(connectionId, decoded);
      }
      return values;
    });
  });

  #write = Effect.fn("MessagingCredentialStore.write")(function* (
    this: MessagingCredentialStore,
    values: Map<string, Record<string, string>>,
  ) {
    const connections = yield* messagingSync(() => {
      const encrypted = new Map<string, string>();
      for (const [connectionId, value] of values)
        encrypted.set(connectionId, this.#cipher.encrypt(JSON.stringify(value)).toString("base64"));
      return encrypted;
    });
    yield* this.#writeEnvelope(connections);
  });

  /** Writes the encrypted values of each connection. With none, the file goes. */
  #writeEnvelope = Effect.fn("MessagingCredentialStore.writeEnvelope")(function* (
    this: MessagingCredentialStore,
    connections: Map<string, string>,
  ) {
    if (connections.size === 0) return yield* messagingIO(() => rm(this.#path, { force: true }));
    const content = `${JSON.stringify({ version: 1, connections: Object.fromEntries(connections) })}\n`;
    yield* writeFileAtomically(this.#path, content, { createDirectory: true }).pipe(
      Effect.mapError(({ cause }) => new MessagingOperationFailed({ cause })),
    );
  });
}
