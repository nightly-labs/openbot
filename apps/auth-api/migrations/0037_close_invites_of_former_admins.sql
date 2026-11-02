-- An invitation admits a user only while its creator is an active owner or admin of the host. The Worker
-- now closes the open invitations of an admin who leaves, is removed or is demoted. This closes the ones
-- from before, so they leave the invitation limits and the list. The Worker that runs before this deploy
-- reads revoked_at and refuses these invitations too.
UPDATE remote_invites SET revoked_at = unixepoch('now') * 1000
 WHERE revoked_at IS NULL AND (used_at IS NULL OR max_uses IS NULL)
   AND NOT EXISTS(
     SELECT 1 FROM remote_memberships
      WHERE host_id = remote_invites.host_id AND user_id = remote_invites.created_by_user_id
        AND status = 'active' AND role IN ('owner', 'admin')
   );
