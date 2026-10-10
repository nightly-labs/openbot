// The queue key of this host (`@openbot/contracts/signal-protocol/ingress-queue`). Signal seals the
// Slack, Discord and Telegram events that arrive while a hosted server sleeps to its public half, so
// the private half must stay the same across restarts. It is encrypted at rest by the operating
// system and registered for redaction.

import { readFile } from "node:fs/promises";
import {
  createIngressQueueKeyPair,
  importIngressQueuePrivateKey,
  isIngressQueueKey,
} from "@openbot/contracts/signal-protocol/ingress-queue";
import { createOpenBotLogger, registerSecretValue } from "@openbot/logging";
import { Effect } from "effect";
import { z } from "zod";
import { writeFileAtomically } from "../backend/atomic-json-file";
import type { SecretCipher } from "./provider-credential-store";

const logger = createOpenBotLogger("ingress-queue-key");

const fileSchema = z.object({ version: z.literal(1), publicKey: z.string(), privateKey: z.string() });

export interface IngressQueueKey {
  publicKey: string;
  privateKey: CryptoKey;
}

/**
 * Reads the key, or makes and saves a new one when there is none or it cannot be read. A key that
 * cannot be read only loses the events that Signal sealed to it. `null` when the operating system
 * cannot encrypt: then Signal keeps nothing for this host.
 */
export const loadIngressQueueKey = Effect.fn("IngressQueueKey.load")(function* (path: string, cipher: SecretCipher) {
  const saved = yield* Effect.tryPromise(async () => {
    const file = fileSchema.parse(JSON.parse(await readFile(path, "utf8")));
    const privateKey = cipher.decrypt(Buffer.from(file.privateKey, "base64"));
    if (!isIngressQueueKey(file.publicKey)) throw new Error("The queue key is invalid.");
    registerSecretValue(privateKey);
    return { publicKey: file.publicKey, privateKey: await importIngressQueuePrivateKey(privateKey) };
  }).pipe(Effect.catch(() => Effect.succeed(null)));
  if (saved) return saved;
  const created = yield* Effect.tryPromise(async () => {
    const pair = await createIngressQueueKeyPair();
    registerSecretValue(pair.privateKey);
    const encrypted = cipher.encrypt(pair.privateKey).toString("base64");
    return { pair, content: `${JSON.stringify({ version: 1, publicKey: pair.publicKey, privateKey: encrypted })}\n` };
  }).pipe(Effect.catch(() => Effect.succeed(null)));
  if (!created) {
    logger.warn("The queue key cannot be encrypted. Signal keeps no event for this host while it sleeps.");
    return null;
  }
  const written = yield* writeFileAtomically(path, created.content, { createDirectory: true }).pipe(
    Effect.as(true),
    Effect.catch(() => Effect.succeed(false)),
  );
  if (!written) {
    logger.warn("The queue key could not be saved. Signal keeps no event for this host while it sleeps.");
    return null;
  }
  return {
    publicKey: created.pair.publicKey,
    privateKey: yield* Effect.promise(() => importIngressQueuePrivateKey(created.pair.privateKey)),
  } satisfies IngressQueueKey;
});
