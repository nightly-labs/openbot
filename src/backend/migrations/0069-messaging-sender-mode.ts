import type { DatabaseSync } from "node:sqlite";
import type { OpenBotMigration } from "./migration";
import { isDynamicRecord, isString } from "./runtime-values";

export const V69_MESSAGING_SENDER_MODE_COLUMN_SQL =
  "mode TEXT NOT NULL DEFAULT 'reply' CHECK(mode IN ('reply', 'read'))";

function addSenderMode(db: DatabaseSync): void {
  const existing = db
    .prepare("PRAGMA table_info(projection_messaging_allowed_senders)")
    .all()
    .some((column) => isDynamicRecord(column) && isString(column.name) && column.name === "mode");
  if (!existing)
    db.exec(`ALTER TABLE projection_messaging_allowed_senders ADD COLUMN ${V69_MESSAGING_SENDER_MODE_COLUMN_SQL}`);
}

export const migration: OpenBotMigration = {
  version: 69,
  name: "messaging-sender-mode",
  up: addSenderMode,
};
