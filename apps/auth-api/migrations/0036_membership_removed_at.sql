-- The time an owner or admin removed the member, 0 when the member left, and NULL for an active member.
-- An invitation from before a removal cannot bring the member back. A revoked membership from before
-- this migration does not record who revoked it, so it counts as a removal. The Worker that runs before
-- this deploy does not read the column. A revoked row that it writes keeps NULL, and the new Worker
-- counts that row as a removal at its updated_at.
ALTER TABLE remote_memberships ADD COLUMN removed_at INTEGER;

UPDATE remote_memberships SET removed_at = updated_at WHERE status = 'revoked';
