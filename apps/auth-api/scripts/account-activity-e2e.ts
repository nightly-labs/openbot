import { readdirSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Effect } from "effect";
import {
  accountActivityDay,
  MAX_REPORTED_ACCOUNTS,
  readReportedAccounts,
  recordAccountActivity,
  sendAccountActivitySnapshots,
} from "../src/server/account-activity";
import { ACCOUNT_ANALYTICS_SCHEMA_VERSION, createAccountEventDelivery } from "../src/server/account-analytics";
import { sqliteD1 } from "./sqlite-d1";

const ROOT = resolve(import.meta.dirname, "../../..");
const OUT = join(ROOT, ".openbot-build", "account-activity-e2e");
const MIGRATIONS = join(ROOT, "apps", "auth-api", "migrations");
const LATE_23RD = Date.parse("2026-11-23T22:30:00Z");
const EARLY_24TH = Date.parse("2026-11-23T23:30:00Z");
const JUST_AFTER_25TH_STARTS = Date.parse("2026-11-24T23:05:00Z");
const NOON_25TH = Date.parse("2026-11-25T11:00:00Z");

const checks: { name: string; passed: boolean; detail?: unknown }[] = [];
function check(name: string, passed: boolean, detail?: unknown) {
  checks.push({ name, passed, ...(detail === undefined ? {} : { detail }) });
}

function migratedDatabase(): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const name of readdirSync(MIGRATIONS).sort()) database.exec(readFileSync(join(MIGRATIONS, name), "utf8"));
  for (const id of ["owner", "member", "removed", "stranger", "other-owner"]) {
    database
      .prepare("INSERT INTO users(id, identity_key, email, created_at, updated_at) VALUES (?, ?, ?, 1, 1)")
      .run(id, `email:${id}`, `${id}@example.test`);
  }
  database
    .prepare(
      "INSERT INTO remote_hosts(host_id, owner_user_id, name, created_at, updated_at) VALUES ('host', 'owner', 'Host', 1, 1)",
    )
    .run();
  database
    .prepare(
      "INSERT INTO remote_hosts(host_id, owner_user_id, name, created_at, updated_at) VALUES ('other', 'other-owner', 'Other', 1, 1)",
    )
    .run();
  const membership = database.prepare(
    `INSERT INTO remote_memberships(membership_id, host_id, user_id, role, status, created_at, updated_at, removed_at)
     VALUES (?, ?, ?, ?, 'active', 1, 1, ?)`,
  );
  membership.run("m-owner", "host", "owner", "owner", null);
  membership.run("m-member", "host", "member", "member", null);
  membership.run("m-removed", "host", "removed", "member", 5);
  membership.run("m-other", "other", "member", "member", null);
  return database;
}

interface SentBody {
  payload: {
    name: string;
    profileId?: string;
    properties: {
      day?: string;
      active_accounts?: number;
      time_zone?: string;
      event_schema_version?: number;
      __timestamp?: string;
    };
  };
}

function rows(database: DatabaseSync) {
  return database.prepare("SELECT day, account_id FROM account_active_days ORDER BY day, account_id").all();
}

async function main() {
  const sqlite = migratedDatabase();
  const database = sqliteD1(sqlite);
  const record = (caller: string, accounts: string[], now: number) =>
    Effect.runPromise(recordAccountActivity(database, caller, accounts, now));

  const first = await record("owner", ["owner", "member", "removed", "stranger"], LATE_23RD);
  check("an owner records itself and an active member only", first.recorded === 2, first);
  await record("owner", ["owner", "member"], LATE_23RD);
  await record("member", ["member"], LATE_23RD);
  await record("other-owner", ["other-owner", "member"], LATE_23RD);
  check(
    "the same account on several hosts and devices is one row per day",
    JSON.stringify(rows(sqlite)) ===
      JSON.stringify([
        { day: "2026-11-23", account_id: "member" },
        { day: "2026-11-23", account_id: "other-owner" },
        { day: "2026-11-23", account_id: "owner" },
      ]),
    rows(sqlite),
  );
  const strangerOnly = await record("stranger", ["owner"], LATE_23RD);
  check("a caller cannot record an account that is not its member", strangerOnly.recorded === 0, strangerOnly);

  check(
    "the day uses Europe/Warsaw",
    accountActivityDay(LATE_23RD) === "2026-11-23" && accountActivityDay(EARLY_24TH) === "2026-11-24",
    { late: accountActivityDay(LATE_23RD), early: accountActivityDay(EARLY_24TH) },
  );
  await record("owner", ["owner"], EARLY_24TH);
  await record("owner", ["owner"], NOON_25TH);

  check(
    "the account list is validated",
    readReportedAccounts({ accounts: ["a", "a", "b"] })?.join(",") === "a,b" &&
      readReportedAccounts({ accounts: [] }) === null &&
      readReportedAccounts({ accounts: ["bad id"] }) === null &&
      readReportedAccounts({ accounts: [1] }) === null &&
      readReportedAccounts({ accounts: "owner" }) === null &&
      readReportedAccounts({
        accounts: Array.from({ length: MAX_REPORTED_ACCOUNTS + 1 }, (_, index) => `a${index}`),
      }) === null,
  );

  const sent: SentBody[] = [];
  let openPanelStatus = 200;
  const deliver = createAccountEventDelivery({
    clientId: "client",
    clientSecret: "secret",
    fetch: async (_input, init) => {
      sent.push(JSON.parse(String(init.body)));
      return new Response("{}", { status: openPanelStatus });
    },
  });
  const snapshot = (now: number) => Effect.runPromise(sendAccountActivitySnapshots(database, deliver, now));
  const totals = () => sent.map((body) => [body.payload.properties.day, body.payload.properties.active_accounts]);
  const days = () => [...new Set(rows(sqlite).map((row) => row.day))];

  await snapshot(JUST_AFTER_25TH_STARTS);
  check(
    "a day is sent only 15 minutes after it ends, so a request from before midnight cannot add to a sent day",
    JSON.stringify(totals()) === JSON.stringify([["2026-11-23", 3]]) &&
      JSON.stringify(days()) === JSON.stringify(["2026-11-24", "2026-11-25"]),
    { totals: totals(), days: days() },
  );
  check(
    "the total has no profile and no account ID",
    sent.every(
      (body) =>
        body.payload.profileId === undefined &&
        !["owner", "member", "other-owner"].some((id) => JSON.stringify(body).includes(`"${id}"`)),
    ),
    sent,
  );
  check(
    "the total is dated on its own day with the current generation",
    sent.every(
      (body) =>
        body.payload.name === "account_activity_snapshot" &&
        body.payload.properties.__timestamp === `${body.payload.properties.day}T12:00:00.000Z` &&
        body.payload.properties.time_zone === "Europe/Warsaw" &&
        body.payload.properties.event_schema_version === ACCOUNT_ANALYTICS_SCHEMA_VERSION,
    ),
    sent,
  );

  sent.length = 0;
  openPanelStatus = 503;
  await snapshot(NOON_25TH);
  check(
    "a day whose send fails keeps its rows",
    JSON.stringify(days()) === JSON.stringify(["2026-11-24", "2026-11-25"]),
    { totals: totals(), days: days() },
  );

  sent.length = 0;
  openPanelStatus = 200;
  await Promise.all([snapshot(NOON_25TH), snapshot(NOON_25TH)]);
  check(
    "the failed day is sent on the next run, and two overlapping runs send only the same total",
    sent.length >= 1 && totals().every(([day, total]) => day === "2026-11-24" && total === 1),
    totals(),
  );
  check(
    "sent days are deleted and today stays",
    JSON.stringify(rows(sqlite)) === JSON.stringify([{ day: "2026-11-25", account_id: "owner" }]),
    rows(sqlite),
  );

  sent.length = 0;
  await snapshot(NOON_25TH);
  check("a later run sends nothing", sent.length === 0, sent);

  sqlite.prepare("DELETE FROM users WHERE id = 'owner'").run();
  check("a deleted account leaves no activity row", rows(sqlite).length === 0, rows(sqlite));

  await mkdir(OUT, { recursive: true });
  const passed = checks.every((entry) => entry.passed);
  await writeFile(join(OUT, "report.json"), `${JSON.stringify({ passed, checks }, null, 2)}\n`);
  for (const entry of checks) console.log(`${entry.passed ? "ok" : "FAIL"} ${entry.name}`);
  if (!passed) process.exit(1);
}

await main();
