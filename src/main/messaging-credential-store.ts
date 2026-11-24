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

const envelopeSchema = z.object({
  version: z.literal(1),
  connections: z.record(z.string(), z.string()),
});
const valuesSchema = z.record(z.string(), z.string());

const MAX_ENVELOPE_BYTES = 256 * 1024;

const DISPLAY_NAMES = new Set(["chatTitle", "botUsername", "guildName"]);

function registerSecrets(values: Record<string, string>): void {
  for (const [key, value] of Object.entries(values)) if (!DISPLAY_NAMES.has(key)) registerSecretValue(value);
}

export class MessagingCredentialStore implements MessagingCredentials {
  readonly #path: string;
  readonly #cipher: SecretCipher;
  #values = new Map<string, Record<string, string>>();
  #loaded = false;
  #loadError: Error | null = null;
  #undecrypted: Map<string, string> | null = null;
  #writes = Semaphore.makeUnsafe(1);

  constructor(path: string, cipher: SecretCipher) {
    this.#path = path;
    this.#cipher = cipher;
  }

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

  #edit(change: (next: Map<string, Record<string, string>>) => boolean): Effect.Effect<void, MessagingOperationFailed> {
    return this.#writes.withPermit(this.#apply(change).pipe(Effect.uninterruptible));
  }

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
