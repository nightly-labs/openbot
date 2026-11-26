import {
  verifyWatchProof,
  WATCH_SESSION_TTL_MS,
  type WatchTicketRequest,
  watchClockAccepts,
  watchTicketProofMessage,
} from "@openbot/contracts/signal-protocol/watch-relay";
import { Effect, Schema } from "effect";
import { decodeBase64Url, randomToken, sha256 } from "./crypto";
import { RemoteControlPlaneError, type RemoteFailure } from "./remote-control-plane";

export const WATCH_SESSIONS_PER_USER = 5;

const WATCH_PUBLIC_KEY_PATTERN = /^B[A-Za-z0-9_-]{86}$/u;
const WATCH_PUBLIC_KEY_BYTES = 65;
const WATCH_SESSION_ID_PATTERN = /^[A-Za-z0-9-]{36}$/u;

export class WatchSessionStoreError extends Schema.TaggedError<WatchSessionStoreError>()(
  "WatchSessionStoreError",
  {},
) {}

interface CreatedWatchSession {
  watchSessionId: string;
  token: string;
  expiresAt: number;
}

interface AccountWatchSession {
  watchSessionId: string;
  authSessionId: string;
  connectedAt: number;
  lastActiveAt: number;
  expiresAt: number;
}

interface IssuedWatchTicket {
  ticket: string;
  expiresAt: number;
  signalUrl: string;
}

export interface WatchSessionDependencies {
  database: D1Database;
  now: () => number;
  issueTicket: (input: {
    watchSessionId: string;
    userId: string;
    hostId: string;
    clientPublicKey: string;
    sessionExpiresAt: number;
  }) => Effect.Effect<IssuedWatchTicket, RemoteFailure>;
  allowTicket: ((watchSessionId: string) => Effect.Effect<boolean, WatchSessionStoreError>) | null;
}

interface ActiveWatchSessionRow {
  watch_session_id: string;
  user_id: string;
  public_key: string;
  expires_at: number;
}

function storeCall<A>(operation: () => Promise<A>): Effect.Effect<A, WatchSessionStoreError> {
  return Effect.tryPromise({ try: operation, catch: () => new WatchSessionStoreError({}) });
}

function invalidPublicKey(): RemoteControlPlaneError {
  return new RemoteControlPlaneError(400, "invalid_remote_request", "The watch public key is invalid.");
}

function watchSessionEnded(): RemoteControlPlaneError {
  return new RemoteControlPlaneError(401, "watch_session_ended", "The watch session has ended.");
}

const requireWatchPublicKey = Effect.fn("WatchSessions.requirePublicKey")(function* (value: unknown) {
  if (typeof value !== "string" || !WATCH_PUBLIC_KEY_PATTERN.test(value)) return yield* invalidPublicKey();
  const raw = decodeBase64Url(value);
  if (raw.byteLength !== WATCH_PUBLIC_KEY_BYTES || raw[0] !== 4) return yield* invalidPublicKey();
  yield* Effect.tryPromise({
    try: () => crypto.subtle.importKey("raw", raw, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]),
    catch: invalidPublicKey,
  });
  return value;
});

export class WatchSessions {
  readonly #dependencies: WatchSessionDependencies;

  constructor(dependencies: WatchSessionDependencies) {
    this.#dependencies = dependencies;
  }

  readonly create = Effect.fn("WatchSessions.create")(function* (
    this: WatchSessions,
    input: { userId: string; authSessionToken: string; publicKey: unknown },
  ) {
    const { database, now: clock } = this.#dependencies;
    const publicKey = yield* requireWatchPublicKey(input.publicKey);
    const authSessionHash = yield* sha256(input.authSessionToken);
    const now = clock();
    const watchSessionId = crypto.randomUUID();
    const token = randomToken(32);
    const tokenHash = yield* sha256(token);
    const [, inserted] = yield* storeCall(() =>
      database.batch<{ expires_at: number }>([
        database
          .prepare(
            `UPDATE watch_sessions SET revoked_at = ?
         WHERE user_id = ? AND public_key = ? AND revoked_at IS NULL
           AND EXISTS(
             SELECT 1 FROM auth_sessions
              WHERE token_hash = ? AND user_id = ? AND revoked_at IS NULL AND expires_at > ?
           )`,
          )
          .bind(now, input.userId, publicKey, authSessionHash, input.userId, now),
        database
          .prepare(
            `INSERT INTO watch_sessions(
           watch_session_id, user_id, auth_session_hash, token_hash, public_key, created_at, expires_at, last_used_at
         )
         SELECT ?, user_id, token_hash, ?, ?, ?, MIN(?, expires_at), ?
           FROM auth_sessions
          WHERE token_hash = ? AND user_id = ? AND revoked_at IS NULL AND expires_at > ?
         RETURNING expires_at`,
          )
          .bind(
            watchSessionId,
            tokenHash,
            publicKey,
            now,
            now + WATCH_SESSION_TTL_MS,
            now,
            authSessionHash,
            input.userId,
            now,
          ),
        database
          .prepare(
            `UPDATE watch_sessions SET revoked_at = ?
         WHERE user_id = ? AND revoked_at IS NULL
           AND watch_session_id NOT IN (
             SELECT watch_session_id FROM watch_sessions
              WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?
              ORDER BY created_at DESC, rowid DESC LIMIT ?
           )`,
          )
          .bind(now, input.userId, input.userId, now, WATCH_SESSIONS_PER_USER),
      ]),
    );
    const expiresAt = inserted?.results[0]?.expires_at;
    if (expiresAt === undefined) {
      return yield* new RemoteControlPlaneError(401, "auth_session_revoked", "The account session has ended.");
    }
    const created: CreatedWatchSession = { watchSessionId, token, expiresAt };
    return created;
  }).bind(this);

  readonly revoke = Effect.fn("WatchSessions.revoke")(function* (
    this: WatchSessions,
    userId: string,
    watchSessionId: string,
  ) {
    const { database, now } = this.#dependencies;
    if (!WATCH_SESSION_ID_PATTERN.test(watchSessionId)) {
      return yield* new RemoteControlPlaneError(404, "watch_session_not_found", "The watch session was not found.");
    }
    const owned = yield* storeCall(() =>
      database
        .prepare("SELECT revoked_at FROM watch_sessions WHERE watch_session_id = ? AND user_id = ? LIMIT 1")
        .bind(watchSessionId, userId)
        .first<{ revoked_at: number | null }>(),
    );
    if (!owned) {
      return yield* new RemoteControlPlaneError(404, "watch_session_not_found", "The watch session was not found.");
    }
    if (owned.revoked_at !== null) return;
    yield* storeCall(() =>
      database
        .prepare(
          "UPDATE watch_sessions SET revoked_at = ? WHERE watch_session_id = ? AND user_id = ? AND revoked_at IS NULL",
        )
        .bind(now(), watchSessionId, userId)
        .run(),
    );
  }).bind(this);

  readonly listForAccount = Effect.fn("WatchSessions.listForAccount")(function* (
    this: WatchSessions,
    accountSessionToken: string,
  ) {
    const { database, now: clock } = this.#dependencies;
    const currentHash = yield* sha256(accountSessionToken);
    const now = clock();
    const rows = yield* storeCall(() =>
      database
        .prepare(
          `SELECT w.watch_session_id, parent.id AS auth_session_id, w.created_at, w.last_used_at, w.expires_at
         FROM auth_sessions account
         JOIN watch_sessions w ON w.user_id = account.user_id
         JOIN auth_sessions parent ON parent.token_hash = w.auth_session_hash AND parent.user_id = w.user_id
         WHERE account.token_hash = ? AND account.revoked_at IS NULL AND account.expires_at > ?
           AND w.revoked_at IS NULL AND w.expires_at > ?
           AND parent.revoked_at IS NULL AND parent.expires_at > ?
         ORDER BY w.last_used_at DESC, w.created_at DESC`,
        )
        .bind(currentHash, now, now, now)
        .all<{
          watch_session_id: string;
          auth_session_id: string;
          created_at: number;
          last_used_at: number;
          expires_at: number;
        }>(),
    );
    return rows.results.map(
      (row): AccountWatchSession => ({
        watchSessionId: row.watch_session_id,
        authSessionId: row.auth_session_id,
        connectedAt: row.created_at,
        lastActiveAt: row.last_used_at,
        expiresAt: row.expires_at,
      }),
    );
  }).bind(this);

  readonly issueTicket = Effect.fn("WatchSessions.issueTicket")(function* (
    this: WatchSessions,
    watchToken: string,
    request: WatchTicketRequest,
  ) {
    const { database, now: clock, issueTicket, allowTicket } = this.#dependencies;
    const tokenHash = yield* sha256(watchToken);
    const now = clock();
    const session = yield* storeCall(() =>
      database
        .prepare(
          `SELECT w.watch_session_id, w.user_id, w.public_key, w.expires_at
         FROM watch_sessions w
         JOIN auth_sessions parent ON parent.token_hash = w.auth_session_hash AND parent.user_id = w.user_id
         WHERE w.token_hash = ? AND w.revoked_at IS NULL AND w.expires_at > ?
           AND parent.revoked_at IS NULL AND parent.expires_at > ?
         LIMIT 1`,
        )
        .bind(tokenHash, now, now)
        .first<ActiveWatchSessionRow>(),
    );
    if (!session) return yield* watchSessionEnded();
    if (allowTicket && !(yield* allowTicket(session.watch_session_id))) {
      return yield* new RemoteControlPlaneError(429, "rate_limited", "Too many watch requests. Try again later.");
    }
    if (!watchClockAccepts(request.ts, now)) {
      return yield* new RemoteControlPlaneError(400, "watch_clock_skew", "The watch clock is not correct.");
    }
    const proofAccepted = yield* Effect.promise(() =>
      verifyWatchProof(
        session.public_key,
        watchTicketProofMessage(session.watch_session_id, request.hostId, request.ts),
        request.proof,
      ),
    );
    if (!proofAccepted) {
      return yield* new RemoteControlPlaneError(401, "watch_proof_invalid", "The watch proof is invalid.");
    }
    const issued = yield* issueTicket({
      watchSessionId: session.watch_session_id,
      userId: session.user_id,
      hostId: request.hostId,
      clientPublicKey: session.public_key,
      sessionExpiresAt: session.expires_at,
    });
    yield* storeCall(() =>
      database
        .prepare("UPDATE watch_sessions SET last_used_at = ? WHERE watch_session_id = ? AND revoked_at IS NULL")
        .bind(now, session.watch_session_id)
        .run(),
    );
    return issued;
  }).bind(this);
}
