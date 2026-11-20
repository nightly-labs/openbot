import { AGENT_DATABASE_LIMITS, type AgentDatabaseMode, type AgentDatabaseParameter } from "./agent-database-protocol";

export type AgentDatabaseCheck<T> = { ok: true; value: T } | { ok: false; message: string };

interface ScannedStatement {
  words: string[];
  hasTrailingStatement: boolean;
  unterminated: boolean;
  placeholders: number | null;
}

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
const START = 1;
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
  let placeholders: number | null = 0;
  const see = (token: number) => {
    if (ended && token !== SEMI) hasTrailingStatement = true;
    state = TRANSITIONS[state]?.[token] ?? state;
    if (state === START) ended = true;
  };

  while (index < sql.length) {
    const character = sql[index];

    if (character === "?") {
      if (placeholders !== null) placeholders = /[0-9]/.test(sql.charAt(index + 1)) ? null : placeholders + 1;
      see(OTHER);
      index += 1;
      continue;
    }
    if (character === ":" || character === "@" || character === "$") placeholders = null;

    if (character === "-" && sql[index + 1] === "-") {
      const newline = sql.indexOf("\n", index);
      index = newline === -1 ? sql.length : newline + 1;
      continue;
    }
    if (character === "/" && sql[index + 1] === "*") {
      const end = sql.indexOf("*/", index + 2);
      if (end === -1) return { words, hasTrailingStatement, unterminated: true, placeholders: null };
      index = end + 2;
      continue;
    }
    if ((character === "x" || character === "X") && sql[index + 1] === "'") {
      const end = sql.indexOf("'", index + 2);
      if (end === -1) return { words, hasTrailingStatement, unterminated: true, placeholders: null };
      see(OTHER);
      index = end + 1;
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      index += 1;
      for (;;) {
        const end = sql.indexOf(character, index);
        if (end === -1) return { words, hasTrailingStatement, unterminated: true, placeholders: null };
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
      if (end === -1) return { words, hasTrailingStatement, unterminated: true, placeholders: null };
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

  return { words, hasTrailingStatement, unterminated: false, placeholders };
}

const READ_KEYWORDS = new Set(["select", "values", "explain"]);
const WRITE_KEYWORDS = new Set(["insert", "replace", "update", "delete", "create", "alter", "drop"]);
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

export type AgentSchemaChange = "create" | "drop" | "alter";

export function schemaChange(sql: string): AgentSchemaChange | null {
  const first = scanStatement(sql).words[0];
  if (first === "create" || first === "drop" || first === "alter") return first;
  return null;
}

export function checkAgentParameters(value: unknown, sql: string): AgentDatabaseCheck<AgentDatabaseParameter[]> {
  if (value === undefined || value === null) return matchPlaceholders(sql, []);
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
  return matchPlaceholders(sql, parameters);
}

function matchPlaceholders(
  sql: string,
  parameters: AgentDatabaseParameter[],
): AgentDatabaseCheck<AgentDatabaseParameter[]> {
  const scanned = scanStatement(sql);
  const expected = scanned.unterminated || scanned.hasTrailingStatement ? null : scanned.placeholders;
  if (expected === null || expected === parameters.length) return { ok: true, value: parameters };
  const placeholders = expected === 1 ? "1 ? placeholder" : `${expected} ? placeholders`;
  const values = parameters.length === 1 ? "1 value" : `${parameters.length} values`;
  return {
    ok: false,
    message: `This statement has ${placeholders}, but params has ${values}. Give one value for each ? in order.`,
  };
}
