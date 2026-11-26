import { readFile } from "node:fs/promises";
import {
  createStoredHostGrantKeyPair,
  importHostGrantPrivateKey,
  isRawP256PublicKey,
} from "@openbot/contracts/host-grant";
import { isDynamicRecord, isNumber } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger, registerSecretValue } from "@openbot/logging";
import { Effect } from "effect";
import { z } from "zod";
import { writeFileAtomically } from "../backend/atomic-json-file";
import { PreferenceStore } from "./preference-file";
import type { SecretCipher } from "./provider-credential-store";

const logger = createOpenBotLogger("watch-relay-key");

const fileSchema = z.object({ version: z.literal(1), publicKey: z.string(), privateKey: z.string() });

export interface WatchRelayKey {
  publicKey: string;
  privateKey: CryptoKey;
}

export const loadWatchRelayKey = Effect.fn("WatchRelayKey.load")(function* (path: string, cipher: SecretCipher) {
  const saved = yield* Effect.tryPromise(async () => {
    const file = fileSchema.parse(JSON.parse(await readFile(path, "utf8")));
    const privateKey = cipher.decrypt(Buffer.from(file.privateKey, "base64"));
    if (!isRawP256PublicKey(file.publicKey)) throw new Error("The watch key is invalid.");
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
    logger.warn("The watch key cannot be encrypted. The Apple Watch uses the iPhone to reach this host.");
    return null;
  }
  const written = yield* writeFileAtomically(path, created.content, { createDirectory: true }).pipe(
    Effect.as(true),
    Effect.catch(() => Effect.succeed(false)),
  );
  if (!written) {
    logger.warn("The watch key could not be saved. The Apple Watch uses the iPhone to reach this host.");
    return null;
  }
  return {
    publicKey: created.pair.publicKey,
    privateKey: yield* Effect.promise(() => importHostGrantPrivateKey(created.pair.privateKey)),
  } satisfies WatchRelayKey;
});

export interface WatchRelayWanted {
  wantedUntil: number;
}

export function createWatchRelayWantedStore(path: string): PreferenceStore<WatchRelayWanted> {
  return new PreferenceStore<WatchRelayWanted>({
    path,
    defaultValue: { wantedUntil: 0 },
    decode: (parsed) =>
      isDynamicRecord(parsed) &&
      parsed.version === 1 &&
      isNumber(parsed.wantedUntil) &&
      Number.isSafeInteger(parsed.wantedUntil)
        ? { wantedUntil: parsed.wantedUntil }
        : null,
  });
}
