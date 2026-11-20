ALTER TABLE remote_memberships ADD COLUMN removed_at INTEGER;

UPDATE remote_memberships SET removed_at = updated_at WHERE status = 'revoked';
