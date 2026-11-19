import type { DatabaseSync } from "node:sqlite";
import { createOpenBotLogger } from "@openbot/logging";
import type { OpenBotMigration } from "./migration";
import { isDynamicRecord, isString } from "./runtime-values";

const COMPUTER_USE_MCP_SERVER_NAME = "computer_use";

const logger = createOpenBotLogger("openbot-database-schema");

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
  up: freeComputerUseServerName,
};
