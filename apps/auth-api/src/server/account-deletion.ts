import { normalizeEmailAddress } from "@openbot/contracts/validation";
import { OPEN_STATUSES_SQL } from "./billing-service";
import type { HostedSiteService } from "./hosted-site-service";
import { authEventStatement, type RemoteControlPlane } from "./remote-control-plane";
import type { AuthUser } from "./types";

export class AccountDeletionError extends Error {
  constructor(
    readonly status: 400 | 409,
    readonly code: "account_confirm_mismatch" | "account_has_hosted_servers",
    message: string,
  ) {
    super(message);
  }
}

/** The R2 calls that the deletion makes. */
interface ObjectStore {
  list(options: { prefix: string; cursor?: string }): Promise<{
    objects: { key: string }[];
    truncated: boolean;
    cursor?: string;
  }>;
  delete(keys: string[]): Promise<void>;
}

export interface AccountDeletionDependencies {
  database: D1Database;
  /** Account avatars and host logos. */
  avatars: ObjectStore;
  /** Marketplace skills and agents, and agent templates. */
  skills: ObjectStore;
  remote: Pick<RemoteControlPlane, "changeMembership" | "deleteHost">;
  sites: Pick<HostedSiteService, "delete">;
  now: () => number;
  /** Sends the queued Signal events. The cron sends them again when this fails. */
  flushAuthEvents: () => Promise<void>;
}

/**
 * Deletes the account and the central data of it. The local data on each OpenBot computer stays.
 *
 * Each step before the last batch can run again, so a failed request can be sent again with the same
 * session. The last batch revokes every session and removes the account in one transaction.
 *
 * A hosted server record has no ON DELETE action: it keeps track of a paid sandbox. An account that
 * had a hosted server keeps its row with no email, name or avatar, and keeps its billing records.
 */
export async function deleteAccount(
  dependencies: AccountDeletionDependencies,
  user: AuthUser,
  confirmEmail: unknown,
): Promise<void> {
  const { database } = dependencies;
  if (typeof confirmEmail !== "string" || normalizeEmailAddress(confirmEmail) !== user.email) {
    throw new AccountDeletionError(400, "account_confirm_mismatch", "Type the account email to delete the account.");
  }
  const blocked = await database
    .prepare(
      `SELECT EXISTS(SELECT 1 FROM hosted_servers WHERE owner_user_id = ? AND desired_state != 'deleted')
           OR EXISTS(SELECT 1 FROM billing_subscriptions WHERE user_id = ? AND status IN ${OPEN_STATUSES_SQL})
           AS blocked`,
    )
    .bind(user.id, user.id)
    .first<{ blocked: number }>();
  if (blocked?.blocked) {
    throw new AccountDeletionError(
      409,
      "account_has_hosted_servers",
      "Delete your hosted servers before you delete the account.",
    );
  }

  // Leaving each team bumps its auth epoch and tells Signal, which a cascade delete does not.
  const memberships = await database
    .prepare(
      `SELECT m.membership_id, m.host_id FROM remote_memberships m
         JOIN remote_hosts h ON h.host_id = m.host_id
        WHERE m.user_id = ? AND m.status = 'active' AND m.role != 'owner' AND h.owner_user_id != ?`,
    )
    .bind(user.id, user.id)
    .all<{ membership_id: string; host_id: string }>();
  for (const membership of memberships.results) {
    await dependencies.remote.changeMembership(user.id, {
      hostId: membership.host_id,
      membershipId: membership.membership_id,
      revoke: true,
    });
  }

  const hosts = await ids(database, "SELECT host_id AS id FROM remote_hosts WHERE owner_user_id = ?", user.id);
  for (const hostId of hosts) await dependencies.remote.deleteHost(user.id, hostId);

  // The service removes the public route and the files of each site.
  const sites = await ids(database, "SELECT id FROM hosted_sites WHERE user_id = ? AND status != 'deleted'", user.id);
  for (const siteId of sites) {
    await dependencies.sites.delete({ kind: "account", userId: user.id }, siteId, `account-delete:${siteId}`);
  }

  const [skills, agents, templates] = await Promise.all([
    ids(database, "SELECT id FROM marketplace_skills WHERE owner_user_id = ?", user.id),
    ids(database, "SELECT id FROM marketplace_agents WHERE owner_user_id = ?", user.id),
    ids(database, "SELECT id FROM agent_templates WHERE owner_user_id = ?", user.id),
  ]);

  const now = dependencies.now();
  const userStatement = (sql: string) => database.prepare(sql).bind(user.id);
  const keepsRecord = "EXISTS(SELECT 1 FROM hosted_servers WHERE owner_user_id = ?)";
  await database.batch([
    // The other devices of the account read their profile again. A phone gets 401 and signs out; a
    // desktop ignores a background 401, the same as for a session revoked on another device.
    authEventStatement(database, { type: "account-profile-changed", userId: user.id }, now),
    // The trigger ends the remote sessions of each credential and tells Signal.
    database
      .prepare("UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL")
      .bind(now, user.id),
    userStatement("DELETE FROM remote_sessions WHERE user_id = ?"),
    userStatement("DELETE FROM remote_memberships WHERE user_id = ?"),
    userStatement("DELETE FROM remote_invites WHERE created_by_user_id = ?"),
    userStatement("DELETE FROM remote_hosts WHERE owner_user_id = ?"),
    userStatement("DELETE FROM slack_workspace_routes WHERE account_id = ?"),
    userStatement("DELETE FROM team_auth_tickets WHERE user_id = ?"),
    userStatement("DELETE FROM team_tunnels WHERE user_id = ?"),
    userStatement("DELETE FROM marketplace_skill_install_receipts WHERE user_id = ?"),
    userStatement("DELETE FROM marketplace_agent_install_receipts WHERE user_id = ?"),
    userStatement("DELETE FROM marketplace_skills WHERE owner_user_id = ?"),
    userStatement("DELETE FROM marketplace_agents WHERE owner_user_id = ?"),
    userStatement("DELETE FROM agent_templates WHERE owner_user_id = ?"),
    userStatement("UPDATE site_audit_log SET user_id = NULL WHERE user_id = ?"),
    userStatement("DELETE FROM site_operation_receipts WHERE user_id = ?"),
    userStatement("DELETE FROM site_creation_events WHERE user_id = ?"),
    userStatement("DELETE FROM site_deployments WHERE user_id = ?"),
    userStatement("DELETE FROM hosted_sites WHERE user_id = ?"),
    userStatement("DELETE FROM mobile_auth_sessions WHERE user_id = ?"),
    userStatement("DELETE FROM auth_sessions WHERE user_id = ?"),
    database.prepare("DELETE FROM email_login_challenges WHERE email = ?").bind(user.email),
    database
      .prepare(
        `UPDATE users SET identity_key = ?, email = ?, name = NULL, avatar_url = NULL, updated_at = ?
          WHERE id = ? AND ${keepsRecord}`,
      )
      .bind(`deleted:${user.id}`, `deleted:${user.id}`, now, user.id, user.id),
    database.prepare(`DELETE FROM users WHERE id = ? AND NOT ${keepsRecord}`).bind(user.id, user.id),
  ]);
  await dependencies.flushAuthEvents().catch(() => undefined);

  // The rows are gone, so no link reads these files. A failed delete leaves an object that nobody can reach.
  await Promise.all([
    deletePrefix(dependencies.avatars, `users/${user.id}/`),
    ...hosts.map((hostId) => deletePrefix(dependencies.avatars, `remote-hosts/${hostId}/`)),
    ...skills.map((id) => deletePrefix(dependencies.skills, `skills/${id}/`)),
    ...agents.map((id) => deletePrefix(dependencies.skills, `agents/${id}/`)),
    ...templates.map((id) => deletePrefix(dependencies.skills, `agent-templates/${id}/`)),
  ]);
}

async function ids(database: D1Database, sql: string, userId: string): Promise<string[]> {
  const rows = await database.prepare(sql).bind(userId).all<{ id: string }>();
  return rows.results.map((row) => row.id);
}

async function deletePrefix(bucket: ObjectStore, prefix: string): Promise<void> {
  try {
    // List all pages first: a delete between pages can move the cursor.
    const keys: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await bucket.list({ prefix, ...(cursor ? { cursor } : {}) });
      keys.push(...page.objects.map((object) => object.key));
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    // R2 deletes up to 1,000 keys in one call.
    for (let start = 0; start < keys.length; start += 1_000) await bucket.delete(keys.slice(start, start + 1_000));
  } catch {
    // Best effort, as for a replaced avatar.
  }
}
