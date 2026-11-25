import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Effect } from "effect";
import { AccountActivityReporter, HostAccountActivity } from "../src/main/account-activity-reporter";

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
  const send = (accounts: readonly string[]) =>
    Effect.suspend(() => {
      const failed = failNext > 0;
      if (failed) failNext -= 1;
      else sent.push([...accounts]);
      for (const wake of waiters.splice(0)) wake();
      return failed ? Effect.fail("unavailable") : Effect.succeed(null);
    });
  const reporter = new AccountActivityReporter({ now: () => now, retryAfterMs: 10, send });
  return {
    reporter,
    send,
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

  let crashed = false;
  const crash = harness(NOON_23RD);
  const crashing = new AccountActivityReporter({
    now: () => NOON_23RD,
    retryAfterMs: 10,
    send: (accounts) => {
      if (crashed) return crash.send(accounts);
      crashed = true;
      return Effect.die("send crashed");
    },
  });
  const afterCrash = crash.nextSend();
  crashing.record("ada");
  const resent = await afterCrash;
  check(
    "a send that crashes is tried again and does not stop the reporter",
    resent && JSON.stringify(crash.sent) === JSON.stringify([["ada"]]),
    crash.sent,
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

  const hostSent = harness(NOON_23RD);
  let owner: { id: string } | null = { id: "owner" };
  const host = new HostAccountActivity({
    analyticsOn: false,
    now: () => NOON_23RD,
    retryAfterMs: 10,
    send: hostSent.send,
    resolveOwner: () => owner,
    memberAccountId: (memberId) => (memberId === "member-1" ? "member-account" : null),
  });
  host.turnStarted();
  host.memberUsed("member-1");
  await host.idle();
  const sentWhileOff = hostSent.sent.length;
  host.setAnalyticsOn(true);
  owner = null;
  host.turnStarted();
  host.memberUsed("member-without-account");
  await host.idle();
  const sentWithoutAccounts = hostSent.sent.length;
  owner = { id: "owner" };
  host.turnStarted();
  await host.idle();
  check(
    "a host with analytics off sends no owner or member, and with analytics on sends its signed-in owner",
    sentWhileOff === 0 && sentWithoutAccounts === 0 && JSON.stringify(hostSent.sent) === JSON.stringify([["owner"]]),
    { sentWhileOff, sentWithoutAccounts, sent: hostSent.sent },
  );

  const optOut = harness(NOON_23RD);
  const optOutHost = new HostAccountActivity({
    analyticsOn: true,
    now: () => NOON_23RD,
    retryAfterMs: 10,
    send: optOut.send,
    resolveOwner: () => ({ id: "owner" }),
    memberAccountId: () => "member-account",
  });
  optOut.failNextSends(1);
  const failedOwnerSend = optOut.nextSend();
  optOutHost.turnStarted();
  await failedOwnerSend;
  await optOutHost.idle();
  optOutHost.setAnalyticsOn(false);
  optOutHost.setAnalyticsOn(true);
  const nextAfterOptOut = optOut.nextSend();
  optOutHost.memberUsed("member-1");
  const sentAfterOptOut = await nextAfterOptOut;
  await optOutHost.idle();
  check(
    "turning analytics off drops the accounts that wait for a retry",
    sentAfterOptOut && JSON.stringify(optOut.sent) === JSON.stringify([["member-account"]]),
    optOut.sent,
  );

  const rejoin = harness(NOON_23RD);
  const rejoinHost = new HostAccountActivity({
    analyticsOn: true,
    now: () => NOON_23RD,
    retryAfterMs: 10,
    send: rejoin.send,
    resolveOwner: () => ({ id: "owner" }),
    memberAccountId: () => null,
  });
  rejoinHost.turnStarted();
  await rejoinHost.idle();
  rejoinHost.setAnalyticsOn(false);
  rejoinHost.setAnalyticsOn(true);
  rejoinHost.turnStarted();
  await rejoinHost.idle();
  check(
    "after analytics is turned off and on again on the same day, the owner is sent again",
    JSON.stringify(rejoin.sent) === JSON.stringify([["owner"], ["owner"]]),
    rejoin.sent,
  );

  await mkdir(OUT, { recursive: true });
  const passed = checks.every((entry) => entry.passed);
  await writeFile(join(OUT, "report.json"), `${JSON.stringify({ passed, checks }, null, 2)}\n`);
  for (const entry of checks) process.stdout.write(`${entry.passed ? "ok" : "FAIL"} ${entry.name}\n`);
  if (!passed) process.exit(1);
}

await main();
