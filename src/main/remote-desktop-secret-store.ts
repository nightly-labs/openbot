import { randomBytes } from "node:crypto";
import { Effect, Result } from "effect";
import { z } from "zod";
import { PreferenceFileFailure, readPreferenceFile, writePreferenceFile } from "./preference-file";

const storedSecretSchema = z.object({ version: z.literal(1), value: z.string() });
const runtimeCredentialsSchema = z.object({ username: z.string().min(1), password: z.string().min(1) });

interface SecretCipher {
  encrypt: (value: string) => Buffer;
  decrypt: (value: Buffer) => string;
}

export const loadOrCreateRemoteDesktopCredentials = Effect.fn("RemoteDesktopCredentials.loadOrCreate")(function* (
  path: string,
  cipher: SecretCipher,
) {
  const loaded = yield* Effect.result(
    readPreferenceFile(path, (input) => {
      const stored = storedSecretSchema.parse(input);
      return runtimeCredentialsSchema.parse(JSON.parse(cipher.decrypt(Buffer.from(stored.value, "base64"))));
    }),
  );
  if (Result.isSuccess(loaded)) return loaded.success;
  const error = loaded.failure.cause;
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) return yield* loaded.failure;
  const { credentials, encrypted } = yield* Effect.try({
    try: () => {
      const credentials = { username: "openbot", password: randomBytes(32).toString("base64url") };
      return { credentials, encrypted: cipher.encrypt(JSON.stringify(credentials)) };
    },
    catch: (cause) => new PreferenceFileFailure({ cause }),
  });
  yield* writePreferenceFile(path, { version: 1, value: encrypted.toString("base64") }, { createDirectory: true });
  return credentials;
});
