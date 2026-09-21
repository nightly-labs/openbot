-- Permanent invitation links: reusable, never expiring, revoked explicitly.
--
-- Backward compatibility with the deployed Worker during the migration/deploy gap:
-- both columns are additive. `max_uses` is nullable with a default of 1, so existing
-- rows and INSERTs from a Worker that does not know the column read as single-use.
-- NULL means unlimited. `use_count` fills 0 for existing rows. The deployed Worker
-- keeps writing expiring single-use invitations; expiry stays NOT NULL with the
-- finite 8_640_000_000_000_000 sentinel (as in 0017) marking "never expires".
ALTER TABLE remote_invites ADD COLUMN max_uses INTEGER DEFAULT 1;
ALTER TABLE remote_invites ADD COLUMN use_count INTEGER NOT NULL DEFAULT 0;
