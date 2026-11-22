import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migratedDatabase, migration } from "./sqlite-d1";

const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("credit media migration", () => {
  it("keeps wallets, holds and ledger entries, and stores a model price table that cascades", () => {
    const database = migratedDatabase("0064_credit_wallets.sql");
    databases.push(database);
    database.exec(`
      INSERT INTO users(id, identity_key, email, name, avatar_url, created_at, updated_at)
      VALUES ('owner', 'email:owner@example.test', 'owner@example.test', 'Ana Lopez', NULL, 1, 1);
      INSERT INTO remote_hosts(host_id, owner_user_id, name, created_at, updated_at)
      VALUES ('host-1', 'owner', 'Studio', 2, 2);
      INSERT INTO credit_ledger(entry_id, user_id, server_id, amount_tenths, kind, actor_user_id, reference, created_at)
      VALUES ('purchase:cs_1', 'owner', NULL, 3000, 'purchase', 'owner', 'cs_1', 3);
      INSERT INTO credit_holds(job_id, user_id, server_id, actor_user_id, model_id, credits_tenths, created_at, check_at, expires_at)
      VALUES ('job-1', NULL, 'host-1', NULL, 'seedance-2.5', 175, 4, 5, 6),
             ('job-2', 'owner', NULL, 'owner', 'nano-banana-pro', 5, 4, 5, 6);
    `);
    const before = snapshot(database);

    database.exec("BEGIN");
    database.exec(migration("0065_credit_media.sql"));
    database.exec("COMMIT");

    expect(snapshot(database)).toEqual(before);

    database.exec(`
      INSERT INTO credit_media_models(model_id, upstream_id, kind, name, maker, variant, position, enabled, specs, upstream_params, updated_at)
      VALUES ('seedance-2.5', 'up-video-1', 'video', 'Seedance 2.5', 'ByteDance', NULL, 1, 1, '{"durations":[5,10]}', '{}', 7),
             ('image-one', 'up-image-1', 'image', 'Image One', 'Maker', 'High', 2, 0, '{}', '{"quality":"high"}', 7);
      INSERT INTO credit_media_prices(model_id, resolution, unit, credits, silent_credits, updated_at)
      VALUES ('seedance-2.5', '720p', 'second', 7, 3.5, 7),
             ('seedance-2.5', '1080p', 'second', 15.5, 15.5, 7),
             ('image-one', '', 'item', 4.5, NULL, 7);
    `);
    expect(
      database
        .prepare(
          "SELECT resolution, credits, silent_credits FROM credit_media_prices WHERE model_id = 'seedance-2.5' ORDER BY credits",
        )
        .all(),
    ).toEqual([
      { resolution: "720p", credits: 7, silent_credits: 3.5 },
      { resolution: "1080p", credits: 15.5, silent_credits: 15.5 },
    ]);
    for (const statement of [
      "INSERT INTO credit_media_models(model_id, upstream_id, kind, name, maker, updated_at) VALUES ('a', 'u', 'audio', 'A', 'M', 1)",
      "INSERT INTO credit_media_models(model_id, upstream_id, kind, name, maker, specs, updated_at) VALUES ('b', 'u', 'image', 'B', 'M', 'not json', 1)",
      "INSERT INTO credit_media_models(model_id, upstream_id, kind, name, maker, enabled, updated_at) VALUES ('c', 'u', 'image', 'C', 'M', 2, 1)",
      "INSERT INTO credit_media_prices(model_id, resolution, unit, credits, updated_at) VALUES ('image-one', '1K', 'item', 0, 1)",
      "INSERT INTO credit_media_prices(model_id, resolution, unit, credits, updated_at) VALUES ('image-one', '1K', 'clip', 1, 1)",
      "INSERT INTO credit_media_prices(model_id, resolution, unit, credits, updated_at) VALUES ('missing', '', 'item', 1, 1)",
      "INSERT INTO credit_media_prices(model_id, resolution, unit, credits, updated_at) VALUES ('image-one', '', 'item', 2, 1)",
      "INSERT INTO credit_media_prices(model_id, resolution, unit, credits, silent_credits, updated_at) VALUES ('image-one', '2K', 'item', 2, 3, 1)",
      "INSERT INTO credit_media_prices(model_id, resolution, unit, credits, silent_credits, updated_at) VALUES ('image-one', '2K', 'item', 2, 0, 1)",
    ])
      expect(() => database.exec(statement)).toThrow();

    database.exec("UPDATE credit_media_models SET model_id = 'image-two' WHERE model_id = 'image-one'");
    expect(database.prepare("SELECT model_id FROM credit_media_prices WHERE credits = 4.5").get()).toEqual({
      model_id: "image-two",
    });
    database.exec("DELETE FROM credit_media_models WHERE model_id = 'seedance-2.5'");
    expect(database.prepare("SELECT COUNT(*) AS count FROM credit_media_prices").get()).toEqual({ count: 1 });
    expect(snapshot(database)).toEqual(before);
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(database.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  });

  it("rolls back as one unit when a statement fails", () => {
    const database = migratedDatabase("0064_credit_wallets.sql");
    databases.push(database);
    database.exec("CREATE TABLE credit_media_prices (blocker INTEGER)");
    database.exec("BEGIN");
    expect(() => database.exec(migration("0065_credit_media.sql"))).toThrow();
    database.exec("ROLLBACK");
    expect(
      database.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'credit_media_models%' ORDER BY name").all(),
    ).toEqual([]);
  });
});

const snapshot = (database: DatabaseSync) => ({
  users: database.prepare("SELECT * FROM users ORDER BY id").all(),
  hosts: database.prepare("SELECT * FROM remote_hosts ORDER BY host_id").all(),
  ledger: database.prepare("SELECT * FROM credit_ledger ORDER BY entry_id").all(),
  holds: database.prepare("SELECT * FROM credit_holds ORDER BY job_id").all(),
});
