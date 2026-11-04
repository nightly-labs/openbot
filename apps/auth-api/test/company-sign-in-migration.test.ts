import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migratedDatabase, migration } from "./sqlite-d1";

const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function before(): DatabaseSync {
  const database = migratedDatabase("0046_remote_session_indexes.sql");
  databases.push(database);
  database.exec(`
    INSERT INTO users(id, identity_key, email, name, avatar_url, created_at, updated_at)
      VALUES ('owner', 'email:owner@example.com', 'owner@example.com', 'Ada', NULL, 1, 2),
             ('member', 'email:member@example.com', 'member@example.com', NULL, NULL, 3, 4);
    INSERT INTO auth_sessions(id, user_id, token_hash, expires_at, created_at, last_used_at)
      VALUES ('session', 'member', 'hash', 9, 5, 6);
    INSERT INTO remote_hosts(host_id, owner_user_id, name, created_at, updated_at)
      VALUES ('host', 'owner', 'Office', 7, 8);
  `);
  return database;
}

const SNAPSHOT = [
  "SELECT id, identity_key, email, name, created_at, updated_at FROM users ORDER BY id",
  "SELECT id, user_id, token_hash, expires_at, created_at, last_used_at, revoked_at FROM auth_sessions ORDER BY id",
  "SELECT host_id, owner_user_id, name, created_at, updated_at FROM remote_hosts ORDER BY host_id",
];

describe("company sign-in migration", () => {
  it("keeps every account, session and server", () => {
    const database = before();
    const earlier = SNAPSHOT.map((query) => database.prepare(query).all());
    database.exec(migration("0047_company_sign_in.sql"));
    expect(SNAPSHOT.map((query) => database.prepare(query).all())).toEqual(earlier);
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(database.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  });

  it("accepts the writes of the Worker that runs before the deploy", () => {
    const database = before();
    database.exec(migration("0047_company_sign_in.sql"));
    // The deployed Worker knows no company sign-in table. Its sign-in, revoke and server writes stay valid.
    database.exec(`
      INSERT INTO users(id, identity_key, email, name, avatar_url, created_at, updated_at)
        VALUES ('new', 'email:new@example.com', 'new@example.com', NULL, NULL, 10, 10);
      INSERT INTO auth_sessions(id, user_id, token_hash, expires_at, created_at, last_used_at)
        VALUES ('new-session', 'new', 'new-hash', 99, 10, 10);
      UPDATE auth_sessions SET revoked_at = 11 WHERE id = 'session';
      INSERT INTO remote_hosts(host_id, owner_user_id, name, created_at, updated_at)
        VALUES ('second', 'new', 'Home', 12, 12);
    `);
    expect(database.prepare("SELECT count(*) AS count FROM auth_sessions").get()).toEqual({ count: 2 });
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("gives a domain to one server only, and removes the connection with its server", () => {
    const database = before();
    database.exec(migration("0047_company_sign_in.sql"));
    database.exec(`
      INSERT INTO remote_hosts(host_id, owner_user_id, name, created_at, updated_at)
        VALUES ('other', 'member', 'Other', 1, 1);
      INSERT INTO company_sign_in_connections(
        host_id, issuer, client_id, client_secret_ciphertext, updated_by_user_id, tested_at, created_at, updated_at
      ) VALUES ('host', 'https://login.example.com', 'client', 'v1.a.b', 'owner', 1, 1, 1),
               ('other', 'https://login.example.org', 'client', 'v1.a.b', 'member', 1, 1, 1);
      INSERT INTO company_sign_in_domains(domain, host_id) VALUES ('example.com', 'host');
      INSERT INTO company_sign_in_users(host_id, user_id, active, updated_at) VALUES ('host', 'member', 0, 1);
    `);
    expect(database.prepare("SELECT enabled FROM company_sign_in_connections WHERE host_id = 'host'").get()).toEqual({
      enabled: 0,
    });
    expect(() =>
      database.exec("INSERT INTO company_sign_in_domains(domain, host_id) VALUES ('example.com', 'other')"),
    ).toThrow(/UNIQUE constraint failed/);
    expect(() => database.exec("UPDATE company_sign_in_connections SET enabled = 2 WHERE host_id = 'host'")).toThrow(
      /CHECK constraint failed/,
    );
    expect(() =>
      database.exec(`INSERT INTO company_sign_in_flows(
        state_hash, purpose, host_id, issuer, client_id, client_secret_ciphertext, domains_json, verifier, nonce,
        return_to, client_state, client_challenge, created_at, expires_at
      ) VALUES ('s', 'other', 'host', 'i', 'c', 'x', '[]', 'v', 'n', 'r', 'cs', '', 1, 2)`),
    ).toThrow(/CHECK constraint failed/);

    database.exec("DELETE FROM remote_hosts WHERE host_id = 'host'");
    for (const table of ["company_sign_in_connections", "company_sign_in_domains", "company_sign_in_users"]) {
      expect(database.prepare(`SELECT count(*) AS count FROM ${table} WHERE host_id = 'host'`).get()).toEqual({
        count: 0,
      });
    }
    expect(database.prepare("SELECT count(*) AS count FROM users").get()).toEqual({ count: 2 });
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
});
