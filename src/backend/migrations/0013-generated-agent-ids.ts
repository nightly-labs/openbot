import type { DatabaseSync } from "node:sqlite";
import type { OpenBotMigration } from "./migration";
import { isDynamicRecord, isString } from "./runtime-values";

// A copy of `isGeneratedAgentId` and `isUuidV4` in `@openbot/contracts/validation` as this migration
// shipped. The copy keeps the migration the same when the live check changes.
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

/**
 * How many replacements share one pass over the data.
 *
 * A pass is a full scan of every text column of every table: the search is `%needle%`, which no index
 * answers. One pass per renamed agent is therefore one scan of the user's entire history per agent, and a
 * host may hold a hundred of them. Nesting a batch of replacements into a single expression makes that one
 * scan for the whole batch instead. The bound is what keeps the expression inside SQLite's nesting depth
 * limit -- measured at between 500 and 999 nested `replace` calls on this build, so sixteen leaves the
 * margin an unfamiliar SQLite has to have.
 */
const SUBSTITUTION_BATCH = 16;

// Every persisted `bot-<uuid>` becomes `agent-<uuid>`, in id columns, in derived thread ids, in
// orchestration command and aggregate ids, and inside stored JSON and message text - a historical message
// quoting an id or a workspace path is meant to point at where that agent lives now.
//
// Only id *values* are rewritten. Key spellings stay exactly as the release that wrote them spelled them,
// because `orchestration_events` is replayed to rebuild every projection: a key renamed in a projection
// blob would be undone by the next replay, and a key renamed in the event log would rewrite history that a
// database restored from the user's own file copy still carries either way. Readers accept both spellings
// instead, which is the only thing that also covers that restored database.
function rewriteGeneratedAgentIds(db: DatabaseSync): void {
  const renames = readAgentIdRenames(db);
  if (renames.length === 0) return;

  const tables = textColumnTables(db);
  const masks = renames.map((rename, index) => ({ from: seedLiteral(rename.oldId), to: seedSentinel(index) }));
  // Ordered, and the order is the whole design: seeds out of reach, then the workspace roots, then the ids
  // whose substitution rewrites the leaf those roots left behind, then the seeds back. Within one phase the
  // pairs do not interact -- `readAgentIdRenames` leaves no id a substring of another and a sentinel is
  // unique to its rename -- which is what makes batching them into one pass identical to running them one
  // at a time.
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

/**
 * An agent the app created for itself starts with its own id as `avatarSeed`, and the seed is the input to
 * the function that draws the face -- not an identifier. Rewriting it would give every one of those agents
 * a different face on upgrade, and would diverge from the seed already published in
 * `marketplace_agent_versions`. So the seed is put beyond the substitution's reach first and put back
 * afterwards, everywhere it is stored: the roster projection, and the event payloads a replay would
 * rebuild that projection from.
 *
 * Masking rather than substituting back is what keeps this exact. Only a seed that *was* the old id is
 * restored; a seed that already read `agent-<uuid>` before the migration -- an agent installed from a
 * listing another user published from a renamed build -- is not this migration's doing and is left alone.
 *
 * The sentinel is the six-character escape `\u0000`, not the byte it denotes. Every payload column carries
 * a `json_valid` CHECK that a raw control character would fail mid-migration, and the escape is both valid
 * JSON and something no serializer emits for an identifier, so nothing stored can collide with it.
 */
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
  // Only `projection_agents`, which is where migration v13 shipped. `projection_threads.agent_id`
  // carries no foreign key and `ensureThreadProjection` never deletes, so a thread can outlive the
  // agent row that named it, and such a thread already keyed at `agent-<uuid>` is invisible here: the
  // rename collides with it, the row-level `OR REPLACE` below deletes the orphan, both threads'
  // messages are rewritten onto the one surviving thread id in the same pass, and nothing dangles --
  // so no check objects and the two conversations silently merge. Widening this set would prevent that,
  // but v13 has shipped, and a migration that transforms one database differently from another under
  // the same version number is the larger hazard. `AgentStore` closes the hole from the other side
  // instead: it restores an agent the roster projection lost and gives an unclaimed thread back to the
  // agent that names it at every startup, so the orphan this cannot see stops existing.
  for (const row of db.prepare("SELECT agent_id FROM projection_agents").all()) {
    if (isDynamicRecord(row) && isString(row.agent_id)) taken.add(row.agent_id);
  }
  const renames: AgentIdRename[] = [];
  for (const row of rows) {
    if (!isDynamicRecord(row) || !isString(row.agent_id)) continue;
    // `bot-` alone is not proof the application minted this id. An id a user chose, or one an imported
    // `bots.json` carried, is an ordinary word: renaming `bot-research` to `agent-research` invents a new
    // identity for it, and if `agent-research` already exists the primary-key update collides, the
    // migration throws, `runMigration` rolls back -- and the next launch tries the same thing again, so the
    // user never gets back in. The UUID suffix is what distinguishes the two, so only it is rewritten.
    if (!isGeneratedAgentId(row.agent_id)) continue;
    const newId = `agent-${row.agent_id.slice("bot-".length)}`;
    // A UUID suffix says the id has the shape the application mints; it does not say *this* row came from
    // one. `getOrCreate` takes a caller-supplied id and `bots.json` carried whatever the file held, so a
    // `bot-<uuid>` can be sitting in this table beside an `agent-<uuid>` sharing that UUID. Renaming the
    // first onto the second collides on the primary key, and the substitution below resolves a collision by
    // replacing the row -- so an agent nobody touched would quietly disappear on upgrade. An id whose target
    // is taken is left alone instead: a stale spelling is legible, a deleted agent is not recoverable.
    if (taken.has(newId)) continue;
    // The rename is carried out as a text substitution, so it reaches this id wherever it appears -- and an
    // id the caller chose can *contain* a generated one. `getOrCreate` takes any string, so `bot-<uuid>-copy`
    // is a legal id sitting beside `bot-<uuid>`, and rewriting the token inside it renames a second agent
    // nobody asked about. Should `agent-<uuid>-copy` already exist, the row-level `OR REPLACE` below
    // resolves that collision by deleting it, and two agents become one. A stale spelling is legible; an
    // agent that vanished on upgrade is not recoverable, so an id that is a piece of another id is skipped.
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

// The workspace root moves from `OpenBot/Bots` to `OpenBot/Agents`; the id in the leaf is rewritten by the
// id substitution that follows. The root is only ever substituted with its full absolute prefix attached,
// derived from a path this database actually stored, so a user whose own checkout sits at
// `~/Projects/OpenBot/Bots` does not get their files silently repointed.
function legacyWorkspaceRoots(renames: readonly AgentIdRename[]): readonly { from: string; to: string }[] {
  const roots = new Map<string, { from: string; to: string }>();
  for (const rename of renames) {
    if (rename.workspacePath === null) continue;
    // A Windows profile stores this path with backslashes. Matching only the POSIX form would leave the
    // root behind and rewrite the leaf alone, giving `OpenBot\Bots\agent-<uuid>` -- a name no reader
    // recognizes, since rebasing a path out of a resumed provider transcript looks for an `Agents` parent.
    for (const separator of ["/", "\\"]) {
      const root = ["OpenBot", "Bots", ""].join(separator);
      const suffix = `${separator}${root}${rename.oldId}`;
      if (!rename.workspacePath.endsWith(suffix)) continue;
      const from = `${rename.workspacePath.slice(0, -suffix.length)}${separator}${root}`;
      const to = `${from.slice(0, -`Bots${separator}`.length)}Agents${separator}`;
      // The path is read back through `json_extract`, so it arrives unescaped, while the column it has to
      // be substituted in holds the serialized JSON -- where a Windows separator is doubled. Both forms are
      // rewritten; on POSIX they are the same string and the map collapses them.
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

/**
 * A memory is a sentence the user or the model wrote, and it is the only free text this database indexes:
 * `UNIQUE(agent_id, normalized_text)`. Two memories quoting the id in its two spellings become one sentence
 * once the id is rewritten, and there is no good answer at that point -- aborting locks the user out of a
 * migration that has no backup, and collapsing the pair throws away a record whose origin, source turn and
 * timestamps were its own. So the sentence is left exactly as it was written. The row's identifiers are
 * still rewritten around it, so the memory stays attached to its agent; only the quotation inside it keeps
 * the pre-rename spelling, which is what the user typed anyway.
 */
function isPreservedText(table: string, column: string): boolean {
  return table === "projection_agent_memories" && (column === "text" || column === "normalized_text");
}

/** Every table this migration rewrites, with the TEXT columns of each. */
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

/**
 * One phase of the rewrite, in as few passes over the data as the depth limit allows.
 *
 * One statement per table, rewriting every TEXT column of a row together. Together is the point: a
 * per-column statement lets the conflict resolution below act on one column of a row and not another,
 * leaving a memory whose `text` and `normalized_text` say different things -- and dedupe reads the
 * normalized column, so the divergence outlives the migration.
 */
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
      // `OR REPLACE`, because a whole-database substitution can make two rows equal. Two memories of one
      // agent quoting `bot-<uuid>` and `agent-<uuid>` collapse to the same `normalized_text` under
      // `UNIQUE(agent_id, normalized_text)`, and two deletions queued under the two workspace roots collapse
      // to the same `file_deletion_outbox.path`. Aborting would roll the migration back on every launch and
      // lock the user out over a duplicated sentence; `OR IGNORE` would be worse still, leaving the skipped
      // row's `agent_id` spelling an agent that no longer exists, so the memory survives attached to
      // nobody. Collapsing the pair is what the constraint means and what would have happened had the
      // duplicate been written today.
      //
      // What keeps this from reaching an identifier is `readAgentIdRenames`, which drops a rename whose
      // target id is already taken. That leaves every identifier this rewrites one-to-one, so the only rows
      // it can collapse are the free-text ones. Foreign keys are off for this migration, so a replace here
      // would not cascade -- `runMigration` runs `PRAGMA foreign_key_check` over the result.
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
