import type { DatabaseSync } from "node:sqlite";
import { createOpenBotLogger } from "@openbot/logging";
import type { OpenBotMigration } from "./migration";
import { isDynamicRecord, isString } from "./runtime-values";

// The value of `COMPUTER_USE_MCP_SERVER_NAME` in `@openbot/contracts/ipc` when this migration shipped.
const COMPUTER_USE_MCP_SERVER_NAME = "computer_use";

const logger = createOpenBotLogger("openbot-database-schema");

/**
 * Moves a saved MCP server off the name the Computer Use driver now takes.
 *
 * The name was free until the driver arrived, so a database written by a shipped release can hold a
 * server the user named `computer_use`. OpenBot appends its own entry under that name at spawn, and
 * all four providers key servers by name: Codex and Claude would hand the agent OpenBot's server in
 * place of the user's, and an ACP provider would receive two servers with one name. The row is
 * renamed rather than removed, so the user keeps the server, its command and its secrets, and sees
 * the new name where they configured it. A later save cannot take the name back: `mcpConfigErrors`
 * refuses it.
 */
function freeComputerUseServerName(db: DatabaseSync): void {
  const colliding = db
    .prepare("SELECT mcp_server_id, name FROM projection_mcp_servers WHERE lower(name) = ?")
    .all(COMPUTER_USE_MCP_SERVER_NAME);
  if (colliding.length === 0) return;

  const taken = new Set<string>();
  for (const row of db.prepare("SELECT name FROM projection_mcp_servers").all()) {
    if (isDynamicRecord(row) && isString(row.name)) taken.add(row.name.toLowerCase());
  }
  const rename = db.prepare("UPDATE projection_mcp_servers SET name = ? WHERE mcp_server_id = ?");
  for (const row of colliding) {
    if (!isDynamicRecord(row) || !isString(row.mcp_server_id) || !isString(row.name)) continue;
    const name = freeServerName(taken);
    taken.add(name.toLowerCase());
    rename.run(name, row.mcp_server_id);
    logger.warn("Renamed a saved MCP server, because Computer Use now uses its name.", {
      from: row.name,
      to: name,
    });
  }
}

/** The first `computer_use_saved` name the unique index will accept. */
function freeServerName(taken: ReadonlySet<string>): string {
  const base = `${COMPUTER_USE_MCP_SERVER_NAME}_saved`;
  if (!taken.has(base)) return base;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}_${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export const migration: OpenBotMigration = {
  version: 21,
  name: "free-computer-use-server-name",
  // Renames rows only, so no foreign-key pause, no vacuum, and nothing to mirror in the latest
  // schema: a new database has no rows to rename.
  up: freeComputerUseServerName,
};
