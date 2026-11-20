import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

describe("remote control plane migration", () => {
  it("keeps each tunnel owner and does not import other members", () => {
    const database = new DatabaseSync(":memory:");
    database.exec("PRAGMA foreign_keys = ON");
    database.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY);
      CREATE TABLE auth_sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        expires_at INTEGER NOT NULL,
        revoked_at INTEGER
      );
      CREATE TABLE team_tunnels (
        server_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        tunnel_id TEXT,
        tunnel_name TEXT NOT NULL,
        api_hostname TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        machine_token_hash TEXT
      );
      INSERT INTO users(id) VALUES ('owner'), ('former-member');
      INSERT INTO team_tunnels(
        server_id, user_id, tunnel_name, api_hostname, status, created_at, updated_at, machine_token_hash
      ) VALUES ('host-1', 'owner', 'Studio Mac', 'old.example.test', 'active', 100, 200, '${"a".repeat(64)}');
    `);

    database.exec(readFileSync(new URL("../migrations/0012_remote_control_plane.sql", import.meta.url), "utf8"));
    database.exec(readFileSync(new URL("../migrations/0013_remote_session_lifecycle.sql", import.meta.url), "utf8"));
    database.exec(readFileSync(new URL("../migrations/0020_permanent_invites.sql", import.meta.url), "utf8"));

    expect(database.prepare("SELECT host_id, owner_user_id, auth_epoch FROM remote_hosts").all()).toEqual([
      { host_id: "host-1", owner_user_id: "owner", auth_epoch: 1 },
    ]);
    expect(database.prepare("SELECT membership_id, user_id, role, status FROM remote_memberships").all()).toEqual([
      { membership_id: "host-1:owner", user_id: "owner", role: "owner", status: "active" },
    ]);
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(database.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  });

  it("stays single-use for invitations written before the permanent-links migration", () => {
    const database = new DatabaseSync(":memory:");
    try {
      database.exec("PRAGMA foreign_keys = ON");
      database.exec(`
        CREATE TABLE users (id TEXT PRIMARY KEY);
        CREATE TABLE team_tunnels (
          server_id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id),
          tunnel_id TEXT,
          tunnel_name TEXT NOT NULL,
          api_hostname TEXT NOT NULL,
          status TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          machine_token_hash TEXT
        );
        INSERT INTO users(id) VALUES ('owner');
        INSERT INTO team_tunnels(
          server_id, user_id, tunnel_name, api_hostname, status, created_at, updated_at, machine_token_hash
        ) VALUES ('host-1', 'owner', 'Studio Mac', 'old.example.test', 'active', 100, 200, 'machine-hash');
      `);
      database.exec(readFileSync(new URL("../migrations/0012_remote_control_plane.sql", import.meta.url), "utf8"));
      database.exec(readFileSync(new URL("../migrations/0013_remote_session_lifecycle.sql", import.meta.url), "utf8"));
      database
        .prepare(
          `INSERT INTO remote_invites(
            invite_id, host_id, token_hash, email, role, created_by_user_id, expires_at, created_at
          ) VALUES ('legacy', 'host-1', 'legacy-hash', NULL, 'member', 'owner', 999999999, 1)`,
        )
        .run();
      database.exec(readFileSync(new URL("../migrations/0020_permanent_invites.sql", import.meta.url), "utf8"));
      database
        .prepare(
          `INSERT INTO remote_invites(
            invite_id, host_id, token_hash, email, role, created_by_user_id, expires_at, created_at
          ) VALUES ('deployed-gap', 'host-1', 'gap-hash', NULL, 'member', 'owner', 999999999, 2)`,
        )
        .run();
      expect(database.prepare("SELECT max_uses, use_count FROM remote_invites ORDER BY invite_id").all()).toEqual([
        { max_uses: 1, use_count: 0 },
        { max_uses: 1, use_count: 0 },
      ]);
    } finally {
      database.close();
    }
  });
});
