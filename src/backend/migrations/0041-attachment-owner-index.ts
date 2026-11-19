import type { OpenBotMigration } from "./migration";

// Migration 41 indexes attachments by owner. Each conversation write deletes the attachments of each
// changed message by owner, which without it is a scan of every attachment (#2241). Frozen with the migration.
export const V41_ATTACHMENT_OWNER_INDEX_SQL = `
  CREATE INDEX IF NOT EXISTS attachments_owner ON projection_attachments(owner_kind, owner_id);
`;

export const migration: OpenBotMigration = {
  version: 41,
  name: "attachment-owner-index",
  // Only creates an index, so no foreign-key pause and no vacuum.
  up: (db) => db.exec(V41_ATTACHMENT_OWNER_INDEX_SQL),
};
