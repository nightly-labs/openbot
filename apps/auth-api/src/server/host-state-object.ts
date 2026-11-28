import { DurableObject } from "cloudflare:workers";
import type { RemoteMemberRole } from "@openbot/contracts/signal-protocol/ticket";
import type { WorkerBindings } from "./types";

export interface HostStateCredential {
  host_id: string;
  owner_user_id: string;
  name: string;
  logo_key: string | null;
  auth_epoch: number;
  machine_token_hash: string | null;
  device_public_key: string | null;
  signal_home: string | null;
  signal_home_failed: string | null;
  signal_home_failed_at: number | null;
}

export interface HostStateSession {
  session_id: string;
  session_host_id: string;
  session_user_id: string;
  expires_at: number;
  ended_at: number | null;
  auth_session_hash: string | null;
  auth_live: number;
  membership_id: string;
  host_id: string;
  user_id: string;
  role: RemoteMemberRole;
  status: "active" | "revoked";
  auth_epoch: number;
  signal_home: string | null;
}

export interface HostStateListing {
  key_handovers: string;
  owner_licenses: string;
  custom_member_limit: number | null;
  server_entitlements: string;
}

export interface HostStateCopy<Value> {
  value: Value;
  checkedAt: number;
}

export interface HostStateQuery {
  credential?: boolean;
  sessions?: readonly string[];
  listing?: boolean;
}

export interface HostStateSnapshot {
  generation: number;
  credential: HostStateCopy<HostStateCredential> | null;
  sessions: Record<string, HostStateCopy<HostStateSession>>;
  listing: HostStateCopy<HostStateListing> | null;
}

export interface HostStateFill {
  credential?: HostStateCopy<HostStateCredential>;
  sessions?: readonly HostStateCopy<HostStateSession>[];
  listing?: HostStateCopy<HostStateListing>;
}

export const HOST_STATE_SESSION_COPY_LIMIT = 256;

const CREDENTIAL_KEY = "v1:credential";
const LISTING_KEY = "v1:listing";
const SESSION_KEY_PREFIX = "v1:session:";

const SCHEMA_EXISTS = "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'host_copy'";

const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS host_state (slot INTEGER PRIMARY KEY CHECK (slot = 1), generation INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS host_copy (key TEXT PRIMARY KEY, value TEXT NOT NULL, checked_at INTEGER NOT NULL)",
];

const GENERATION = "SELECT generation FROM host_state WHERE slot = 1";

const INVALIDATE = `INSERT INTO host_state(slot, generation) VALUES (1, 1)
ON CONFLICT(slot) DO UPDATE SET generation = host_state.generation + 1
RETURNING generation`;

const COPIES = "SELECT key, value, checked_at FROM host_copy WHERE key IN (SELECT value FROM json_each(?))";

const STORE_COPY = `INSERT INTO host_copy(key, value, checked_at) VALUES (?, ?, ?)
ON CONFLICT(key) DO UPDATE SET value = excluded.value, checked_at = excluded.checked_at`;

const PRUNE_STALE = "DELETE FROM host_copy WHERE checked_at < ?";

const PRUNE_SESSIONS = `DELETE FROM host_copy WHERE key IN (
  SELECT key FROM host_copy WHERE key LIKE 'v1:session:%' ORDER BY checked_at DESC LIMIT -1 OFFSET ?
)`;

function sessionKey(sessionId: string): string {
  return `${SESSION_KEY_PREFIX}${sessionId}`;
}

function emptySnapshot(generation: number): HostStateSnapshot {
  return { generation, credential: null, sessions: {}, listing: null };
}

export class HostState extends DurableObject<WorkerBindings> {
  #generation: number;
  #schema: boolean;
  #invalidationFailed = false;

  constructor(ctx: DurableObjectState, env: WorkerBindings) {
    super(ctx, env);
    this.#schema = ctx.storage.sql.exec(SCHEMA_EXISTS).toArray().length > 0;
    this.#generation = this.#schema ? HostState.#storedGeneration(ctx.storage.sql) : 0;
  }

  static #storedGeneration(sql: SqlStorage): number {
    const [row] = sql.exec<{ generation: number }>(GENERATION).toArray();
    return row?.generation ?? 0;
  }

  #ensureSchema(): void {
    if (this.#schema) return;
    for (const statement of SCHEMA) this.ctx.storage.sql.exec(statement);
    this.#schema = true;
  }

  #assertUsable(): void {
    if (this.#invalidationFailed) throw new Error("The host state invalidation failed.");
  }

  read(query: HostStateQuery): HostStateSnapshot {
    this.#assertUsable();
    const snapshot = emptySnapshot(this.#generation);
    if (!this.#schema) return snapshot;
    const keys = [
      ...(query.credential ? [CREDENTIAL_KEY] : []),
      ...(query.listing ? [LISTING_KEY] : []),
      ...(query.sessions ?? []).map(sessionKey),
    ];
    if (keys.length === 0) return snapshot;
    const rows = this.ctx.storage.sql
      .exec<{ key: string; value: string; checked_at: number }>(COPIES, JSON.stringify(keys))
      .toArray();
    for (const row of rows) {
      const checkedAt = row.checked_at;
      if (row.key === CREDENTIAL_KEY) snapshot.credential = { value: JSON.parse(row.value), checkedAt };
      else if (row.key === LISTING_KEY) snapshot.listing = { value: JSON.parse(row.value), checkedAt };
      else snapshot.sessions[row.key.slice(SESSION_KEY_PREFIX.length)] = { value: JSON.parse(row.value), checkedAt };
    }
    return snapshot;
  }

  fill(generation: number, staleBefore: number, entries: HostStateFill): boolean {
    this.#assertUsable();
    if (generation !== this.#generation) return false;
    this.#ensureSchema();
    const sql = this.ctx.storage.sql;
    const store = (key: string, copy: HostStateCopy<unknown>) =>
      sql.exec(STORE_COPY, key, JSON.stringify(copy.value), copy.checkedAt);
    this.ctx.storage.transactionSync(() => {
      if (entries.credential) store(CREDENTIAL_KEY, entries.credential);
      if (entries.listing) store(LISTING_KEY, entries.listing);
      for (const session of entries.sessions ?? []) store(sessionKey(session.value.session_id), session);
      sql.exec(PRUNE_STALE, staleBefore);
      if (entries.sessions?.length) sql.exec(PRUNE_SESSIONS, HOST_STATE_SESSION_COPY_LIMIT);
    });
    return true;
  }

  invalidate(): number {
    try {
      this.#ensureSchema();
      const sql = this.ctx.storage.sql;
      const generation = this.ctx.storage.transactionSync(() => {
        const [row] = sql.exec<{ generation: number }>(INVALIDATE).toArray();
        sql.exec("DELETE FROM host_copy");
        return row?.generation ?? this.#generation + 1;
      });
      this.#generation = generation;
      this.#invalidationFailed = false;
      return generation;
    } catch (error) {
      this.#invalidationFailed = true;
      throw error;
    }
  }
}
