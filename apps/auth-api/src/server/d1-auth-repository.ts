import type { AccountSession, MobileConnectHostBinding } from "@openbot/contracts/mobile-connect";
import { Context, Effect, Layer, Schema } from "effect";
import { sha256 } from "./crypto";
import type {
  AuthRepository,
  AuthUser,
  EmailChallengeDeliveryState,
  EmailChallengeRecord,
  EmailVerificationResult,
  MobileAuthDevice,
  MobileAuthDeviceIdentity,
  MobileAuthSessionResult,
} from "./types";

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
  analytics_enabled: number | null;
}

interface AuthenticatedUserRow extends UserRow {
  last_used_at: number;
}

interface ChallengeRow {
  email: string;
  code_hash: string;
  expires_at: number;
  failed_attempts: number;
  max_attempts: number;
  consumed_at: number | null;
  delivery_state: EmailChallengeDeliveryState;
}

interface MobileSessionUserRow extends UserRow {
  last_used_at: number;
}

interface HostBindingRow {
  host_id: string | null;
  host_fingerprint: string | null;
  device_public_key: string | null;
  owner_user_id: string | null;
  user_id: string;
}

const SESSION_ACTIVITY_UPDATE_INTERVAL_MS = 15 * 60_000;

class AuthDatabase extends Context.Service<AuthDatabase, D1Database>()("auth-api/D1AuthRepository/Database") {}
export class AuthStoreError extends Schema.TaggedError<AuthStoreError>()("AuthStoreError", {
  message: Schema.String,
}) {}
function storeCall<A>(operation: () => Promise<A>): Effect.Effect<A, AuthStoreError> {
  return Effect.tryPromise({
    try: operation,
    catch: () => new AuthStoreError({ message: "Account store operation failed." }),
  });
}
export class D1AuthRepository implements AuthRepository {
  readonly #layer: Layer.Layer<AuthDatabase>;
  constructor(database: D1Database) {
    this.#layer = Layer.succeed(AuthDatabase, database);
  }

  readonly latestEmailChallengeAt = Effect.fn("D1AuthRepository.latestEmailChallengeAt")(
    function* (this: D1AuthRepository, email: string): Effect.fn.Return<number | null, AuthStoreError, AuthDatabase> {
      const database = yield* AuthDatabase;
      const row = yield* storeCall(() =>
        database
          .prepare(
            `SELECT created_at FROM email_login_challenges
         WHERE email = ? AND delivery_state IN ('pending', 'sent')
         ORDER BY created_at DESC LIMIT 1`,
          )
          .bind(email)
          .first<{ created_at: number }>(),
      );
      return row?.created_at ?? null;
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  readonly findEmailChallenge = Effect.fn("D1AuthRepository.findEmailChallenge")(
    function* (
      this: D1AuthRepository,
      idHash: string,
    ): Effect.fn.Return<EmailChallengeRecord | null, AuthStoreError, AuthDatabase> {
      const database = yield* AuthDatabase;
      const row = yield* storeCall(() =>
        database
          .prepare(
            `SELECT email, created_at, expires_at, consumed_at, delivery_state
         FROM email_login_challenges WHERE id_hash = ?`,
          )
          .bind(idHash)
          .first<{
            email: string;
            created_at: number;
            expires_at: number;
            consumed_at: number | null;
            delivery_state: EmailChallengeDeliveryState;
          }>(),
      );
      return row
        ? {
            email: row.email,
            createdAt: row.created_at,
            expiresAt: row.expires_at,
            consumedAt: row.consumed_at,
            deliveryState: row.delivery_state,
          }
        : null;
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  readonly createEmailChallenge = Effect.fn("D1AuthRepository.createEmailChallenge")(
    function* (
      this: D1AuthRepository,
      input: {
        idHash: string;
        email: string;
        codeHash: string;
        sourceIpHash: string;
        createdAt: number;
        expiresAt: number;
        maxAttempts: number;
      },
    ): Effect.fn.Return<boolean, AuthStoreError, AuthDatabase> {
      const database = yield* AuthDatabase;
      const result = yield* storeCall(() =>
        database
          .prepare(
            `INSERT INTO email_login_challenges(
          id_hash, email, code_hash, source_ip_hash, created_at, expires_at, max_attempts, delivery_state
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
        ON CONFLICT(id_hash) DO NOTHING`,
          )
          .bind(
            input.idHash,
            input.email,
            input.codeHash,
            input.sourceIpHash,
            input.createdAt,
            input.expiresAt,
            input.maxAttempts,
          )
          .run(),
      );
      return result.meta.changes === 1;
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  readonly completeEmailChallengeDelivery = Effect.fn("D1AuthRepository.completeEmailChallengeDelivery")(
    function* (
      this: D1AuthRepository,
      idHash: string,
      state: "sent" | "failed",
      now: number,
    ): Effect.fn.Return<void, AuthStoreError, AuthDatabase> {
      const database = yield* AuthDatabase;
      if (state === "sent") {
        yield* storeCall(() =>
          database
            .prepare(
              "UPDATE email_login_challenges SET delivery_state = 'sent' WHERE id_hash = ? AND delivery_state = 'pending'",
            )
            .bind(idHash)
            .run(),
        );
        return;
      }
      yield* storeCall(() =>
        database
          .prepare(
            `UPDATE email_login_challenges SET delivery_state = 'failed', consumed_at = COALESCE(consumed_at, ?)
         WHERE id_hash = ? AND delivery_state = 'pending'`,
          )
          .bind(now, idHash)
          .run(),
      );
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  readonly verifyEmailChallenge = Effect.fn("D1AuthRepository.verifyEmailChallenge")(
    function* (
      this: D1AuthRepository,
      input: {
        idHash: string;
        codeHash: string;
        now: number;
        session: { id: string; token: string; expiresAt: number };
        device?: MobileAuthDeviceIdentity;
      },
    ): Effect.fn.Return<EmailVerificationResult, AuthStoreError, AuthDatabase> {
      const database = yield* AuthDatabase;
      const challenge = yield* storeCall(() =>
        database
          .prepare(
            `SELECT email, code_hash, expires_at, failed_attempts, max_attempts, consumed_at, delivery_state
         FROM email_login_challenges WHERE id_hash = ?`,
          )
          .bind(input.idHash)
          .first<ChallengeRow>(),
      );
      if (!challenge || challenge.delivery_state === "failed" || challenge.consumed_at !== null) {
        return { status: "invalid" };
      }
      if (challenge.expires_at <= input.now) return { status: "expired" };
      if (challenge.failed_attempts >= challenge.max_attempts) {
        return { status: "too_many_attempts" };
      }
      if (!constantTimeEqual(challenge.code_hash, input.codeHash)) {
        const result = yield* storeCall(() =>
          database
            .prepare(
              `UPDATE email_login_challenges
           SET failed_attempts = failed_attempts + 1
           WHERE id_hash = ? AND delivery_state != 'failed' AND consumed_at IS NULL AND failed_attempts < max_attempts`,
            )
            .bind(input.idHash)
            .run(),
        );
        return result.meta.changes > 0 && challenge.failed_attempts + 1 >= challenge.max_attempts
          ? { status: "too_many_attempts" }
          : { status: "invalid" };
      }

      const consumed = yield* storeCall(() =>
        database
          .prepare(
            `UPDATE email_login_challenges SET consumed_at = ?
         WHERE id_hash = ? AND delivery_state != 'failed' AND consumed_at IS NULL
           AND expires_at > ? AND failed_attempts < max_attempts`,
          )
          .bind(input.now, input.idHash, input.now)
          .run(),
      );
      if (consumed.meta.changes !== 1) return { status: "invalid" };

      const { user, created } = yield* this.#upsertEmailUserEffect(challenge.email, input.now);
      const tokenHash = yield* sha256(input.session.token).pipe(
        Effect.mapError(() => new AuthStoreError({ message: "Account store operation failed." })),
      );
      const insertSession = database
        .prepare(
          `INSERT INTO auth_sessions(
          id, user_id, token_hash, expires_at, created_at, last_used_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(input.session.id, user.id, tokenHash, input.session.expiresAt, input.now, input.now);
      const device = input.device;
      if (device) {
        // One batch: a session without its mobile row would count as a desktop session.
        const [created, registered] = yield* storeCall(() =>
          database.batch([
            insertSession,
            ...mobileSessionStatements(database, { now: input.now, session: input.session, device }, null),
          ]),
        );
        if (created?.meta.changes !== 1 || registered?.meta.changes !== 1) {
          return yield* new AuthStoreError({ message: "Account store operation failed." });
        }
      } else {
        yield* storeCall(() => insertSession.run());
      }
      return {
        status: "verified",
        session: { sessionToken: input.session.token, user },
        created,
      };
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  readonly incrementRateLimit = Effect.fn("D1AuthRepository.incrementRateLimit")(
    function* (
      this: D1AuthRepository,
      keyHash: string,
      windowStart: number,
      limit: number,
    ): Effect.fn.Return<{ allowed: boolean; count: number; windowStart: number }, AuthStoreError, AuthDatabase> {
      const database = yield* AuthDatabase;
      const row = yield* storeCall(() =>
        database
          .prepare(
            `INSERT INTO auth_rate_limits(key_hash, window_start, attempts) VALUES (?, ?, 1)
         ON CONFLICT(key_hash, window_start) DO UPDATE SET attempts = attempts + 1
         RETURNING attempts`,
          )
          .bind(keyHash, windowStart)
          .first<{ attempts: number }>(),
      );
      const count = row?.attempts ?? limit + 1;
      return { allowed: count <= limit, count, windowStart };
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  readonly authenticate = Effect.fn("D1AuthRepository.authenticate")(
    function* (
      this: D1AuthRepository,
      sessionToken: string,
      now: number,
    ): Effect.fn.Return<AuthUser | null, AuthStoreError, AuthDatabase> {
      const database = yield* AuthDatabase;
      const tokenHash = yield* sha256(sessionToken).pipe(
        Effect.mapError(() => new AuthStoreError({ message: "Account store operation failed." })),
      );
      const row = yield* storeCall(() =>
        database
          .prepare(
            `SELECT users.id, users.email, users.name, users.avatar_url, users.analytics_enabled, auth_sessions.last_used_at
         FROM auth_sessions
         JOIN users ON users.id = auth_sessions.user_id
         WHERE auth_sessions.token_hash = ?
           AND auth_sessions.revoked_at IS NULL
           AND auth_sessions.expires_at > ?`,
          )
          .bind(tokenHash, now)
          .first<AuthenticatedUserRow>(),
      );
      if (!row) return null;
      yield* this.#updateSessionActivityEffect(tokenHash, row.last_used_at, now);
      return mapUser(row);
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  readonly authenticateDesktopSession = Effect.fn("D1AuthRepository.authenticateDesktopSession")(
    function* (
      this: D1AuthRepository,
      sessionToken: string,
      now: number,
    ): Effect.fn.Return<AuthUser | null, AuthStoreError, AuthDatabase> {
      const database = yield* AuthDatabase;
      const tokenHash = yield* sha256(sessionToken).pipe(
        Effect.mapError(() => new AuthStoreError({ message: "Account store operation failed." })),
      );
      const row = yield* storeCall(() =>
        database
          .prepare(
            `SELECT users.id, users.email, users.name, users.avatar_url, users.analytics_enabled, auth_sessions.last_used_at
         FROM auth_sessions
         JOIN users ON users.id = auth_sessions.user_id
         WHERE auth_sessions.token_hash = ?
           AND auth_sessions.revoked_at IS NULL
           AND auth_sessions.expires_at > ?
           AND NOT EXISTS (
             SELECT 1 FROM mobile_auth_sessions
             WHERE mobile_auth_sessions.session_id = auth_sessions.id
           )`,
          )
          .bind(tokenHash, now)
          .first<AuthenticatedUserRow>(),
      );
      if (!row) return null;
      yield* this.#updateSessionActivityEffect(tokenHash, row.last_used_at, now);
      return mapUser(row);
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  readonly revokeSession = Effect.fn("D1AuthRepository.revokeSession")(
    function* (
      this: D1AuthRepository,
      sessionToken: string,
      now: number,
    ): Effect.fn.Return<void, AuthStoreError, AuthDatabase> {
      const database = yield* AuthDatabase;
      const tokenHash = yield* sha256(sessionToken).pipe(
        Effect.mapError(() => new AuthStoreError({ message: "Account store operation failed." })),
      );
      yield* storeCall(() =>
        database.prepare("UPDATE auth_sessions SET revoked_at = ? WHERE token_hash = ?").bind(now, tokenHash).run(),
      );
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  readonly revokeMobileSession = Effect.fn("D1AuthRepository.revokeMobileSession")(
    function* (
      this: D1AuthRepository,
      sessionToken: string,
      now: number,
    ): Effect.fn.Return<boolean, AuthStoreError, AuthDatabase> {
      const database = yield* AuthDatabase;
      const tokenHash = yield* sha256(sessionToken).pipe(
        Effect.mapError(() => new AuthStoreError({ message: "Account store operation failed." })),
      );
      const result = yield* storeCall(() =>
        database
          .prepare(
            `UPDATE auth_sessions SET revoked_at = ?
         WHERE token_hash = ? AND revoked_at IS NULL
           AND id IN (SELECT session_id FROM mobile_auth_sessions)
         RETURNING id`,
          )
          .bind(now, tokenHash)
          .first<{ id: string }>(),
      );
      return result !== null;
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  readonly updateUserName = Effect.fn("D1AuthRepository.updateUserName")(
    function* (
      this: D1AuthRepository,
      userId: string,
      name: string,
      now: number,
    ): Effect.fn.Return<AuthUser, AuthStoreError, AuthDatabase> {
      const database = yield* AuthDatabase;
      const row = yield* storeCall(() =>
        database
          .prepare(
            `UPDATE users SET name = ?, updated_at = ?
         WHERE id = ?
         RETURNING id, email, name, avatar_url, analytics_enabled`,
          )
          .bind(name, now, userId)
          .first<UserRow>(),
      );
      if (!row) return yield* new AuthStoreError({ message: "User not found." });
      return mapUser(row);
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  readonly updateUserAnalytics = Effect.fn("D1AuthRepository.updateUserAnalytics")(
    function* (
      this: D1AuthRepository,
      userId: string,
      enabled: boolean,
      answeredAt: number,
      now: number,
    ): Effect.fn.Return<AuthUser, AuthStoreError, AuthDatabase> {
      const database = yield* AuthDatabase;
      // An answer older than the saved one changes nothing; the caller gets the saved answer.
      yield* storeCall(() =>
        database
          .prepare(
            `UPDATE users SET analytics_enabled = ?, analytics_answered_at = ?, updated_at = ?
         WHERE id = ? AND (analytics_answered_at IS NULL OR analytics_answered_at <= ?)`,
          )
          .bind(enabled ? 1 : 0, answeredAt, now, userId, answeredAt)
          .run(),
      );
      const row = yield* storeCall(() =>
        database
          .prepare("SELECT id, email, name, avatar_url, analytics_enabled FROM users WHERE id = ?")
          .bind(userId)
          .first<UserRow>(),
      );
      if (!row) return yield* new AuthStoreError({ message: "User not found." });
      return mapUser(row);
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  readonly updateUserAvatar = Effect.fn("D1AuthRepository.updateUserAvatar")(
    function* (
      this: D1AuthRepository,
      userId: string,
      avatarUrl: string | null,
      expectedAvatarUrl: string | null,
      now: number,
    ): Effect.fn.Return<AuthUser | null, AuthStoreError, AuthDatabase> {
      const database = yield* AuthDatabase;
      const row = yield* storeCall(() =>
        database
          .prepare(
            `UPDATE users SET avatar_url = ?, updated_at = ?
         WHERE id = ? AND avatar_url IS ?
         RETURNING id, email, name, avatar_url, analytics_enabled`,
          )
          .bind(avatarUrl, now, userId, expectedAvatarUrl)
          .first<UserRow>(),
      );
      return row ? mapUser(row) : null;
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  readonly createTeamAuthTicket = Effect.fn("D1AuthRepository.createTeamAuthTicket")(
    function* (
      this: D1AuthRepository,
      input: {
        ticketHash: string;
        userId: string;
        serverId: string;
        createdAt: number;
        expiresAt: number;
      },
    ): Effect.fn.Return<void, AuthStoreError, AuthDatabase> {
      const database = yield* AuthDatabase;
      yield* storeCall(() =>
        database
          .prepare(
            `INSERT INTO team_auth_tickets(
          ticket_hash, user_id, server_id, created_at, expires_at
        ) VALUES (?, ?, ?, ?, ?)`,
          )
          .bind(input.ticketHash, input.userId, input.serverId, input.createdAt, input.expiresAt)
          .run(),
      );
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  readonly replaceMobileAuthTicket = Effect.fn("D1AuthRepository.replaceMobileAuthTicket")(
    function* (
      this: D1AuthRepository,
      input: {
        host?: MobileConnectHostBinding | undefined;
        ticketHash: string;
        userId: string;
        serverId: string;
        createdAt: number;
        expiresAt: number;
      },
    ): Effect.fn.Return<void, AuthStoreError, AuthDatabase> {
      const database = yield* AuthDatabase;
      yield* storeCall(() =>
        database.batch([
          database
            .prepare(
              `UPDATE team_auth_tickets SET consumed_at = ?
           WHERE user_id = ? AND server_id = ? AND consumed_at IS NULL`,
            )
            .bind(input.createdAt, input.userId, input.serverId),
          database
            .prepare(
              `INSERT INTO team_auth_tickets(
            ticket_hash, user_id, server_id, created_at, expires_at, mobile_host_id, mobile_host_fingerprint
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            )
            .bind(
              input.ticketHash,
              input.userId,
              input.serverId,
              input.createdAt,
              input.expiresAt,
              input.host?.hostId ?? null,
              input.host?.fingerprint ?? null,
            ),
        ]),
      );
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  readonly cancelMobileAuthTickets = Effect.fn("D1AuthRepository.cancelMobileAuthTickets")(
    function* (
      this: D1AuthRepository,
      input: { userId: string; serverId: string; hostId: string; now: number },
    ): Effect.fn.Return<void, AuthStoreError, AuthDatabase> {
      const database = yield* AuthDatabase;
      yield* storeCall(() =>
        database
          .prepare(
            `UPDATE team_auth_tickets SET consumed_at = ?
         WHERE user_id = ? AND server_id = ? AND mobile_host_id = ? AND consumed_at IS NULL`,
          )
          .bind(input.now, input.userId, input.serverId, input.hostId)
          .run(),
      );
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  readonly redeemTeamAuthTicket = Effect.fn("D1AuthRepository.redeemTeamAuthTicket")(
    function* (
      this: D1AuthRepository,
      input: { ticketHash: string; serverId: string; now: number },
    ): Effect.fn.Return<AuthUser | null, AuthStoreError, AuthDatabase> {
      const database = yield* AuthDatabase;
      const consumed = yield* storeCall(() =>
        database
          .prepare(
            `UPDATE team_auth_tickets SET consumed_at = ?
         WHERE ticket_hash = ? AND server_id = ? AND consumed_at IS NULL AND expires_at > ?`,
          )
          .bind(input.now, input.ticketHash, input.serverId, input.now)
          .run(),
      );
      if (consumed.meta.changes !== 1) return null;
      const row = yield* storeCall(() =>
        database
          .prepare(
            `SELECT users.id, users.email, users.name, users.avatar_url, users.analytics_enabled
         FROM team_auth_tickets
         JOIN users ON users.id = team_auth_tickets.user_id
         WHERE team_auth_tickets.ticket_hash = ?`,
          )
          .bind(input.ticketHash)
          .first<UserRow>(),
      );
      return row ? mapUser(row) : null;
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  readonly redeemMobileAuthTicket = Effect.fn("D1AuthRepository.redeemMobileAuthTicket")(
    function* (
      this: D1AuthRepository,
      input: {
        ticketHash: string;
        serverId: string;
        now: number;
        session: { id: string; token: string; expiresAt: number };
        device: MobileAuthDeviceIdentity;
      },
    ): Effect.fn.Return<MobileAuthSessionResult | null, AuthStoreError, AuthDatabase> {
      const database = yield* AuthDatabase;
      const binding = yield* storeCall(() =>
        database
          .prepare(
            `SELECT t.mobile_host_id AS host_id, t.mobile_host_fingerprint AS host_fingerprint,
              h.device_public_key, h.owner_user_id, t.user_id
       FROM team_auth_tickets t LEFT JOIN remote_hosts h ON h.host_id = t.mobile_host_id
       WHERE t.ticket_hash = ? AND t.server_id = ? AND t.consumed_at IS NULL AND t.expires_at > ?`,
          )
          .bind(input.ticketHash, input.serverId, input.now)
          .first<HostBindingRow>(),
      );
      if (!binding || !(yield* hostBindingMatches(binding))) return null;
      const tokenHash = yield* storeHash(input.session.token);
      const [created, registered, , , consumed] = yield* storeCall(() =>
        database.batch([
          database
            .prepare(
              `INSERT INTO auth_sessions(id, user_id, token_hash, expires_at, created_at, last_used_at)
           SELECT ?, user_id, ?, ?, ?, ?
           FROM team_auth_tickets
           WHERE ticket_hash = ? AND server_id = ? AND consumed_at IS NULL AND expires_at > ?
             AND (mobile_host_id IS NULL OR EXISTS (
               SELECT 1 FROM remote_hosts h
               WHERE h.host_id = team_auth_tickets.mobile_host_id
                 AND h.owner_user_id = team_auth_tickets.user_id AND h.device_public_key = ?
             ))`,
            )
            .bind(
              input.session.id,
              tokenHash,
              input.session.expiresAt,
              input.now,
              input.now,
              input.ticketHash,
              input.serverId,
              input.now,
              binding.device_public_key,
            ),
          ...mobileSessionStatements(database, input, null),
          database
            .prepare(
              `UPDATE team_auth_tickets SET consumed_at = ?
           WHERE ticket_hash = ? AND server_id = ? AND consumed_at IS NULL AND expires_at > ?`,
            )
            .bind(input.now, input.ticketHash, input.serverId, input.now),
        ]),
      );
      if (created?.meta.changes !== 1 || registered?.meta.changes !== 1 || consumed?.meta.changes !== 1) return null;
      return yield* this.#mobileSessionResult(input, binding);
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  readonly replaceMobileConnectLink = Effect.fn("D1AuthRepository.replaceMobileConnectLink")(
    function* (
      this: D1AuthRepository,
      input: {
        linkHash: string;
        desktopSessionToken: string;
        userId: string;
        host: MobileConnectHostBinding;
        createdAt: number;
      },
    ): Effect.fn.Return<boolean, AuthStoreError, AuthDatabase> {
      const database = yield* AuthDatabase;
      const host = yield* storeCall(() =>
        database
          .prepare("SELECT device_public_key, owner_user_id FROM remote_hosts WHERE host_id = ?")
          .bind(input.host.hostId)
          .first<Pick<HostBindingRow, "device_public_key" | "owner_user_id">>(),
      );
      if (
        !host ||
        !(yield* hostBindingMatches({
          ...host,
          host_id: input.host.hostId,
          host_fingerprint: input.host.fingerprint,
          user_id: input.userId,
        }))
      )
        return false;
      const desktopTokenHash = yield* storeHash(input.desktopSessionToken);
      // The insert repeats the session and host checks, so a concurrent sign-out or host key change wins.
      // The earlier links are revoked only when the new link exists.
      const [inserted] = yield* storeCall(() =>
        database.batch([
          database
            .prepare(
              `INSERT INTO mobile_connect_links(
             link_hash, user_id, desktop_session_id, host_id, host_fingerprint, created_at
           )
           SELECT ?, s.user_id, s.id, h.host_id, ?, ?
           FROM auth_sessions s
           JOIN remote_hosts h ON h.host_id = ? AND h.owner_user_id = s.user_id AND h.device_public_key = ?
           WHERE s.token_hash = ? AND s.user_id = ? AND s.revoked_at IS NULL AND s.expires_at > ?
             AND NOT EXISTS (SELECT 1 FROM mobile_auth_sessions m WHERE m.session_id = s.id)`,
            )
            .bind(
              input.linkHash,
              input.host.fingerprint,
              input.createdAt,
              input.host.hostId,
              host.device_public_key,
              desktopTokenHash,
              input.userId,
              input.createdAt,
            ),
          database
            .prepare(
              `UPDATE mobile_connect_links SET revoked_at = ?
           WHERE user_id = ? AND host_id = ? AND revoked_at IS NULL AND link_hash <> ?
             AND EXISTS (SELECT 1 FROM mobile_connect_links WHERE link_hash = ?)`,
            )
            .bind(input.createdAt, input.userId, input.host.hostId, input.linkHash, input.linkHash),
        ]),
      );
      return inserted?.meta.changes === 1;
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  readonly revokeMobileConnectLink = Effect.fn("D1AuthRepository.revokeMobileConnectLink")(
    function* (
      this: D1AuthRepository,
      input: { userId: string; hostId: string; now: number },
    ): Effect.fn.Return<void, AuthStoreError, AuthDatabase> {
      const database = yield* AuthDatabase;
      // The phones that any link of this host signed in, also a replaced link's, are signed out with it.
      // The revocation trigger ends their remote sessions and queues the disconnect.
      yield* storeCall(() =>
        database.batch([
          database
            .prepare(
              `UPDATE auth_sessions SET revoked_at = ?
           WHERE user_id = ? AND revoked_at IS NULL
             AND id IN (
               SELECT session_id FROM mobile_auth_sessions WHERE user_id = ? AND connect_link_host_id = ?
             )`,
            )
            .bind(input.now, input.userId, input.userId, input.hostId),
          database
            .prepare(
              "UPDATE mobile_connect_links SET revoked_at = ? WHERE user_id = ? AND host_id = ? AND revoked_at IS NULL",
            )
            .bind(input.now, input.userId, input.hostId),
        ]),
      );
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  readonly redeemMobileConnectLink = Effect.fn("D1AuthRepository.redeemMobileConnectLink")(
    function* (
      this: D1AuthRepository,
      input: {
        linkHash: string;
        now: number;
        session: { id: string; token: string; expiresAt: number };
        device: MobileAuthDeviceIdentity;
      },
    ): Effect.fn.Return<MobileAuthSessionResult | null, AuthStoreError, AuthDatabase> {
      const database = yield* AuthDatabase;
      // A link is valid while it is not revoked and the desktop session that created it is active.
      const binding = yield* storeCall(() =>
        database
          .prepare(
            `SELECT l.host_id, l.host_fingerprint, h.device_public_key, h.owner_user_id, l.user_id
       FROM mobile_connect_links l
       JOIN auth_sessions d ON d.id = l.desktop_session_id
       JOIN remote_hosts h ON h.host_id = l.host_id
       WHERE l.link_hash = ? AND l.revoked_at IS NULL
         AND d.user_id = l.user_id AND d.revoked_at IS NULL AND d.expires_at > ?`,
          )
          .bind(input.linkHash, input.now)
          .first<HostBindingRow>(),
      );
      if (!binding || !(yield* hostBindingMatches(binding))) return null;
      const tokenHash = yield* storeHash(input.session.token);
      const [created, registered, , , used] = yield* storeCall(() =>
        database.batch([
          database
            .prepare(
              `INSERT INTO auth_sessions(id, user_id, token_hash, expires_at, created_at, last_used_at)
           SELECT ?, l.user_id, ?, ?, ?, ?
           FROM mobile_connect_links l
           JOIN auth_sessions d ON d.id = l.desktop_session_id
           JOIN remote_hosts h ON h.host_id = l.host_id
           WHERE l.link_hash = ? AND l.revoked_at IS NULL
             AND d.user_id = l.user_id AND d.revoked_at IS NULL AND d.expires_at > ?
             AND h.owner_user_id = l.user_id AND h.device_public_key = ?`,
            )
            .bind(
              input.session.id,
              tokenHash,
              input.session.expiresAt,
              input.now,
              input.now,
              input.linkHash,
              input.now,
              binding.device_public_key,
            ),
          ...mobileSessionStatements(database, input, binding.host_id),
          database
            .prepare(
              `UPDATE mobile_connect_links SET last_used_at = ?, use_count = use_count + 1
           WHERE link_hash = ? AND EXISTS (SELECT 1 FROM mobile_auth_sessions WHERE session_id = ?)`,
            )
            .bind(input.now, input.linkHash, input.session.id),
        ]),
      );
      if (created?.meta.changes !== 1 || registered?.meta.changes !== 1 || used?.meta.changes !== 1) return null;
      return yield* this.#mobileSessionResult(input, binding);
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  readonly #mobileSessionResult = Effect.fn("D1AuthRepository.mobileSessionResult")(function* (
    this: D1AuthRepository,
    input: { now: number; session: { token: string } },
    binding: HostBindingRow,
  ): Effect.fn.Return<MobileAuthSessionResult | null, AuthStoreError, AuthDatabase> {
    const user = yield* this.authenticate(input.session.token, input.now);
    if (!user) return null;
    return {
      sessionToken: input.session.token,
      user,
      ...(binding.host_id && binding.host_fingerprint
        ? { host: { hostId: binding.host_id, fingerprint: binding.host_fingerprint } }
        : {}),
    };
  });

  readonly authenticateMobileSession = Effect.fn("D1AuthRepository.authenticateMobileSession")(
    function* (
      this: D1AuthRepository,
      sessionToken: string,
      now: number,
    ): Effect.fn.Return<AuthUser | null, AuthStoreError, AuthDatabase> {
      const database = yield* AuthDatabase;
      const tokenHash = yield* sha256(sessionToken).pipe(
        Effect.mapError(() => new AuthStoreError({ message: "Account store operation failed." })),
      );
      const row = yield* storeCall(() =>
        database
          .prepare(
            `SELECT users.id, users.email, users.name, users.avatar_url, users.analytics_enabled, auth_sessions.last_used_at
         FROM auth_sessions
         JOIN mobile_auth_sessions ON mobile_auth_sessions.session_id = auth_sessions.id
         JOIN users ON users.id = auth_sessions.user_id
         WHERE auth_sessions.token_hash = ?
           AND auth_sessions.revoked_at IS NULL
           AND auth_sessions.expires_at > ?`,
          )
          .bind(tokenHash, now)
          .first<MobileSessionUserRow>(),
      );
      if (!row) return null;
      yield* this.#updateSessionActivityEffect(tokenHash, row.last_used_at, now);
      return mapUser(row);
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  readonly listMobileAuthDevices = Effect.fn("D1AuthRepository.listMobileAuthDevices")(
    function* (
      this: D1AuthRepository,
      userId: string,
      now: number,
      hostId: string | null,
    ): Effect.fn.Return<MobileAuthDevice[], AuthStoreError, AuthDatabase> {
      const database = yield* AuthDatabase;
      // A phone opens each host of the account directory, not only the host of its code. With a host,
      // the list keeps the phones only when that host is in the directory: the account has an active
      // membership, and the host has a key (`RemoteControlPlane.listHosts` and the Team client).
      const result = yield* storeCall(() =>
        database
          .prepare(
            `SELECT mobile_auth_sessions.session_id, mobile_auth_sessions.device_name,
                mobile_auth_sessions.platform, auth_sessions.created_at, auth_sessions.last_used_at,
                mobile_auth_sessions.connect_link_host_id IS NOT NULL AS via_link
         FROM mobile_auth_sessions
         JOIN auth_sessions ON auth_sessions.id = mobile_auth_sessions.session_id
         WHERE mobile_auth_sessions.user_id = ?
           AND auth_sessions.revoked_at IS NULL
           AND auth_sessions.expires_at > ?
           AND (? IS NULL OR EXISTS (
             SELECT 1 FROM remote_memberships m
             JOIN remote_hosts h ON h.host_id = m.host_id
             WHERE m.host_id = ? AND m.user_id = mobile_auth_sessions.user_id AND m.status = 'active'
               AND COALESCE(h.device_public_key, '') <> ''
           ))
         ORDER BY auth_sessions.last_used_at DESC, auth_sessions.created_at DESC`,
          )
          .bind(userId, now, hostId, hostId)
          .all<{
            session_id: string;
            device_name: string;
            platform: MobileAuthDevice["platform"];
            created_at: number;
            last_used_at: number;
            via_link: number;
          }>(),
      );
      return result.results.map((row) => ({
        sessionId: row.session_id,
        name: row.device_name,
        platform: row.platform,
        connectedAt: row.created_at,
        lastActiveAt: row.last_used_at,
        via: row.via_link === 1 ? "link" : "code",
      }));
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  readonly listAccountSessions = Effect.fn("D1AuthRepository.listAccountSessions")(
    function* (
      this: D1AuthRepository,
      userId: string,
      currentToken: string,
      now: number,
    ): Effect.fn.Return<AccountSession[], AuthStoreError, AuthDatabase> {
      const database = yield* AuthDatabase;
      const tokenHash = yield* sha256(currentToken).pipe(
        Effect.mapError(() => new AuthStoreError({ message: "Account store operation failed." })),
      );
      const result = yield* storeCall(() =>
        database
          .prepare(`
      SELECT a.id AS sessionId, COALESCE(m.device_name, h.name, 'Desktop') AS name,
        CASE WHEN m.session_id IS NULL THEN 'desktop' ELSE 'mobile' END AS kind,
        a.token_hash = ? AS is_current, a.created_at AS connectedAt, a.last_used_at AS lastActiveAt,
        h.server_id IS NOT NULL AS is_hosted_server
      FROM auth_sessions a LEFT JOIN mobile_auth_sessions m ON m.session_id = a.id
      LEFT JOIN hosted_servers h
        ON h.owner_user_id = a.user_id AND h.auth_session_id = a.id AND h.desired_state != 'deleted'
      WHERE a.user_id = ? AND a.revoked_at IS NULL AND a.expires_at > ?
      ORDER BY a.last_used_at DESC, a.created_at DESC
    `)
          .bind(tokenHash, userId, now)
          .all<Omit<AccountSession, "current" | "hostedServer"> & { is_current: number; is_hosted_server: number }>(),
      );
      return result.results.map(({ is_current, is_hosted_server, ...session }) => ({
        ...session,
        current: is_current === 1,
        ...(is_hosted_server === 1 ? { hostedServer: true } : {}),
      }));
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  readonly revokeAccountSession = Effect.fn("D1AuthRepository.revokeAccountSession")(
    function* (
      this: D1AuthRepository,
      userId: string,
      sessionId: string,
      now: number,
    ): Effect.fn.Return<boolean, AuthStoreError, AuthDatabase> {
      const database = yield* AuthDatabase;
      // The migration's trigger ends remote sessions and enqueues their disconnect atomically.
      // RETURNING, not meta.changes: D1 also counts the rows that the trigger changes.
      const result = yield* storeCall(() =>
        database
          .prepare(
            "UPDATE auth_sessions SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL RETURNING id",
          )
          .bind(now, sessionId, userId)
          .first<{ id: string }>(),
      );
      return result !== null;
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  readonly revokeMobileAuthDevice = Effect.fn("D1AuthRepository.revokeMobileAuthDevice")(
    function* (
      this: D1AuthRepository,
      userId: string,
      sessionId: string,
      now: number,
    ): Effect.fn.Return<boolean, AuthStoreError, AuthDatabase> {
      const database = yield* AuthDatabase;
      const result = yield* storeCall(() =>
        database
          .prepare(
            `UPDATE auth_sessions SET revoked_at = ?
         WHERE id = ? AND user_id = ? AND revoked_at IS NULL
           AND id IN (SELECT session_id FROM mobile_auth_sessions)
         RETURNING id`,
          )
          .bind(now, sessionId, userId)
          .first<{ id: string }>(),
      );
      return result !== null;
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  readonly createServerClaim = Effect.fn("D1AuthRepository.createServerClaim")(
    function* (
      this: D1AuthRepository,
      input: { claimHash: string; email: string; createdAt: number; expiresAt: number },
    ): Effect.fn.Return<void, AuthStoreError, AuthDatabase> {
      const database = yield* AuthDatabase;
      // One batch, and no conflict on a user that another request creates at the same time.
      const [, created] = yield* storeCall(() =>
        database.batch([
          database
            .prepare(
              `INSERT INTO users(id, identity_key, email, name, avatar_url, created_at, updated_at)
           VALUES (?, ?, ?, NULL, NULL, ?, ?) ON CONFLICT DO NOTHING`,
            )
            .bind(crypto.randomUUID(), `email:${input.email}`, input.email, input.createdAt, input.createdAt),
          database
            .prepare(
              `INSERT INTO server_claims(claim_hash, user_id, created_at, expires_at)
           SELECT ?, id, ?, ? FROM users WHERE email = ?`,
            )
            .bind(input.claimHash, input.createdAt, input.expiresAt, input.email),
        ]),
      );
      if (created?.meta.changes !== 1) return yield* new AuthStoreError({ message: "Account store operation failed." });
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  readonly redeemServerClaim = Effect.fn("D1AuthRepository.redeemServerClaim")(
    function* (
      this: D1AuthRepository,
      input: { claimHash: string; now: number; session: { id: string; token: string; expiresAt: number } },
    ): Effect.fn.Return<{ sessionToken: string; user: AuthUser } | null, AuthStoreError, AuthDatabase> {
      const database = yield* AuthDatabase;
      const tokenHash = yield* storeHash(input.session.token);
      // The session row is made only by the redeem that spent the claim.
      const [spent] = yield* storeCall(() =>
        database.batch([
          database
            .prepare(
              `UPDATE server_claims SET redeemed_at = ?, session_id = ?
           WHERE claim_hash = ? AND redeemed_at IS NULL AND expires_at > ?`,
            )
            .bind(input.now, input.session.id, input.claimHash, input.now),
          database
            .prepare(
              `INSERT INTO auth_sessions(id, user_id, token_hash, expires_at, created_at, last_used_at)
           SELECT ?, user_id, ?, ?, ?, ? FROM server_claims WHERE claim_hash = ? AND session_id = ?`,
            )
            .bind(
              input.session.id,
              tokenHash,
              input.session.expiresAt,
              input.now,
              input.now,
              input.claimHash,
              input.session.id,
            ),
        ]),
      );
      if (spent?.meta.changes !== 1) return null;
      // Through the new session: the retention job can already have removed the spent claim.
      const row = yield* storeCall(() =>
        database
          .prepare(
            `SELECT users.id, users.email, users.name, users.avatar_url, users.analytics_enabled
         FROM auth_sessions JOIN users ON users.id = auth_sessions.user_id
         WHERE auth_sessions.id = ?`,
          )
          .bind(input.session.id)
          .first<UserRow>(),
      );
      return row ? { sessionToken: input.session.token, user: mapUser(row) } : null;
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  readonly #updateSessionActivityEffect = Effect.fn("D1AuthRepository.updateSessionActivity")(function* (
    this: D1AuthRepository,
    tokenHash: string,
    lastUsedAt: number,
    now: number,
  ): Effect.fn.Return<void, AuthStoreError, AuthDatabase> {
    const database = yield* AuthDatabase;
    const activityCutoff = now - SESSION_ACTIVITY_UPDATE_INTERVAL_MS;
    if (lastUsedAt > activityCutoff) return;
    yield* storeCall(() =>
      database
        .prepare("UPDATE auth_sessions SET last_used_at = ? WHERE token_hash = ? AND last_used_at <= ?")
        .bind(now, tokenHash, activityCutoff)
        .run(),
    );
  });

  readonly #upsertEmailUserEffect = Effect.fn("D1AuthRepository.upsertEmailUser")(function* (
    this: D1AuthRepository,
    email: string,
    now: number,
  ): Effect.fn.Return<{ user: AuthUser; created: boolean }, AuthStoreError, AuthDatabase> {
    const database = yield* AuthDatabase;
    const existing = yield* storeCall(() =>
      database
        .prepare("SELECT id, email, name, avatar_url, analytics_enabled FROM users WHERE email = ?")
        .bind(email)
        .first<UserRow>(),
    );
    if (existing) return { user: mapUser(existing), created: false };
    const id = crypto.randomUUID();
    yield* storeCall(() =>
      database
        .prepare(
          `INSERT INTO users(
          id, identity_key, email, name, avatar_url, created_at, updated_at
        ) VALUES (?, ?, ?, NULL, NULL, ?, ?)`,
        )
        .bind(id, `email:${email}`, email, now, now)
        .run(),
    );
    return { user: { id, email, name: null, avatarUrl: null, analyticsEnabled: null }, created: true };
  });
}

/** Registers the new mobile session and replaces the earlier session of the same device. */
function mobileSessionStatements(
  database: D1Database,
  input: { now: number; session: { id: string }; device: MobileAuthDeviceIdentity },
  linkHostId: string | null,
): D1PreparedStatement[] {
  return [
    database
      .prepare(
        `INSERT INTO mobile_auth_sessions(
       session_id, user_id, device_id, device_name, platform, created_at, connect_link_host_id
     )
     SELECT id, user_id, ?, ?, ?, ?, ? FROM auth_sessions WHERE id = ?`,
      )
      .bind(input.device.id, input.device.name, input.device.platform, input.now, linkHostId, input.session.id),
    database
      .prepare(
        `UPDATE auth_sessions SET revoked_at = ?
     WHERE id <> ? AND revoked_at IS NULL
       AND id IN (
         SELECT session_id FROM mobile_auth_sessions
         WHERE user_id = (SELECT user_id FROM mobile_auth_sessions WHERE session_id = ?)
           AND device_id = ?
       )`,
      )
      .bind(input.now, input.session.id, input.session.id, input.device.id),
    database
      .prepare(
        `DELETE FROM mobile_auth_sessions
     WHERE session_id <> ?
       AND user_id = (SELECT user_id FROM mobile_auth_sessions WHERE session_id = ?)
       AND device_id = ?`,
      )
      .bind(input.session.id, input.session.id, input.device.id),
  ];
}

/**
 * A host-bound credential is valid only while its account owns the host and the host key has the
 * stored fingerprint. A legacy ticket has no host.
 */
const hostBindingMatches = Effect.fn("D1AuthRepository.hostBindingMatches")(function* (binding: HostBindingRow) {
  if (!binding.host_id) return true;
  if (!binding.device_public_key || binding.owner_user_id !== binding.user_id) return false;
  return (yield* storeHash(binding.device_public_key)) === binding.host_fingerprint;
});

function storeHash(value: string): Effect.Effect<string, AuthStoreError> {
  return sha256(value).pipe(Effect.mapError(() => new AuthStoreError({ message: "Account store operation failed." })));
}

function mapUser(row: UserRow): AuthUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    avatarUrl: row.avatar_url,
    analyticsEnabled: row.analytics_enabled === null ? null : row.analytics_enabled === 1,
  };
}

function constantTimeEqual(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}
