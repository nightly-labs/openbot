import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migratedDatabase, migration } from "./sqlite-d1";

const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("referral credit parts migration", () => {
  it("keeps referral rows, accepts the writes of the Worker that runs before the deploy, and stores parts", () => {
    const database = migratedDatabase("0061_hosted_server_archives.sql");
    databases.push(database);
    database.exec(`
      INSERT INTO users(id, identity_key, email, name, avatar_url, created_at, updated_at)
      VALUES ('referrer', 'email:referrer@example.test', 'referrer@example.test', 'Ana Lopez', NULL, 1, 1),
             ('friend', 'email:friend@example.test', 'friend@example.test', NULL, NULL, 2, 2);
      INSERT INTO referral_codes(user_id, code, created_at) VALUES ('referrer', 'k7m2p9qx', 3);
      INSERT INTO referrals(referred_user_id, referrer_user_id, created_at) VALUES ('friend', 'referrer', 4);
      INSERT INTO referral_credits(
        invoice_id, referrer_user_id, referred_user_id, source_currency, source_amount, currency, amount,
        released_at, queued_at, balance_transaction_id, created_at
      ) VALUES ('in_old', 'referrer', 'friend', 'eur', 12000, 'eur', 12000, 5, 6, 'cbtxn_1', 5);
      INSERT INTO referral_reversals(reversal_id, invoice_id, amount, balance_transaction_id, created_at)
      VALUES ('re_old', 'in_old', 1000, 'cbtxn_2', 7);
      UPDATE referral_credits SET reversed_amount = 1000 WHERE invoice_id = 'in_old';
    `);
    const before = snapshot(database);

    database.exec("BEGIN");
    database.exec(migration("0062_referral_credit_parts.sql"));
    database.exec("COMMIT");

    expect(snapshot(database).credits).toEqual(
      before.credits.map((row) => ({ ...row, source_invoice_id: null, ready_at: null })),
    );
    expect(snapshot(database).reversals).toEqual(before.reversals.map((row) => ({ ...row, source_amount: null })));
    expect(snapshot(database).referrals).toEqual(before.referrals);

    database.exec(`
      INSERT INTO referral_credits(
        invoice_id, referrer_user_id, referred_user_id, source_currency, source_amount, currency, amount, created_at
      ) VALUES ('in_monthly', 'referrer', 'friend', 'eur', 500, 'eur', 500, 8);
      INSERT INTO referral_reversals(reversal_id, invoice_id, amount, balance_transaction_id, created_at)
      VALUES ('re_monthly', 'in_monthly', 100, '', 9);
      INSERT INTO referral_credits(
        invoice_id, referrer_user_id, referred_user_id, source_currency, source_amount, currency, amount,
        source_invoice_id, ready_at, created_at
      ) VALUES ('in_year', 'referrer', 'friend', 'eur', 1000, 'eur', 1000, 'in_year', 2592000010, 10),
               ('in_year:2', 'referrer', 'friend', 'eur', 1000, 'eur', 1000, 'in_year', 5184000010, 10);
      INSERT INTO referral_reversals(
        reversal_id, invoice_id, amount, source_amount, balance_transaction_id, created_at
      ) VALUES ('re_year|in_year:2', 'in_year:2', 1000, 1000, '', 11);
    `);
    expect(
      database
        .prepare(
          `SELECT invoice_id FROM referral_credits
           WHERE released_at IS NULL AND ready_at IS NOT NULL AND ready_at <= 2592000010 ORDER BY invoice_id`,
        )
        .all(),
    ).toEqual([{ invoice_id: "in_year" }]);
    expect(
      database
        .prepare(
          `SELECT COUNT(DISTINCT COALESCE(source_invoice_id, invoice_id)) AS payments
           FROM referral_credits WHERE referred_user_id = 'friend'`,
        )
        .get(),
    ).toEqual({ payments: 3 });
    expect(() =>
      database.exec(`
        INSERT INTO referral_reversals(reversal_id, invoice_id, amount, source_amount, created_at)
        VALUES ('re_bad', 'in_year', 1, -1, 12);
      `),
    ).toThrow();

    database.exec("DELETE FROM users WHERE id = 'friend'");
    expect(database.prepare("SELECT COUNT(*) AS count FROM referral_credits").get()).toEqual({ count: 0 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM referral_reversals").get()).toEqual({ count: 0 });
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(database.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  });
});

const snapshot = (database: DatabaseSync) => ({
  referrals: database.prepare("SELECT * FROM referrals ORDER BY referred_user_id").all(),
  credits: database.prepare("SELECT * FROM referral_credits ORDER BY invoice_id").all(),
  reversals: database.prepare("SELECT * FROM referral_reversals ORDER BY reversal_id").all(),
});
