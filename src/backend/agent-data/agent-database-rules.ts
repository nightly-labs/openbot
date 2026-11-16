// What a single statement may be, decided from strings alone.
//
// Nothing here is the security boundary. A read runs on a `readOnly: true` connection and SQLite's
// own authorizer refuses `ATTACH`, `PRAGMA` and the rest whatever this file concludes -- see
// `agent-database-host.ts`. This layer exists so a model reads "PRAGMA is not available, use
// list_tables" instead of "not authorized", and so the one thing the authorizer cannot see
// -- a second statement that `prepare()` silently discards -- is rejected before it is sent.

import { AGENT_DATABASE_LIMITS, type AgentDatabaseMode, type AgentDatabaseParameter } from "./agent-database-protocol";

export type AgentDatabaseCheck<T> = { ok: true; value: T } | { ok: false; message: string };

interface ScannedStatement {
  /** Bare words outside every string, comment and parenthesis, lowercased. */
  words: string[];
  /** More than whitespace or a comment after the `;` that ends the first statement. */
  hasTrailingStatement: boolean;
  /** An unterminated string, identifier or block comment. */
  unterminated: boolean;
}

// Where a statement ends, as SQLite's own `sqlite3_complete` decides it (`src/complete.c`, public
// domain). Only `CREATE [TEMP] TRIGGER` has a `;` inside its one statement: its body ends at
// `; END`, and the statement at the next `;`. A `CASE ... END` holds no `;`, so it needs no count.
// Token numbers are the columns of `TRANSITIONS`. Whitespace and comments are skipped before the
// table, so its WS column (1) is never read; it stays so the table matches SQLite's.
const SEMI = 0;
const OTHER = 2;
const EXPLAIN = 3;
const CREATE = 4;
const TEMP = 5;
const TRIGGER = 6;
const END = 7;
const KEYWORD_TOKENS: Record<string, number> = {
  explain: EXPLAIN,
  create: CREATE,
  temp: TEMP,
  temporary: TEMP,
  trigger: TRIGGER,
  end: END,
};
/** The state between two statements. Every `;` that ends a statement leads here. */
const START = 1;
// Rows are states, columns are tokens: SEMI, WS, OTHER, EXPLAIN, CREATE, TEMP, TRIGGER, END.
const TRANSITIONS: readonly (readonly number[])[] = [
  [1, 0, 2, 3, 4, 2, 2, 2], // nothing yet
  [1, 1, 2, 3, 4, 2, 2, 2], // START
  [1, 2, 2, 2, 2, 2, 2, 2], // a statement that the next `;` ends
  [1, 3, 3, 2, 4, 2, 2, 2], // after EXPLAIN
  [1, 4, 2, 2, 2, 4, 5, 2], // after CREATE [TEMP]
  [6, 5, 5, 5, 5, 5, 5, 5], // in a trigger
  [6, 6, 5, 5, 5, 5, 5, 7], // a `;` in a trigger
  [1, 7, 5, 5, 5, 5, 5, 5], // `; END` in a trigger
];

function scanStatement(sql: string): ScannedStatement {
  const words: string[] = [];
  let depth = 0;
  let index = 0;
  let state = 0;
  let ended = false;
  let hasTrailingStatement = false;
  // Anything but another `;` after the end of the first statement is a second statement, which
  // `prepare()` would discard.
  const see = (token: number) => {
    if (ended && token !== SEMI) hasTrailingStatement = true;
    state = TRANSITIONS[state]?.[token] ?? state;
    if (state === START) ended = true;
  };

  while (index < sql.length) {
    const character = sql[index];

    if (character === "-" && sql[index + 1] === "-") {
      const newline = sql.indexOf("\n", index);
      index = newline === -1 ? sql.length : newline + 1;
      continue;
    }
    if (character === "/" && sql[index + 1] === "*") {
      const end = sql.indexOf("*/", index + 2);
      if (end === -1) return { words, hasTrailingStatement, unterminated: true };
      index = end + 2;
      continue;
    }
    // `x'…'` is a blob literal; the `x` must not also be read as a keyword.
    if ((character === "x" || character === "X") && sql[index + 1] === "'") {
      const end = sql.indexOf("'", index + 2);
      if (end === -1) return { words, hasTrailingStatement, unterminated: true };
      see(OTHER);
      index = end + 1;
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      index += 1;
      for (;;) {
        const end = sql.indexOf(character, index);
        if (end === -1) return { words, hasTrailingStatement, unterminated: true };
        // A doubled quote is an escaped one, not the end of the literal.
        if (sql[end + 1] === character) {
          index = end + 2;
          continue;
        }
        index = end + 1;
        break;
      }
      see(OTHER);
      continue;
    }
    if (character === "[") {
      const end = sql.indexOf("]", index + 1);
      if (end === -1) return { words, hasTrailingStatement, unterminated: true };
      see(OTHER);
      index = end + 1;
      continue;
    }
    if (character === "(") {
      see(OTHER);
      depth += 1;
      index += 1;
      continue;
    }
    if (character === ")") {
      see(OTHER);
      depth = Math.max(0, depth - 1);
      index += 1;
      continue;
    }
    if (character === ";") {
      see(SEMI);
      index += 1;
      continue;
    }
    // As in SQLite, every character above ASCII is an identifier character, so that a part of a
    // non-ASCII name is never read as END or TRIGGER.
    if (character !== undefined && /[A-Za-z_\u0080-\uffff]/.test(character)) {
      let end = index;
      while (end < sql.length && /[A-Za-z0-9_$\u0080-\uffff]/.test(sql.charAt(end))) end += 1;
      const word = sql.slice(index, end).toLowerCase();
      see(KEYWORD_TOKENS[word] ?? OTHER);
      if (depth === 0) words.push(word);
      index = end;
      continue;
    }
    if (character !== undefined && !/\s/.test(character)) see(OTHER);
    index += 1;
  }

  return { words, hasTrailingStatement, unterminated: false };
}

const READ_KEYWORDS = new Set(["select", "values", "explain"]);
const WRITE_KEYWORDS = new Set(["insert", "replace", "update", "delete", "create", "alter", "drop"]);
// What a `WITH` clause can end in. Searched at parenthesis depth zero so a CTE body's own `SELECT`
// does not answer for the statement that follows it.
const WITH_TARGETS = new Set(["select", "values", "insert", "replace", "update", "delete"]);

const REFUSALS: Record<string, string> = {
  attach: "ATTACH is not available. Every table is already in the one shared database.",
  detach: "DETACH is not available.",
  vacuum: "VACUUM is not available.",
  pragma: "PRAGMA is not available. Use list_tables to read the schema of a table.",
  analyze: "ANALYZE is not available.",
  reindex: "REINDEX is not available.",
  begin: "Each call runs one statement in its own transaction.",
  commit: "Each call runs one statement in its own transaction.",
  end: "Each call runs one statement in its own transaction.",
  rollback: "Each call runs one statement in its own transaction.",
  savepoint: "Each call runs one statement in its own transaction.",
  release: "Each call runs one statement in its own transaction.",
};

/**
 * One statement of the kind this tool runs, or the reason it is not.
 *
 * The keyword is read at parenthesis depth zero from the same scan that finds a trailing statement,
 * so a leading comment cannot hide it and `WITH x AS (SELECT 1) DELETE FROM t` is a write rather
 * than the read its first inner keyword suggests.
 */
export function checkAgentSql(sql: string, mode: AgentDatabaseMode): AgentDatabaseCheck<string> {
  if (sql.trim().length === 0) return { ok: false, message: "Send a SQL statement." };
  if (sql.length > AGENT_DATABASE_LIMITS.maxSqlLength) {
    return { ok: false, message: `A statement may be at most ${AGENT_DATABASE_LIMITS.maxSqlLength} characters.` };
  }

  const scanned = scanStatement(sql);
  if (scanned.unterminated) {
    return { ok: false, message: "This statement has an unterminated string, identifier, or comment." };
  }
  if (scanned.hasTrailingStatement) {
    return {
      ok: false,
      message: "Send one SQL statement per call. Everything after the first statement would be ignored.",
    };
  }

  const first = scanned.words[0];
  if (first === undefined) return { ok: false, message: "Send a SQL statement." };

  const refusal = REFUSALS[first];
  if (refusal) return { ok: false, message: refusal };

  const effective = first === "with" ? scanned.words.slice(1).find((word) => WITH_TARGETS.has(word)) : first;
  if (effective === undefined) {
    return { ok: false, message: "A WITH clause must end in SELECT, INSERT, UPDATE, or DELETE." };
  }

  if (mode === "read") {
    if (READ_KEYWORDS.has(effective)) return { ok: true, value: sql };
    if (WRITE_KEYWORDS.has(effective)) {
      return { ok: false, message: `Use execute_data for ${effective.toUpperCase()}. query_data only reads.` };
    }
    return { ok: false, message: `${effective.toUpperCase()} is not available. query_data runs SELECT.` };
  }

  if (WRITE_KEYWORDS.has(effective)) return { ok: true, value: sql };
  if (READ_KEYWORDS.has(effective)) {
    return { ok: false, message: "Use query_data to read rows. execute_data changes data." };
  }
  return { ok: false, message: `${effective.toUpperCase()} is not available.` };
}

/** How a write statement changes the schema, or `null` when it only changes rows. */
export type AgentSchemaChange = "create" | "drop" | "alter";

/**
 * Whether a write statement changes the schema rather than rows.
 *
 * `AgentTables` reads the owner record only around such a statement, so an ordinary `INSERT` does
 * not pay for a table listing. The same scan answers this as answers `checkAgentSql`, so a leading
 * comment cannot hide the keyword here either.
 */
export function schemaChange(sql: string): AgentSchemaChange | null {
  const first = scanStatement(sql).words[0];
  if (first === "create" || first === "drop" || first === "alter") return first;
  return null;
}

/**
 * The `?` placeholder values, or the reason they are not usable.
 *
 * Booleans become 1 and 0 here rather than at the binding, because SQLite has no boolean type and
 * the conversion should be one the caller can read in the rejection message when it goes wrong.
 */
export function checkAgentParameters(value: unknown): AgentDatabaseCheck<AgentDatabaseParameter[]> {
  if (value === undefined || value === null) return { ok: true, value: [] };
  if (!Array.isArray(value)) {
    return { ok: false, message: "params must be an array of values, one for each ? placeholder in order." };
  }
  if (value.length > AGENT_DATABASE_LIMITS.maxParameters) {
    return { ok: false, message: `A statement may take at most ${AGENT_DATABASE_LIMITS.maxParameters} parameters.` };
  }

  const parameters: AgentDatabaseParameter[] = [];
  let bytes = 0;
  for (const entry of value) {
    if (entry === null) {
      parameters.push(null);
      continue;
    }
    if (typeof entry === "boolean") {
      parameters.push(entry ? 1 : 0);
      continue;
    }
    if (typeof entry === "number") {
      if (!Number.isFinite(entry)) return { ok: false, message: "A number parameter must be finite." };
      parameters.push(entry);
      continue;
    }
    if (typeof entry === "string") {
      bytes += entry.length;
      parameters.push(entry);
      continue;
    }
    return { ok: false, message: "Parameters must be text, numbers, booleans, or null." };
  }
  if (bytes > AGENT_DATABASE_LIMITS.maxParameterBytes) {
    return { ok: false, message: "The parameters together are too large. Write fewer rows per call." };
  }
  return { ok: true, value: parameters };
}
