import { DurableObject } from "cloudflare:workers";
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

export interface HostStateEntry {
  credential: HostStateCredential | null;
  checkedAt: number | null;
  generation: number;
}

const SCHEMA =
  "CREATE TABLE IF NOT EXISTS host_state (slot INTEGER PRIMARY KEY CHECK (slot = 1), generation INTEGER NOT NULL)";

const SCHEMA_EXISTS = "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'host_state'";

const GENERATION = "SELECT generation FROM host_state WHERE slot = 1";

const INVALIDATE = `INSERT INTO host_state(slot, generation) VALUES (1, 1)
ON CONFLICT(slot) DO UPDATE SET generation = host_state.generation + 1
RETURNING generation`;

export class HostState extends DurableObject<WorkerBindings> {
  #generation: number;
  #checked: { credential: HostStateCredential; checkedAt: number } | null = null;

  constructor(ctx: DurableObjectState, env: WorkerBindings) {
    super(ctx, env);
    this.#generation = HostState.#storedGeneration(ctx.storage.sql);
  }

  static #storedGeneration(sql: SqlStorage): number {
    if (sql.exec(SCHEMA_EXISTS).toArray().length === 0) return 0;
    const [row] = sql.exec<{ generation: number }>(GENERATION).toArray();
    return row?.generation ?? 0;
  }

  read(): HostStateEntry {
    return {
      credential: this.#checked?.credential ?? null,
      checkedAt: this.#checked?.checkedAt ?? null,
      generation: this.#generation,
    };
  }

  fill(credential: HostStateCredential, checkedAt: number, generation: number): boolean {
    if (generation !== this.#generation) return false;
    this.#checked = { credential, checkedAt };
    return true;
  }

  invalidate(): number {
    this.ctx.storage.sql.exec(SCHEMA);
    const [row] = this.ctx.storage.sql.exec<{ generation: number }>(INVALIDATE).toArray();
    this.#generation = row?.generation ?? this.#generation + 1;
    this.#checked = null;
    return this.#generation;
  }
}
