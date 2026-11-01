// A larger encrypted file of the WhatsApp account connection: the keys of the linked device, or the
// chats that WhatsApp sent to it. Both change often while WhatsApp syncs, so a change is written after
// a short delay, and changes that arrive in that delay share one write.

import { readFile, rm } from "node:fs/promises";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { Effect, Semaphore } from "effect";
import { z } from "zod";
import { writeJsonFileAtomically } from "../backend/atomic-json-file";
import type { SecretCipher } from "./provider-credential-store";
import { WhatsAppAccountOperationError, whatsappAccountCall, whatsappAccountDecode } from "./whatsapp-account-effects";

const logger = createOpenBotLogger("whatsapp-account-connector");

const envelopeSchema = z.object({ version: z.literal(1), data: z.string() });

/**
 * JSON with bytes. A Buffer or Uint8Array is written as `{ "type": "Buffer", "data": "<base64>" }`,
 * the form that Baileys uses for its keys, and read back as a Buffer.
 */
export function stringifyWithBytes(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (item instanceof Uint8Array) return { type: "Buffer", data: Buffer.from(item).toString("base64") };
    if (
      item &&
      typeof item === "object" &&
      "type" in item &&
      item.type === "Buffer" &&
      "data" in item &&
      Array.isArray(item.data)
    ) {
      // `Buffer.prototype.toJSON` has already run: its data is an array of bytes.
      return { type: "Buffer", data: Buffer.from(item.data).toString("base64") };
    }
    return item;
  });
}

/** Reads JSON with bytes, then gives it to `parse`, which checks it and makes the domain value. */
export function parseWithBytes<T>(text: string, parse: (value: unknown) => T): T {
  return parse(
    JSON.parse(text, (_key, item: unknown) => {
      if (
        item &&
        typeof item === "object" &&
        "type" in item &&
        item.type === "Buffer" &&
        "data" in item &&
        typeof item.data === "string"
      ) {
        return Buffer.from(item.data, "base64");
      }
      return item;
    }),
  );
}

export interface WhatsAppDataFileOptions {
  path: string;
  cipher: SecretCipher;
  /** A larger file is not one that this app wrote. */
  maxBytes: number;
  /** How long changes wait, so that the changes of one sync share a write. */
  delayMs: number;
}

/**
 * One encrypted JSON file. `schedule` takes a function that makes the current content, so a write
 * always stores the newest state. Writes run one at a time; `remove` drops a pending write.
 */
export class WhatsAppDataFile {
  readonly #options: WhatsAppDataFileOptions;
  readonly #queue = Semaphore.makeUnsafe(1);
  #pending: (() => unknown) | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: WhatsAppDataFileOptions) {
    this.#options = options;
  }

  /**
   * The content that `parse` makes from the file, or null when there is no file. Fails when the file
   * is there but cannot be read.
   */
  load<T>(parse: (value: unknown) => T): Effect.Effect<T | null, WhatsAppAccountOperationError> {
    return this.#load(parse);
  }

  readonly #load = Effect.fn("WhatsAppDataFile.load")(function* <T>(
    this: WhatsAppDataFile,
    parse: (value: unknown) => T,
  ): Effect.fn.Return<T | null, WhatsAppAccountOperationError> {
    const source = yield* whatsappAccountCall(() => readFile(this.#options.path, "utf8")).pipe(
      Effect.catch(({ cause }) =>
        cause instanceof Error && "code" in cause && cause.code === "ENOENT"
          ? Effect.succeed(null)
          : Effect.fail(new WhatsAppAccountOperationError({ cause })),
      ),
    );
    if (source === null) return null;
    const unreadable = new WhatsAppAccountOperationError({
      cause: new Error(sourceText("error.connector.whatsappAccountFileUnreadable")),
    });
    if (source.length > this.#options.maxBytes) return yield* unreadable;
    return yield* whatsappAccountDecode(() => {
      const envelope = envelopeSchema.parse(JSON.parse(source));
      return parseWithBytes(this.#options.cipher.decrypt(Buffer.from(envelope.data, "base64")), parse);
    }).pipe(Effect.mapError(() => unreadable));
  });

  /** Writes what `content` makes, after the delay. A later call replaces an earlier one. */
  schedule(content: () => unknown): void {
    this.#pending = content;
    if (this.#timer) return;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      void Effect.runPromise(
        this.flush().pipe(
          Effect.catch(({ cause }) =>
            Effect.sync(() => {
              logger.warn("A WhatsApp account file could not be written.", { cause: toLogValue(cause) });
            }),
          ),
        ),
      );
    }, this.#options.delayMs);
  }

  /** Writes the pending change now. */
  flush(): Effect.Effect<void, WhatsAppAccountOperationError> {
    return this.#queue
      .withPermit(
        Effect.gen({ self: this }, function* () {
          if (this.#timer) {
            clearTimeout(this.#timer);
            this.#timer = null;
          }
          const content = this.#pending;
          this.#pending = null;
          if (!content) return;
          const encrypted = yield* whatsappAccountDecode(() =>
            this.#options.cipher.encrypt(stringifyWithBytes(content())).toString("base64"),
          );
          yield* writeJsonFileAtomically(
            this.#options.path,
            { version: 1, data: encrypted },
            { createDirectory: true },
          ).pipe(Effect.mapError(({ cause }) => new WhatsAppAccountOperationError({ cause })));
        }),
      )
      .pipe(Effect.uninterruptible);
  }

  /** Drops a pending write and deletes the file. */
  remove(): Effect.Effect<void, WhatsAppAccountOperationError> {
    return this.#queue
      .withPermit(
        Effect.gen({ self: this }, function* () {
          if (this.#timer) {
            clearTimeout(this.#timer);
            this.#timer = null;
          }
          this.#pending = null;
          yield* whatsappAccountCall(() => rm(this.#options.path, { force: true }));
        }),
      )
      .pipe(Effect.uninterruptible);
  }
}
