import type { DatabaseSync } from "node:sqlite";
import { exportJWK, generateKeyPair } from "jose";
import { describe, expect, it, vi } from "vitest";
import { type AccountDeletionDependencies, AccountDeletionError, deleteAccount } from "../src/server/account-deletion";
import { RemoteControlPlane } from "../src/server/remote-control-plane";
import { migratedDatabase, sqliteD1 } from "./sqlite-d1";

const alice = { id: "alice", email: "alice@example.com", name: "Alice", avatarUrl: "/v1/avatars/alice?v=1" };

function memoryBucket(keys: string[]) {
  const objects = new Set(keys);
  const bucket: AccountDeletionDependencies["avatars"] = {
    async list(options) {
      const matches = [...objects].filter((key) => key.startsWith(options.prefix)).sort();
      // One object per page, so the test also covers the cursor.
      const start = options.cursor ? Number(options.cursor) : 0;
      const page = matches.slice(start, start + 1);
      const truncated = start + 1 < matches.length;
      return { objects: page.map((key) => ({ key })), truncated, ...(truncated ? { cursor: String(start + 1) } : {}) };
    },
    async delete(keys) {
      for (const key of keys) objects.delete(key);
    },
  };
  return { bucket, objects };
}

async function setup() {
  const database = migratedDatabase();
  seed(database);
  const pair = await generateKeyPair("ES256", { extractable: true });
  const privateJwk = await exportJWK(pair.privateKey);
  const publicJwk = { ...(await exportJWK(pair.publicKey)), kid: "test-key", use: "sig", alg: "ES256" };
  const DB = sqliteD1(database);
  const remote = new RemoteControlPlane(
    {
      DB,
      REMOTE_TICKET_PRIVATE_JWK: JSON.stringify({ ...privateJwk, kid: "test-key", alg: "ES256" }),
      REMOTE_TICKET_PUBLIC_JWKS: JSON.stringify({ keys: [publicJwk] }),
      REMOTE_TICKET_KEY_ID: "test-key",
    },
    { now: () => 5_000 },
  );
  const avatars = memoryBucket([
    "users/alice/1",
    "users/alice-2/1",
    "remote-hosts/alice-host/logos/1",
    "remote-hosts/bob-host/logos/1",
  ]);
  const skills = memoryBucket([
    "skills/alice-skill/versions/1.zip",
    "skills/alice-skill/versions/2.zip",
    "agent-templates/alice-template/1.avatar",
    "skills/bob-skill/versions/1.zip",
  ]);
  const sites = { delete: vi.fn(async () => undefined) };
  const dependencies = {
    database: DB,
    avatars: avatars.bucket,
    skills: skills.bucket,
    remote,
    sites,
    now: () => 5_000,
    flushAuthEvents: vi.fn(async () => undefined),
  };
  return { database, dependencies, avatars: avatars.objects, skills: skills.objects, sites };
}

function seed(database: DatabaseSync): void {
  database.exec(`
    INSERT INTO users(id, identity_key, email, name, avatar_url, created_at, updated_at) VALUES
      ('alice', 'email:alice@example.com', 'alice@example.com', 'Alice', '/v1/avatars/alice?v=1', 1, 1),
      ('bob', 'email:bob@example.com', 'bob@example.com', 'Bob', NULL, 1, 1);
    INSERT INTO auth_sessions(id, user_id, token_hash, expires_at, created_at, last_used_at) VALUES
      ('alice-desktop', 'alice', 'alice-desktop-hash', 9999999, 1, 1),
      ('alice-phone', 'alice', 'alice-phone-hash', 9999999, 1, 1),
      ('bob-desktop', 'bob', 'bob-desktop-hash', 9999999, 1, 1);
    INSERT INTO mobile_auth_sessions(session_id, user_id, device_id, device_name, platform, created_at)
      VALUES ('alice-phone', 'alice', 'phone', 'iPhone', 'ios', 1);
    INSERT INTO remote_hosts(host_id, owner_user_id, name, created_at, updated_at) VALUES
      ('alice-host', 'alice', 'Alice Mac', 1, 1),
      ('bob-host', 'bob', 'Bob Mac', 1, 1);
    INSERT INTO remote_memberships(membership_id, host_id, user_id, role, status, created_at, updated_at) VALUES
      ('alice-host:alice', 'alice-host', 'alice', 'owner', 'active', 1, 1),
      ('alice-host:bob', 'alice-host', 'bob', 'member', 'active', 1, 1),
      ('bob-host:bob', 'bob-host', 'bob', 'owner', 'active', 1, 1),
      ('bob-host:alice', 'bob-host', 'alice', 'member', 'active', 1, 1);
    INSERT INTO remote_sessions(
      session_id, host_id, user_id, membership_id, started_at, expires_at, auth_session_hash
    ) VALUES ('alice-on-bob', 'bob-host', 'alice', 'bob-host:alice', 1, 9999999, 'alice-phone-hash');
    INSERT INTO remote_invites(invite_id, host_id, token_hash, role, created_by_user_id, expires_at, created_at)
      VALUES ('alice-invite', 'alice-host', 'invite-hash', 'member', 'alice', 9999999, 1);
    INSERT INTO hosted_sites(id, user_id, hostname, title, description, framework, status, created_at, updated_at)
      VALUES ('alice-site', 'alice', 'alice.openbot.site', 'Site', '', 'vanilla', 'active', 1, 1),
             ('bob-site', 'bob', 'bob.openbot.site', 'Site', '', 'vanilla', 'active', 1, 1);
    INSERT INTO site_audit_log(id, user_id, site_id, operation, created_at)
      VALUES ('audit-1', 'alice', 'alice-site', 'create', 1);
    INSERT INTO agent_templates(id, owner_user_id, source_agent_id, snapshot_json, created_at, updated_at)
      VALUES ('alice-template', 'alice', 'agent-1', '{}', 1, 1);
    INSERT INTO marketplace_skills(id, slug, owner_user_id, created_at, updated_at)
      VALUES ('alice-skill', 'alice-skill', 'alice', 1, 1), ('bob-skill', 'bob-skill', 'bob', 1, 1);
    INSERT INTO email_login_challenges(
      id_hash, email, code_hash, source_ip_hash, max_attempts, created_at, expires_at
    ) VALUES ('challenge', 'alice@example.com', 'code', 'ip', 5, 1, 9999999);
  `);
}

/** The rows of each table that point at the user through a foreign key. */
function rowsReferencing(database: DatabaseSync, userId: string): Record<string, number> {
  const keys = database
    .prepare(
      `SELECT m.name AS table_name, f."from" AS column_name
         FROM sqlite_master m JOIN pragma_foreign_key_list(m.name) f
        WHERE m.type = 'table' AND f."table" = 'users'`,
    )
    .all();
  const found: Record<string, number> = {};
  for (const key of keys) {
    const table = String(key.table_name);
    const column = String(key.column_name);
    const count = Number(
      database.prepare(`SELECT count(*) AS count FROM ${table} WHERE ${column} = ?`).get(userId)?.count,
    );
    if (count > 0) found[`${table}.${column}`] = count;
  }
  return found;
}

function events(database: DatabaseSync): unknown[] {
  return database
    .prepare("SELECT payload FROM remote_auth_events ORDER BY rowid")
    .all()
    .map((row) => JSON.parse(String(row.payload)));
}

describe("account deletion", () => {
  it("removes the account and its central data, and keeps the data of other accounts", async () => {
    const { database, dependencies, avatars, skills, sites } = await setup();

    await deleteAccount(dependencies, alice, " Alice@Example.com ");

    expect(database.prepare("SELECT id FROM users").all()).toEqual([{ id: "bob" }]);
    expect(rowsReferencing(database, "alice")).toEqual({});
    expect(sites.delete).toHaveBeenCalledWith(
      { kind: "account", userId: "alice" },
      "alice-site",
      "account-delete:alice-site",
    );
    expect(database.prepare("SELECT user_id FROM site_audit_log").all()).toEqual([{ user_id: null }]);
    expect(database.prepare("SELECT count(*) AS count FROM email_login_challenges").get()).toEqual({ count: 0 });

    // Bob keeps his host, session and skill; he loses only the membership of the deleted host.
    expect(database.prepare("SELECT host_id FROM remote_hosts").all()).toEqual([{ host_id: "bob-host" }]);
    expect(database.prepare("SELECT membership_id FROM remote_memberships").all()).toEqual([
      { membership_id: "bob-host:bob" },
    ]);
    expect(database.prepare("SELECT id, revoked_at FROM auth_sessions").all()).toEqual([
      { id: "bob-desktop", revoked_at: null },
    ]);
    expect(database.prepare("SELECT id FROM marketplace_skills").all()).toEqual([{ id: "bob-skill" }]);
    expect(database.prepare("SELECT id FROM hosted_sites").all()).toEqual([{ id: "bob-site" }]);
    expect([...avatars].sort()).toEqual(["remote-hosts/bob-host/logos/1", "users/alice-2/1"]);
    expect([...skills]).toEqual(["skills/bob-skill/versions/1.zip"]);

    // Signal disconnects Alice's session on Bob's host, Bob's sessions on Alice's host, and her devices.
    expect(events(database)).toEqual(
      expect.arrayContaining([
        { type: "remote-session-ended", hostId: "bob-host", sessionId: "alice-on-bob" },
        expect.objectContaining({ type: "remote-auth-changed", hostId: "bob-host" }),
        expect.objectContaining({ type: "remote-auth-changed", hostId: "alice-host" }),
        { type: "account-servers-changed", userId: "bob" },
        { type: "account-profile-changed", userId: "alice" },
      ]),
    );
    expect(dependencies.flushAuthEvents).toHaveBeenCalled();
  });

  it("keeps an account record with no personal data when the account had a hosted server", async () => {
    const { database, dependencies } = await setup();
    database.exec(`
      INSERT INTO hosted_servers(
        server_id, owner_user_id, name, size, plan, billing_interval, currency, desired_state, observed_state,
        idempotency_key, created_at, updated_at, deleted_at
      ) VALUES ('old-server', 'alice', 'Old', 'default', 'starter', 'month', 'eur', 'deleted', 'deleted', 'k', 1, 1, 2);
      INSERT INTO billing_customers(user_id, stripe_customer_id, created_at, updated_at) VALUES ('alice', 'cus_1', 1, 1);
      INSERT INTO billing_subscriptions(
        stripe_subscription_id, user_id, stripe_customer_id, server_id, plan, interval, currency, status, updated_at
      ) VALUES ('sub_1', 'alice', 'cus_1', 'old-server', 'starter', 'month', 'eur', 'canceled', 2);
    `);

    await deleteAccount(dependencies, alice, "alice@example.com");

    expect(
      database.prepare("SELECT id, identity_key, email, name, avatar_url FROM users WHERE id = 'alice'").get(),
    ).toEqual({
      id: "alice",
      identity_key: "deleted:alice",
      email: "deleted:alice",
      name: null,
      avatar_url: null,
    });
    expect(rowsReferencing(database, "alice")).toEqual({
      "billing_customers.user_id": 1,
      "billing_subscriptions.user_id": 1,
      "hosted_servers.owner_user_id": 1,
    });
  });

  it("refuses a wrong email or a live hosted server and changes nothing", async () => {
    const { database, dependencies } = await setup();
    const before = rowsReferencing(database, "alice");

    await expect(deleteAccount(dependencies, alice, "bob@example.com")).rejects.toMatchObject({
      status: 400,
      code: "account_confirm_mismatch",
    });
    await expect(deleteAccount(dependencies, alice, undefined)).rejects.toBeInstanceOf(AccountDeletionError);

    database.exec(`
      INSERT INTO hosted_servers(
        server_id, owner_user_id, name, size, plan, billing_interval, currency, desired_state, observed_state,
        idempotency_key, created_at, updated_at
      ) VALUES ('live-server', 'alice', 'Live', 'default', 'starter', 'month', 'eur', 'running', 'running', 'k', 1, 1);
    `);
    await expect(deleteAccount(dependencies, alice, "alice@example.com")).rejects.toMatchObject({
      status: 409,
      code: "account_has_hosted_servers",
    });
    expect(rowsReferencing(database, "alice")).toEqual({ ...before, "hosted_servers.owner_user_id": 1 });
    expect(events(database)).toEqual([]);
  });
});
