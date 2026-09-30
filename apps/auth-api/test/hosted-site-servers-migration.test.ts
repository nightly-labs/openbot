import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migratedDatabase, migration } from "./sqlite-d1";

const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

// The column list of the Worker before `0024`. CI applies the migration before it deploys the new Worker.
const insertSiteAsOldWorker = (database: DatabaseSync, id: string, status: string) =>
  database
    .prepare(
      `INSERT INTO hosted_sites(
         id, user_id, hostname, title, description, framework, spa_fallback, status, created_at, updated_at
       ) VALUES (?, 'user-1', ?, 'Planner', 'A planner.', 'vanilla', 0, ?, 1, 1)`,
    )
    .run(id, `${id}.openbot.site`, status);

describe("hosted site servers migration", () => {
  it("keeps every site and deployment in the unlinked bucket, and accepts the old Worker's inserts", () => {
    const database = migratedDatabase("0023_hosted_servers.sql");
    databases.push(database);
    database.exec(`
      INSERT INTO users(id, identity_key, email, name, avatar_url, created_at, updated_at)
      VALUES ('user-1', 'email:one@example.test', 'one@example.test', 'One', NULL, 1, 1);
    `);
    insertSiteAsOldWorker(database, "site-active", "active");
    insertSiteAsOldWorker(database, "site-deleted", "deleted");
    insertSiteAsOldWorker(database, "site-uploading", "uploading");
    database.exec(`
      UPDATE hosted_sites SET current_deployment_id = 'deployment-1', expires_at = 100, route_synced_at = 2
      WHERE id = 'site-active';
      UPDATE hosted_sites SET deleted_at = 3 WHERE id = 'site-deleted';
      INSERT INTO site_deployments(
        id, site_id, user_id, status, file_count, total_bytes, manifest_json, site_title, site_description,
        site_framework, site_spa_fallback, idempotency_key, request_hash, created_at, upload_expires_at, activated_at
      ) VALUES (
        'deployment-1', 'site-active', 'user-1', 'active', 1, 10, '[]', 'Planner', 'A planner.', 'vanilla', 0,
        'publish-1', 'hash-1', 1, 2, 2
      );
    `);
    const before = snapshot(database);

    database.exec("BEGIN");
    database.exec(migration("0024_hosted_site_servers.sql"));
    database.exec("COMMIT");

    const after = snapshot(database);
    expect(after.deployments).toEqual(before.deployments);
    expect(after.sites).toEqual(before.sites.map((site) => ({ ...site, server_id: null })));
    insertSiteAsOldWorker(database, "site-after", "uploading");
    expect(database.prepare("SELECT server_id FROM hosted_sites WHERE id = 'site-after'").get()).toEqual({
      server_id: null,
    });
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(database.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  });
});

const snapshot = (database: DatabaseSync) => ({
  sites: database.prepare("SELECT * FROM hosted_sites ORDER BY id").all(),
  deployments: database.prepare("SELECT * FROM site_deployments ORDER BY id").all(),
});
