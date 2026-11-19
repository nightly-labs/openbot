import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migratedDatabase, migration } from "./sqlite-d1";

const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("referral migration", () => {
  it("keeps account and billing rows, accepts old Worker writes, and can run again", () => {
    const database = migratedDatabase("0058_billing_vat_oss.sql");
    databases.push(database);
    database.exec(`
      INSERT INTO users(id, identity_key, email, name, avatar_url, created_at, updated_at)
      VALUES ('referrer', 'email:referrer@example.test', 'referrer@example.test', 'Ana Lopez', NULL, 1, 1),
             ('friend', 'email:friend@example.test', 'friend@example.test', NULL, NULL, 2, 2);
      INSERT INTO billing_customers(user_id, stripe_customer_id, created_at, updated_at)
      VALUES ('referrer', 'cus_referrer', 1, 1), ('friend', 'cus_friend', 2, 2);
      INSERT INTO billing_subscriptions(
        stripe_subscription_id, user_id, stripe_customer_id, server_id, plan, interval, currency, amount, status,
        current_period_end, cancel_at_period_end, updated_at
      ) VALUES ('sub_friend', 'friend', 'cus_friend', 'host-1', 'standard', 'month', 'eur', 5000, 'active', 10, 0, 2);
      INSERT INTO licenses(
        stripe_subscription_id, user_id, stripe_customer_id, users, currency, status, current_period_end,
        cancel_at_period_end, updated_at
      ) VALUES ('sub_license', 'referrer', 'cus_referrer', 3, 'usd', 'active', 30, 0, 1);
    `);
    const before = snapshot(database);

    database.exec("BEGIN");
    database.exec(migration("0059_referrals.sql"));
    database.exec("COMMIT");
    database.exec(migration("0059_referrals.sql"));

    expect(snapshot(database)).toEqual(before);
    // The old Worker's billing writes still run.
    database.exec(`
      INSERT INTO billing_subscriptions(
        stripe_subscription_id, user_id, stripe_customer_id, server_id, plan, interval, currency, status,
        current_period_end, cancel_at_period_end, updated_at
      ) VALUES ('sub_friend_2', 'friend', 'cus_friend', 'host-2', 'pro', 'year', 'eur', 'active', 20, 0, 3);
      UPDATE billing_subscriptions SET status = 'canceled', updated_at = 4 WHERE stripe_subscription_id = 'sub_friend';
    `);

    database.exec(`
      INSERT INTO referral_codes(user_id, code, created_at) VALUES ('referrer', 'k7m2p9qx', 5);
      INSERT INTO referrals(referred_user_id, referrer_user_id, created_at) VALUES ('friend', 'referrer', 6);
      INSERT INTO referral_credits(
        invoice_id, referrer_user_id, referred_user_id, source_currency, source_amount, currency, amount, created_at
      ) VALUES ('in_1', 'referrer', 'friend', 'eur', 5000, 'usd', 600, 7);
      INSERT INTO referral_reversals(reversal_id, invoice_id, amount, created_at) VALUES ('re_1', 'in_1', 600, 8);
      UPDATE referral_credits SET reversed_amount = 600 WHERE invoice_id = 'in_1';
    `);
    // One code for each account, and no account has the code of another.
    expect(() =>
      database.exec("INSERT INTO referral_codes(user_id, code, created_at) VALUES ('friend', 'k7m2p9qx', 9)"),
    ).toThrow();
    // An account cannot invite itself, and has one referrer.
    expect(() =>
      database.exec(
        "INSERT INTO referrals(referred_user_id, referrer_user_id, created_at) VALUES ('referrer', 'referrer', 9)",
      ),
    ).toThrow();
    expect(() =>
      database.exec(
        "INSERT INTO referrals(referred_user_id, referrer_user_id, created_at) VALUES ('friend', 'referrer', 9)",
      ),
    ).toThrow();
    // A new invite is not blocked; a friend who paid with a card of the referrer is.
    expect(database.prepare("SELECT blocked_at FROM referrals WHERE referred_user_id = 'friend'").get()).toEqual({
      blocked_at: null,
    });
    database.exec("UPDATE referrals SET blocked_at = 10 WHERE referred_user_id = 'friend'");
    // A reversal never takes back more than the credit.
    expect(() =>
      database.exec("UPDATE referral_credits SET reversed_amount = 601 WHERE invoice_id = 'in_1'"),
    ).toThrow();
    // A credit names an account that exists.
    expect(() =>
      database.exec(`
        INSERT INTO referral_credits(
          invoice_id, referrer_user_id, referred_user_id, source_currency, source_amount, currency, amount, created_at
        ) VALUES ('in_2', 'gone', 'friend', 'eur', 5000, 'eur', 500, 9);
      `),
    ).toThrow();

    // An account that is deleted takes its invite rows with it.
    database.exec("DELETE FROM users WHERE id = 'friend'");
    expect(database.prepare("SELECT COUNT(*) AS count FROM referrals").get()).toEqual({ count: 0 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM referral_credits").get()).toEqual({ count: 0 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM referral_reversals").get()).toEqual({ count: 0 });
    expect(database.prepare("SELECT code FROM referral_codes").all()).toEqual([{ code: "k7m2p9qx" }]);
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(database.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  });
});

const snapshot = (database: DatabaseSync) => ({
  users: database.prepare("SELECT * FROM users ORDER BY id").all(),
  customers: database.prepare("SELECT * FROM billing_customers ORDER BY user_id").all(),
  subscriptions: database.prepare("SELECT * FROM billing_subscriptions ORDER BY stripe_subscription_id").all(),
  licenses: database.prepare("SELECT * FROM licenses ORDER BY stripe_subscription_id").all(),
});
