UPDATE remote_invites SET revoked_at = unixepoch('now') * 1000
 WHERE revoked_at IS NULL AND (used_at IS NULL OR max_uses IS NULL)
   AND NOT EXISTS(
     SELECT 1 FROM remote_memberships
      WHERE host_id = remote_invites.host_id AND user_id = remote_invites.created_by_user_id
        AND status = 'active' AND role IN ('owner', 'admin')
   );
