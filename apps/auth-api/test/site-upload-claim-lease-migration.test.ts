import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migratedDatabase, migration } from "./sqlite-d1";

const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

const DEPLOYMENT_COLUMNS =
  "id, site_id, user_id, status, base_deployment_id, file_count, total_bytes, manifest_json, site_title, site_description, site_framework, site_spa_fallback, idempotency_key, request_hash, created_at, upload_expires_at, activated_at, objects_deleted_at, activation_authorized_at, in_flight_uploads, upload_claims, upload_bytes_claimed";

const snapshot = (database: DatabaseSync) => ({
  sites: database.prepare("SELECT * FROM hosted_sites ORDER BY id").all(),
  deployments: database.prepare(`SELECT ${DEPLOYMENT_COLUMNS} FROM site_deployments ORDER BY id`).all(),
  files: database.prepare("SELECT * FROM site_upload_files ORDER BY deployment_id, path").all(),
});

const insertDeploymentAsOldWorker = (database: DatabaseSync, id: string, siteId: string, status: string) =>
  database
    .prepare(
      `INSERT INTO site_deployments(
         id, site_id, user_id, status, base_deployment_id, file_count, total_bytes, manifest_json,
         site_title, site_description, site_framework, site_spa_fallback,
         idempotency_key, request_hash, created_at, upload_expires_at
       ) VALUES (?, ?, 'user-1', ?, NULL, 1, 10, '[]', 'Planner', 'A planner.', 'vanilla', 0, ?, 'hash', 1, 900001)`,
    )
    .run(id, siteId, status, `key-${id}`);

function seeded(): DatabaseSync {
  const database = migratedDatabase("0078_credit_hold_failure_reason.sql");
  databases.push(database);
  database.exec(`
    INSERT INTO users(id, identity_key, email, name, avatar_url, created_at, updated_at)
    VALUES ('user-1', 'email:one@example.test', 'one@example.test', 'One', NULL, 1, 1);
    INSERT INTO hosted_sites(id, user_id, hostname, title, description, framework, spa_fallback, status, created_at, updated_at)
    VALUES ('site-active', 'user-1', 'planner.openbot.site', 'Planner', 'A planner.', 'vanilla', 0, 'active', 1, 1),
           ('site-new', 'user-1', 'notes.openbot.site', 'Notes', 'Notes.', 'vanilla', 0, 'uploading', 1, 1);
  `);
  insertDeploymentAsOldWorker(database, "deployment-live", "site-active", "active");
  insertDeploymentAsOldWorker(database, "deployment-replace", "site-active", "uploading");
  insertDeploymentAsOldWorker(database, "deployment-new", "site-new", "uploading");
  database.exec(`
    UPDATE hosted_sites SET current_deployment_id = 'deployment-live', expires_at = 100 WHERE id = 'site-active';
    UPDATE site_deployments SET base_deployment_id = 'deployment-live', in_flight_uploads = 1, upload_claims = 1,
           upload_bytes_claimed = 10 WHERE id = 'deployment-replace';
    UPDATE site_deployments SET in_flight_uploads = 2, upload_claims = 2, upload_bytes_claimed = 20
    WHERE id = 'deployment-new';
    INSERT INTO site_upload_files(deployment_id, path, size, mime_type, uploaded_at)
    VALUES ('deployment-live', 'index.html', 10, 'text/html', 1);
  `);
  return database;
}

describe("site upload claim lease migration", () => {
  it("keeps every site, deployment and file, gives old claims no time, and accepts the old Worker's writes", () => {
    const database = seeded();
    const before = snapshot(database);

    database.exec("BEGIN");
    database.exec(migration("0079_site_upload_claim_lease.sql"));
    database.exec("COMMIT");

    expect(snapshot(database)).toEqual(before);
    expect(
      database.prepare("SELECT id, in_flight_uploads, last_upload_claim_at FROM site_deployments ORDER BY id").all(),
    ).toEqual([
      { id: "deployment-live", in_flight_uploads: 0, last_upload_claim_at: null },
      { id: "deployment-new", in_flight_uploads: 2, last_upload_claim_at: null },
      { id: "deployment-replace", in_flight_uploads: 1, last_upload_claim_at: null },
    ]);

    insertDeploymentAsOldWorker(database, "deployment-after", "site-active", "uploading");
    database.exec(`
      UPDATE site_deployments SET in_flight_uploads = in_flight_uploads + 1, upload_claims = upload_claims + 1
      WHERE id = 'deployment-after';
      UPDATE site_deployments SET in_flight_uploads = MAX(0, in_flight_uploads - 1) WHERE id = 'deployment-replace';
    `);
    expect(
      database
        .prepare(
          "SELECT id, in_flight_uploads, last_upload_claim_at FROM site_deployments WHERE id IN ('deployment-after', 'deployment-replace') ORDER BY id",
        )
        .all(),
    ).toEqual([
      { id: "deployment-after", in_flight_uploads: 1, last_upload_claim_at: null },
      { id: "deployment-replace", in_flight_uploads: 0, last_upload_claim_at: null },
    ]);
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(database.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  });

  it("rolls back as one unit when a statement fails", () => {
    const database = seeded();
    database.exec("ALTER TABLE site_deployments ADD COLUMN last_upload_claim_at TEXT");
    database.exec("BEGIN");
    expect(() => database.exec(migration("0079_site_upload_claim_lease.sql"))).toThrow();
    database.exec("ROLLBACK");
    expect(
      database
        .prepare("SELECT name, type FROM pragma_table_info('site_deployments') WHERE name = 'last_upload_claim_at'")
        .all(),
    ).toEqual([{ name: "last_upload_claim_at", type: "TEXT" }]);
  });
});
