import { readFile } from "node:fs/promises";
import {
  createStoredHostGrantKeyPair,
  importHostGrantPrivateKey,
  isRawP256PublicKey,
} from "@openbot/contracts/host-grant";
import { registerSecretValue } from "@openbot/logging";
import { Effect } from "effect";
import { z } from "zod";
import { writeFileAtomically } from "../backend/atomic-json-file";
import type { SecretCipher } from "./provider-credential-store";

const fileSchema = z.object({ version: z.literal(1), publicKey: z.string(), privateKey: z.string() });

export interface StoredP256Key {
  publicKey: string;
  privateKey: CryptoKey;
}

export interface StoredP256KeyWarnings {
  cannotEncrypt: string;
  cannotSave: string;
  warn: (message: string) => void;
}

export const loadStoredP256Key = Effect.fn("StoredP256Key.load")(function* (
  path: string,
  cipher: SecretCipher,
  warnings: StoredP256KeyWarnings,
) {
  const saved = yield* Effect.tryPromise(async () => {
    const file = fileSchema.parse(JSON.parse(await readFile(path, "utf8")));
    const privateKey = cipher.decrypt(Buffer.from(file.privateKey, "base64"));
    if (!isRawP256PublicKey(file.publicKey)) throw new Error("The stored key is invalid.");
    registerSecretValue(privateKey);
    return { publicKey: file.publicKey, privateKey: await importHostGrantPrivateKey(privateKey) };
  }).pipe(Effect.catch(() => Effect.succeed(null)));
  if (saved) return saved;
  const created = yield* Effect.tryPromise(async () => {
    const pair = await createStoredHostGrantKeyPair();
    registerSecretValue(pair.privateKey);
    const encrypted = cipher.encrypt(pair.privateKey).toString("base64");
    return { pair, content: `${JSON.stringify({ version: 1, publicKey: pair.publicKey, privateKey: encrypted })}\n` };
  }).pipe(Effect.catch(() => Effect.succeed(null)));
  if (!created) {
    warnings.warn(warnings.cannotEncrypt);
    return null;
  }
  const written = yield* writeFileAtomically(path, created.content, { createDirectory: true }).pipe(
    Effect.as(true),
    Effect.catch(() => Effect.succeed(false)),
  );
  if (!written) {
    warnings.warn(warnings.cannotSave);
    return null;
  }
  return {
    publicKey: created.pair.publicKey,
    privateKey: yield* Effect.promise(() => importHostGrantPrivateKey(created.pair.privateKey)),
  } satisfies StoredP256Key;
});
