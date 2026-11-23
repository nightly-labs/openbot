export type AgentDatabaseParameter = null | number | string;

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
  databasePath: string;
  mode: AgentDatabaseMode;
  provision: boolean;
  protectedTables: string[];
  sql: string;
  parameters: AgentDatabaseParameter[];
  limits: AgentDatabaseLimits;
}

interface AgentDatabaseClose {
  kind: "close";
  id: number;
  databasePath: string;
}

interface AgentDatabaseIntegrityCheck {
  kind: "integrity-check";
  id: number;
  databasePath: string;
}

export type AgentDatabaseRequest = AgentDatabaseStatement | AgentDatabaseClose | AgentDatabaseIntegrityCheck;

export type AgentDatabaseRequestInput = Omit<AgentDatabaseStatement, "id"> | Omit<AgentDatabaseClose, "id">;

export interface AgentDatabaseRows {
  columns: string[];
  rows: AgentDatabaseValue[][];
  truncated: boolean;
  changes: number;
  lastInsertRowid: number | null;
}

export interface AgentDatabaseFailure {
  kind: "sqlite" | "not-authorized" | "size-limit" | "busy" | "missing" | "newer-schema" | "internal";
  message: string;
  sqliteCode?: number | undefined;
}

export type AgentDatabaseResponse =
  | { id: number; ok: true; result: AgentDatabaseRows }
  | { id: number; ok: false; failure: AgentDatabaseFailure };

export interface AgentDatabaseHostReady {
  kind: "ready";
}

export type AgentDatabaseHostMessage = AgentDatabaseResponse | AgentDatabaseHostReady;

export const AGENT_DATABASE_LIMITS = {
  maxSqlLength: 20_000,
  maxParameters: 100,
  maxParameterBytes: 1_000_000,
  maxRows: 500,
  maxResultBytes: 256_000,
  maxCellChars: 2_000,
  maxPageCount: 65_536,
  statementDeadlineMs: 5_000,
  hostStartDeadlineMs: 15_000,
  hostStartRetryDelayMs: 30_000,
  maxHostStartRetryDelayMs: 300_000,
  queueWaitMs: 20_000,
  busyTimeoutMs: 2_000,
} as const;

export const AGENT_DATABASE_SCHEMA_VERSION = 1;

export const AGENT_DATABASE_METADATA_TABLE = "openbot_metadata";

export interface AgentDatabaseHostProcess {
  send(request: AgentDatabaseRequest): void;
  onMessage(listener: (message: AgentDatabaseHostMessage) => void): void;
  onExit(listener: (code: number | null) => void): void;
  recentOutput?(): string;
  kill(): void;
}
