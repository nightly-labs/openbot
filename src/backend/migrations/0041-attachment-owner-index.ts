import type { OpenBotMigration } from "./migration";

export const V41_ATTACHMENT_OWNER_INDEX_SQL = `
  CREATE INDEX IF NOT EXISTS attachments_owner ON projection_attachments(owner_kind, owner_id);
`;

export const migration: OpenBotMigration = {
  version: 41,
  name: "attachment-owner-index",
  up: (db) => db.exec(V41_ATTACHMENT_OWNER_INDEX_SQL),
};
