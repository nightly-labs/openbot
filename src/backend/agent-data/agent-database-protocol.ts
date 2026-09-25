// The wire shape between the main process and the database host child, plus the numbers both sides
// agree on.
//
// This file carries no runtime import at all, which is what lets `agent-database-host.ts` reference
// every shape through `import type` and keep its own runtime imports to `node:*`. See that file for
// why that restriction exists.

/** A value a caller can bind. A blob has no JSON form, so no statement can take one as input. */
export type AgentDatabaseParameter = null | number | string;

/** A value that survives the JSON hop in both directions. A blob is reported by size, not content. */
export type AgentDatabaseValue = AgentDatabaseParameter | { blobBytes: number };

export type AgentDatabaseMode = "read" | "write";

export interface AgentDatabaseLimits {
  maxRows: number;
  maxResultBytes: number;
  maxCellChars: number;
  maxPageCount: number;
  busyTimeoutMs: number;
}

export interface AgentDatabaseStatement {
  kind: "statement";
  id: number;
  /** Absolute, and decided by `AgentTables`. The host never resolves a path itself. */
  databasePath: string;
  mode: AgentDatabaseMode;
  /**
   * OpenBot's own setup statement rather than an agent's. Only `AgentTables` sets it, and it means
   * two things: create the file if it is missing, and allow this one statement to write the
   * reserved metadata table. No agent-authored SQL ever reaches a request with this set.
   */
  provision: boolean;
  /**
   * Tables the requesting agent did not create. The authorizer refuses a `DROP` or an `ALTER` that
   * names one of these, which is how "only the agent that made a table may remove it" is enforced
   * where SQLite itself can see the target, rather than by reading the model's SQL.
   */
  protectedTables: string[];
  sql: string;
  parameters: AgentDatabaseParameter[];
  limits: AgentDatabaseLimits;
}

/** Close the handles for one file so the main process can unlink or move it. */
interface AgentDatabaseClose {
  kind: "close";
  id: number;
  databasePath: string;
}

export type AgentDatabaseRequest = AgentDatabaseStatement | AgentDatabaseClose;

/**
 * A request before the supervisor numbers it. Spelled as a union of two `Omit`s rather than
 * `Omit<AgentDatabaseRequest, "id">`, which would collapse the two members into their common keys
 * and lose the discriminant.
 */
export type AgentDatabaseRequestInput = Omit<AgentDatabaseStatement, "id"> | Omit<AgentDatabaseClose, "id">;

export interface AgentDatabaseRows {
  columns: string[];
  rows: AgentDatabaseValue[][];
  /** True when a cap stopped the read before the statement ran out of rows. */
  truncated: boolean;
  changes: number;
  lastInsertRowid: number | null;
}

/**
 * Why a statement did not run. Never an `Error`: its stack quotes absolute paths, and every one of
 * these sentences is read by a model and may be read by the user.
 */
export interface AgentDatabaseFailure {
  kind: "sqlite" | "not-authorized" | "size-limit" | "busy" | "missing" | "internal";
  message: string;
  sqliteCode?: number;
}

export type AgentDatabaseResponse =
  | { id: number; ok: true; result: AgentDatabaseRows }
  | { id: number; ok: false; failure: AgentDatabaseFailure };

/**
 * `maxPageCount` times SQLite's 4 KB default page gives the 256 MB ceiling the shared database may
 * reach. One file holds every agent's tables, so the ceiling is the whole store's. The deadline is
 * what the supervisor arms before it sends a statement; every other number bounds a payload that
 * would otherwise be unbounded because a model chose it.
 */
export const AGENT_DATABASE_LIMITS = {
  maxSqlLength: 20_000,
  maxParameters: 100,
  maxParameterBytes: 1_000_000,
  maxRows: 500,
  maxResultBytes: 256_000,
  maxCellChars: 2_000,
  maxPageCount: 65_536,
  statementDeadlineMs: 5_000,
  queueWaitMs: 20_000,
  busyTimeoutMs: 2_000,
} as const;

/** The reserved table that records which agent created each shared table. */
export const AGENT_DATABASE_METADATA_TABLE = "openbot_metadata";

/**
 * One running database host, seen from the supervisor.
 *
 * The supervisor never spawns anything itself, because how the host is started is not the same
 * answer in every environment. The packaged app ships the `runAsNode: false` fuse, so
 * `process.execPath` cannot be run as Node and the host is an Electron `utilityProcess` that is
 * talked to by message. A test spawns the `.ts` source under a real `node` and talks to it over
 * stdio. This interface is what both of those look like from here.
 */
export interface AgentDatabaseHostProcess {
  send(request: AgentDatabaseRequest): void;
  onResponse(listener: (response: AgentDatabaseResponse) => void): void;
  /** The host ended without being asked to. */
  onExit(listener: () => void): void;
  /** End it now, whatever it is in the middle of. */
  kill(): void;
}
