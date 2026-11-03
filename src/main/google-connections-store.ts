import { readFile } from "node:fs/promises";
import { Effect, Result, Schema, Semaphore } from "effect";
import { writeJsonFileAtomically } from "../backend/atomic-json-file";
import { causeHelpers } from "../backend/effect-boundary";
import { isMissingFileError } from "../backend/file-errors";
import type { SecretCipher } from "./provider-credential-store";

export class GoogleConnectionsFailure extends Schema.TaggedError<GoogleConnectionsFailure>()(
  "GoogleConnectionsFailure",
  { cause: Schema.Defect() },
) {}
export const googleEffects = causeHelpers(GoogleConnectionsFailure);
const text = (max: number) => Schema.String.check(Schema.isMaxLength(max));
const identifier = text(128).check(Schema.isPattern(/^[A-Za-z0-9_-]+$/u));
const Config = Schema.Struct({
  templateMcpServerId: identifier,
  command: text(4096),
  cliPath: text(4096),
  home: text(4096),
  clientId: text(1024),
  clientSecret: text(4096),
});
const Profile = Schema.Struct({
  id: identifier,
  ownerMemberId: identifier,
  email: Schema.NullOr(text(320)),
  mcpServerId: Schema.NullOr(identifier),
  roleId: identifier,
  agentId: Schema.NullOr(identifier),
  connected: Schema.Boolean,
});
const State = Schema.Struct({
  config: Schema.NullOr(Config),
  profiles: Schema.Array(Profile).check(Schema.isMaxLength(100)),
});
const Envelope = Schema.Struct({ version: Schema.Literal(1), record: text(1024 * 1024) });
export type GoogleConnectionsConfig = typeof Config.Type;
export type GoogleOwnedProfile = typeof Profile.Type;
type SavedState = typeof State.Type;
export const GOOGLE_CONNECTIONS_FILE = "openbot-google-connections-v1.json";
/** Owns encrypted enrollment configuration and authenticated ownership metadata, never renderer tokens. */
export class GoogleConnectionsStore {
  #state: SavedState = { config: null, profiles: [] };
  #closed = false;
  readonly #writes = Semaphore.makeUnsafe(1);
  constructor(
    readonly path: string,
    readonly cipher: SecretCipher,
  ) {}
  get closed() {
    return this.#closed;
  }
  read(): SavedState {
    return structuredClone(this.#state);
  }
  readonly load = Effect.fn("GoogleConnectionsStore.load")(function* (this: GoogleConnectionsStore) {
    const result = yield* Effect.result(googleEffects.io(() => readFile(this.path, "utf8")));
    if (Result.isFailure(result)) {
      if (!isMissingFileError(result.failure.cause)) this.#closed = true;
      return;
    }
    const parsed = yield* Effect.result(
      googleEffects.sync(() => {
        if (result.success.length > 1024 * 1024) throw new Error("Google connection file is too large.");
        const envelope = Schema.decodeUnknownSync(Envelope)(JSON.parse(result.success));
        return Schema.decodeUnknownSync(State)(JSON.parse(this.cipher.decrypt(Buffer.from(envelope.record, "base64"))));
      }),
    );
    if (Result.isFailure(parsed)) {
      this.#closed = true;
      return;
    }
    this.#state = parsed.success;
  }).bind(this);
  readonly update = Effect.fn("GoogleConnectionsStore.update")(function* (
    this: GoogleConnectionsStore,
    change: (state: SavedState) => SavedState,
  ) {
    return yield* this.#writes.withPermit(
      Effect.uninterruptible(
        Effect.gen({ self: this }, function* () {
          if (this.#closed)
            return yield* new GoogleConnectionsFailure({ cause: new Error("Google connections are unavailable.") });
          const next = yield* googleEffects.sync(() => Schema.decodeUnknownSync(State)(change(this.read())));
          const record = yield* googleEffects.sync(() => this.cipher.encrypt(JSON.stringify(next)).toString("base64"));
          yield* writeJsonFileAtomically(this.path, { version: 1, record }, { createDirectory: true }).pipe(
            Effect.mapError((e) => new GoogleConnectionsFailure({ cause: e.cause })),
          );
          this.#state = next;
          return this.read();
        }),
      ),
    );
  }).bind(this);
}
