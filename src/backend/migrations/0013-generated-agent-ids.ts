import type { DatabaseSync } from "node:sqlite";
import type { OpenBotMigration } from "./migration";
import { isDynamicRecord, isString } from "./runtime-values";

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function isUuidV4(value: string): boolean {
  return UUID_V4_PATTERN.test(value);
}

function isGeneratedAgentId(agentId: string): boolean {
  const prefix = agentId.startsWith("agent-") ? "agent-" : agentId.startsWith("bot-") ? "bot-" : null;
  return prefix !== null && isUuidV4(agentId.slice(prefix.length));
}

interface AgentIdRename {
  readonly oldId: string;
  readonly newId: string;
  readonly workspacePath: string | null;
}

interface TextColumnTable {
  readonly name: string;
  readonly columns: readonly string[];
}

interface Substitution {
  readonly from: string;
  readonly to: string;
}

const SUBSTITUTION_BATCH = 16;

function rewriteGeneratedAgentIds(db: DatabaseSync): void {
  const renames = readAgentIdRenames(db);
  if (renames.length === 0) return;

  const tables = textColumnTables(db);
  const masks = renames.map((rename, index) => ({ from: seedLiteral(rename.oldId), to: seedSentinel(index) }));
  substituteAll(db, tables, masks);
  substituteAll(db, tables, legacyWorkspaceRoots(renames));
  substituteAll(
    db,
    tables,
    renames.map((rename) => ({ from: rename.oldId, to: rename.newId })),
  );
  substituteAll(
    db,
    tables,
    masks.map((mask) => ({ from: mask.to, to: mask.from })),
  );
}

function seedLiteral(seed: string): string {
  return `"avatarSeed":"${seed}"`;
}

function seedSentinel(index: number): string {
  return String.raw`"avatarSeed":"\u0000openbot-avatar-seed-` + index + String.raw`\u0000"`;
}

function readAgentIdRenames(db: DatabaseSync): readonly AgentIdRename[] {
  const rows = db
    .prepare(
      `SELECT agent_id, json_extract(agent_json, '$.workspacePath') AS workspace_path
       FROM projection_agents
       WHERE agent_id LIKE 'bot-%'`,
    )
    .all();
  const taken = new Set<string>();
  for (const row of db.prepare("SELECT agent_id FROM projection_agents").all()) {
    if (isDynamicRecord(row) && isString(row.agent_id)) taken.add(row.agent_id);
  }
  const renames: AgentIdRename[] = [];
  for (const row of rows) {
    if (!isDynamicRecord(row) || !isString(row.agent_id)) continue;
    if (!isGeneratedAgentId(row.agent_id)) continue;
    const newId = `agent-${row.agent_id.slice("bot-".length)}`;
    if (taken.has(newId)) continue;
    if (containedInAnotherId(row.agent_id, taken)) continue;
    renames.push({
      oldId: row.agent_id,
      newId,
      workspacePath: isString(row.workspace_path) ? row.workspace_path : null,
    });
  }
  return renames;
}

function containedInAnotherId(agentId: string, taken: ReadonlySet<string>): boolean {
  for (const candidate of taken) {
    if (candidate !== agentId && candidate.includes(agentId)) return true;
  }
  return false;
}

function legacyWorkspaceRoots(renames: readonly AgentIdRename[]): readonly { from: string; to: string }[] {
  const roots = new Map<string, { from: string; to: string }>();
  for (const rename of renames) {
    if (rename.workspacePath === null) continue;
    for (const separator of ["/", "\\"]) {
      const root = ["OpenBot", "Bots", ""].join(separator);
      const suffix = `${separator}${root}${rename.oldId}`;
      if (!rename.workspacePath.endsWith(suffix)) continue;
      const from = `${rename.workspacePath.slice(0, -suffix.length)}${separator}${root}`;
      const to = `${from.slice(0, -`Bots${separator}`.length)}Agents${separator}`;
      for (const [rawFrom, rawTo] of [
        [from, to],
        [jsonEscape(from), jsonEscape(to)],
      ] as const) {
        roots.set(rawFrom, { from: rawFrom, to: rawTo });
      }
    }
  }
  return [...roots.values()];
}

function jsonEscape(value: string): string {
  return JSON.stringify(value).slice(1, -1);
}

function isPreservedText(table: string, column: string): boolean {
  return table === "projection_agent_memories" && (column === "text" || column === "normalized_text");
}

function textColumnTables(db: DatabaseSync): readonly TextColumnTable[] {
  const tables: TextColumnTable[] = [];
  for (const table of db
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != 'schema_migrations'`,
    )
    .all()) {
    if (!isDynamicRecord(table) || !isString(table.name)) continue;
    const columns: string[] = [];
    for (const column of db.prepare(`PRAGMA table_info(${quoteSqlIdentifier(table.name)})`).all()) {
      if (!isDynamicRecord(column) || !isString(column.name) || !isString(column.type)) continue;
      if (column.type.toUpperCase() !== "TEXT") continue;
      if (isPreservedText(table.name, column.name)) continue;
      columns.push(column.name);
    }
    if (columns.length > 0) tables.push({ name: table.name, columns });
  }
  return tables;
}

function substituteAll(
  db: DatabaseSync,
  tables: readonly TextColumnTable[],
  substitutions: readonly Substitution[],
): void {
  for (let offset = 0; offset < substitutions.length; offset += SUBSTITUTION_BATCH) {
    const batch = substitutions.slice(offset, offset + SUBSTITUTION_BATCH);
    for (const table of tables) {
      const parameters: string[] = [];
      const assignments: string[] = [];
      for (const column of table.columns) {
        let expression = quoteSqlIdentifier(column);
        for (const { from, to } of batch) {
          expression = `replace(${expression}, ?, ?)`;
          parameters.push(from, to);
        }
        assignments.push(`${quoteSqlIdentifier(column)} = ${expression}`);
      }
      const matches: string[] = [];
      for (const column of table.columns) {
        for (const { from } of batch) {
          matches.push(`${quoteSqlIdentifier(column)} LIKE ? ESCAPE '\\'`);
          parameters.push(likePattern(from));
        }
      }
      db.prepare(
        `UPDATE OR REPLACE ${quoteSqlIdentifier(table.name)} SET ${assignments.join(", ")} WHERE ${matches.join(" OR ")}`,
      ).run(...parameters);
    }
  }
}

function likePattern(search: string): string {
  return `%${search.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
}

function quoteSqlIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

export const migration: OpenBotMigration = {
  version: 13,
  name: "generated-agent-ids",
  disableForeignKeys: true,
  vacuumAfterCommit: true,
  up: rewriteGeneratedAgentIds,
};
