import { Context, Effect, Layer, Schema } from "effect";
import { REMOTE_AUTH_EVENT_DELIVERED, REMOTE_AUTH_EVENT_RETENTION_MS } from "./remote-control-plane";

const RATE_LIMIT_WINDOW_MS = 15 * 60_000;
const CREDIT_CODE_LIMIT_WINDOW_MS = 60 * 60_000;
const RATE_LIMIT_PRUNE_CHUNK = 1_000;
const RATE_LIMIT_PRUNE_CHUNKS_PER_RUN = 10;

export interface AuthRetentionResult {
  challenges: number;
  sessions: number;
  creditCodeLimits: number;
  teamTickets: number;
  remoteSessions: number;
  watchSessions: number;
  remoteInvites: number;
  mobileConnectLinks: number;
  serverClaims: number;
  companySignIn: number;
  remoteAuthEvents: number;
}

interface AuthRetentionOperation {
  name: keyof AuthRetentionResult;
  sql: string;
  cutoff: number;
}

function authRetentionOperations(now: number): AuthRetentionOperation[] {
  return [
    {
      name: "challenges",
      sql: "DELETE FROM email_login_challenges WHERE expires_at <= ?",
      cutoff: now,
    },
    {
      name: "sessions",
      sql: "DELETE FROM auth_sessions WHERE expires_at <= ? OR revoked_at IS NOT NULL",
      cutoff: now,
    },
    {
      name: "creditCodeLimits",
      sql: "DELETE FROM credit_code_limits WHERE window_start <= ?",
      cutoff: now - CREDIT_CODE_LIMIT_WINDOW_MS,
    },
    {
      name: "teamTickets",
      sql: "DELETE FROM team_auth_tickets WHERE expires_at <= ? OR consumed_at IS NOT NULL",
      cutoff: now,
    },
    {
      name: "remoteSessions",
      sql: "DELETE FROM remote_sessions WHERE expires_at <= ?",
      cutoff: now - 10 * 60_000,
    },
    {
      name: "remoteSessions",
      sql: "DELETE FROM remote_sessions WHERE ended_at IS NOT NULL AND ended_at <= ?",
      cutoff: now - 10 * 60_000,
    },
    {
      name: "watchSessions",
      sql: "DELETE FROM watch_sessions WHERE expires_at <= ? OR revoked_at IS NOT NULL",
      cutoff: now,
    },
    {
      name: "remoteInvites",
      sql: "DELETE FROM remote_invites WHERE expires_at <= ?",
      cutoff: now - 24 * 60 * 60_000,
    },
    {
      name: "remoteInvites",
      sql: "DELETE FROM remote_invites WHERE used_at IS NOT NULL AND used_at <= ?",
      cutoff: now - 24 * 60 * 60_000,
    },
    {
      name: "remoteInvites",
      sql: "DELETE FROM remote_invites WHERE revoked_at IS NOT NULL AND revoked_at <= ?",
      cutoff: now - 24 * 60 * 60_000,
    },
    {
      name: "mobileConnectLinks",
      sql: "DELETE FROM mobile_connect_links WHERE revoked_at IS NOT NULL AND revoked_at <= ?",
      cutoff: now,
    },
    {
      name: "serverClaims",
      sql: "DELETE FROM server_claims WHERE expires_at <= ? OR redeemed_at IS NOT NULL",
      cutoff: now,
    },
    {
      name: "companySignIn",
      sql: "DELETE FROM company_sign_in_flows WHERE expires_at <= ?",
      cutoff: now,
    },
    {
      name: "companySignIn",
      sql: "DELETE FROM company_sign_in_codes WHERE expires_at <= ? OR redeemed_at IS NOT NULL",
      cutoff: now,
    },
    {
      name: "remoteAuthEvents",
      sql: `DELETE FROM remote_auth_events WHERE next_attempt_at = ${REMOTE_AUTH_EVENT_DELIVERED} AND created_at <= ?`,
      cutoff: now - REMOTE_AUTH_EVENT_RETENTION_MS,
    },
  ];
}

class AuthRetentionDatabase extends Context.Service<AuthRetentionDatabase, D1Database>()(
  "@openbot/auth-api/AuthRetentionDatabase",
) {}

class AuthRetentionError extends Schema.TaggedError<AuthRetentionError>()("AuthRetentionError", {
  message: Schema.String,
}) {}

const prune = Effect.fn("AuthRetention.prune")(function* (now: number) {
  const database = yield* AuthRetentionDatabase;
  const operations = authRetentionOperations(now);
  const results = yield* Effect.tryPromise({
    try: () => database.batch(operations.map((operation) => database.prepare(operation.sql).bind(operation.cutoff))),
    catch: () => new AuthRetentionError({ message: "Account data retention failed." }),
  });
  const deleted: AuthRetentionResult = {
    challenges: 0,
    sessions: 0,
    creditCodeLimits: 0,
    teamTickets: 0,
    remoteSessions: 0,
    watchSessions: 0,
    remoteInvites: 0,
    mobileConnectLinks: 0,
    serverClaims: 0,
    companySignIn: 0,
    remoteAuthEvents: 0,
  };
  for (const [index, operation] of operations.entries()) {
    deleted[operation.name] += results[index]?.meta.changes ?? 0;
  }
  return deleted;
});

export function pruneExpiredAuthData(database: D1Database, now: number) {
  return prune(now).pipe(Effect.provide(Layer.succeed(AuthRetentionDatabase)(database)));
}

const pruneRateLimits = Effect.fn("AuthRetention.pruneRateLimits")(function* (now: number) {
  const database = yield* AuthRetentionDatabase;
  let deleted = 0;
  for (let chunk = 0; chunk < RATE_LIMIT_PRUNE_CHUNKS_PER_RUN; chunk += 1) {
    const result = yield* Effect.tryPromise({
      try: () =>
        database
          .prepare(
            `DELETE FROM auth_rate_limits WHERE rowid IN (
               SELECT rowid FROM auth_rate_limits WHERE window_start <= ? LIMIT ?
             )`,
          )
          .bind(now - RATE_LIMIT_WINDOW_MS, RATE_LIMIT_PRUNE_CHUNK)
          .run(),
      catch: () => new AuthRetentionError({ message: "Rate limit retention failed." }),
    });
    const changes = result.meta.changes ?? 0;
    deleted += changes;
    if (changes < RATE_LIMIT_PRUNE_CHUNK) break;
  }
  return deleted;
});

export function pruneExpiredRateLimits(database: D1Database, now: number) {
  return pruneRateLimits(now).pipe(Effect.provide(Layer.succeed(AuthRetentionDatabase)(database)));
}
