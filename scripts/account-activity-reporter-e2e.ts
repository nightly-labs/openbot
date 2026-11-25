import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Effect } from "effect";
import { AccountActivityReporter } from "../src/main/account-activity-reporter";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, ".openbot-build", "account-activity-reporter-e2e");
const NOON_23RD = Date.parse("2026-11-23T11:00:00Z");
const LATE_23RD = Date.parse("2026-11-23T22:58:00Z");
const EARLY_24TH = Date.parse("2026-11-23T23:01:00Z");
const SEND_DEADLINE_MS = 5_000;

const checks: { name: string; passed: boolean; detail?: unknown }[] = [];
function check(name: string, passed: boolean, detail?: unknown) {
  checks.push({ name, passed, ...(detail === undefined ? {} : { detail }) });
}

function harness(start: number) {
  let now = start;
  let failNext = 0;
  const sent: string[][] = [];
  const waiters: (() => void)[] = [];
  const reporter = new AccountActivityReporter({
    now: () => now,
    retryAfterMs: 10,
    send: (accounts) =>
      Effect.suspend(() => {
        const failed = failNext > 0;
        if (failed) failNext -= 1;
        else sent.push([...accounts]);
        for (const wake of waiters.splice(0)) wake();
        return failed ? Effect.fail("unavailable") : Effect.succeed(null);
      }),
  });
  return {
    reporter,
    sent,
    setNow: (value: number) => {
      now = value;
    },
    failNextSends: (count: number) => {
      failNext = count;
    },
    nextSend: () =>
      new Promise<boolean>((settle) => {
        const deadline = setTimeout(() => settle(false), SEND_DEADLINE_MS);
        waiters.push(() => {
          clearTimeout(deadline);
          settle(true);
        });
      }),
  };
}

async function main() {
  const once = harness(NOON_23RD);
  once.reporter.record("ada");
  once.reporter.record("ada");
  await once.reporter.idle();
  once.reporter.record("ada");
  once.reporter.record("bob");
  await once.reporter.idle();
  check(
    "an account is sent once a day, also when it is recorded during a send",
    JSON.stringify(once.sent) === JSON.stringify([["ada"], ["bob"]]),
    once.sent,
  );

  const retry = harness(NOON_23RD);
  retry.failNextSends(1);
  const firstTry = retry.nextSend();
  retry.reporter.record("ada");
  await firstTry;
  const retried = await retry.nextSend();
  await retry.reporter.idle();
  check(
    "a failed send is tried again with no new activity",
    retried && JSON.stringify(retry.sent) === JSON.stringify([["ada"]]),
    retry.sent,
  );

  const midnight = harness(LATE_23RD);
  midnight.failNextSends(1);
  const failedTry = midnight.nextSend();
  midnight.reporter.record("ada");
  await failedTry;
  await midnight.reporter.idle();
  midnight.setNow(EARLY_24TH);
  midnight.reporter.record("bob");
  await midnight.reporter.idle();
  check(
    "an account that was not sent before midnight is not counted on the next day",
    JSON.stringify(midnight.sent) === JSON.stringify([["bob"]]),
    midnight.sent,
  );
  midnight.reporter.record("ada");
  midnight.reporter.record("bob");
  await midnight.reporter.idle();
  check(
    "an account active on the new day is sent once for that day",
    JSON.stringify(midnight.sent) === JSON.stringify([["bob"], ["ada"]]),
    midnight.sent,
  );

  await mkdir(OUT, { recursive: true });
  const passed = checks.every((entry) => entry.passed);
  await writeFile(join(OUT, "report.json"), `${JSON.stringify({ passed, checks }, null, 2)}\n`);
  for (const entry of checks) process.stdout.write(`${entry.passed ? "ok" : "FAIL"} ${entry.name}\n`);
  if (!passed) process.exit(1);
}

await main();
