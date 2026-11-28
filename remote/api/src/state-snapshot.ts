import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect, Schema } from "effect";

const SNAPSHOT_MAXIMUM_AGE_MILLISECONDS = 10 * 60_000;
const SNAPSHOT_FUTURE_SKEW_MILLISECONDS = 30_000;
const SNAPSHOT_SIGNATURE_CONTEXT = "openbot-signal-state-v1.";
const SNAPSHOT_FILE = "signal-state.json";
const SNAPSHOT_BYTES_LIMIT = 64 * 1024 * 1024;

const Expiring = Schema.Tuple([Schema.String, Schema.Number]);
export const TrustedResumeToken = Schema.Tuple([
  Schema.String,
  Schema.Struct({
    expiresAt: Schema.Number,
    hostId: Schema.String,
    sessionId: Schema.String,
    authEpoch: Schema.Number,
  }),
]);

export const SignalRefusals = Schema.Struct({
  usedTicketIds: Schema.Array(Expiring),
  revokedEpochs: Schema.Array(Expiring),
  revokedSessions: Schema.Array(Expiring),
  endedHostSessions: Schema.Array(Schema.Tuple([Schema.String, Schema.Array(Expiring)])),
  slackRouteFloors: Schema.Array(Expiring),
  telegramRouteFloors: Schema.Array(Expiring),
  discordRouteFloors: Schema.Array(Expiring),
  webhookRouteFloors: Schema.Array(Expiring),
});
export type SignalRefusals = typeof SignalRefusals.Type;
export type TrustedResumeTokenEntry = typeof TrustedResumeToken.Type;

const SignalStatePayload = Schema.Struct({
  version: Schema.Literal(1),
  signalId: Schema.String,
  writtenAt: Schema.Number,
  lastAuthEventAt: Schema.NullOr(Schema.Number),
  ticketCutoff: Schema.Number,
  routeCutoff: Schema.Number,
  trusted: Schema.Array(TrustedResumeToken),
  refusals: SignalRefusals,
});
export type SignalStatePayload = typeof SignalStatePayload.Type;

const SealedSnapshot = Schema.Struct({ payload: Schema.String, signature: Schema.String });
const decodePayload = Schema.decodeUnknownOption(Schema.fromJsonString(SignalStatePayload));
const decodeSealed = Schema.decodeUnknownOption(Schema.fromJsonString(SealedSnapshot));

export type SnapshotRefusal = "format" | "signature" | "signal" | "old" | "future";

class SnapshotFileError extends Schema.TaggedError<SnapshotFileError>()("SnapshotFileError", {
  message: Schema.String,
}) {}

function sign(payload: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(SNAPSHOT_SIGNATURE_CONTEXT).update(payload).digest();
}

export function sealSnapshot(payload: SignalStatePayload, secret: string): string {
  const text = JSON.stringify(payload);
  return JSON.stringify({ payload: text, signature: sign(text, secret).toString("base64url") });
}

export function openSnapshot(
  sealed: string,
  secret: string,
  signalId: string,
  now: number,
): { ok: true; payload: SignalStatePayload } | { ok: false; reason: SnapshotRefusal } {
  const envelope = decodeSealed(sealed);
  if (envelope._tag === "None") return { ok: false, reason: "format" };
  const expected = sign(envelope.value.payload, secret);
  const actual = Buffer.from(envelope.value.signature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    return { ok: false, reason: "signature" };
  const payload = decodePayload(envelope.value.payload);
  if (payload._tag === "None") return { ok: false, reason: "format" };
  if (payload.value.signalId !== signalId) return { ok: false, reason: "signal" };
  if (payload.value.writtenAt > now + SNAPSHOT_FUTURE_SKEW_MILLISECONDS) return { ok: false, reason: "future" };
  if (now - payload.value.writtenAt > SNAPSHOT_MAXIMUM_AGE_MILLISECONDS) return { ok: false, reason: "old" };
  return { ok: true, payload: payload.value };
}

export const writeSnapshotFile = Effect.fn("SignalState.write")(function* (directory: string, sealed: string) {
  const temporary = join(directory, `${SNAPSHOT_FILE}.${randomBytes(8).toString("hex")}.tmp`);
  yield* Effect.tryPromise({
    try: async () => {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      try {
        await writeFile(temporary, sealed, { mode: 0o600 });
        await rename(temporary, join(directory, SNAPSHOT_FILE));
      } catch (error) {
        await rm(temporary, { force: true });
        throw error;
      }
    },
    catch: () => new SnapshotFileError({ message: "The Signal state could not be written." }),
  });
});

export const readSnapshotFile = Effect.fn("SignalState.read")(function* (directory: string) {
  return yield* Effect.tryPromise({
    try: async () => {
      const bytes = await readFile(join(directory, SNAPSHOT_FILE));
      return bytes.byteLength > SNAPSHOT_BYTES_LIMIT ? null : bytes.toString("utf8");
    },
    catch: () => new SnapshotFileError({ message: "The Signal state could not be read." }),
  }).pipe(Effect.catch(() => Effect.succeed(null)));
});
