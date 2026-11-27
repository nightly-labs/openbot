import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createOpenBotLogger } from "@openbot/logging";
import { type NetworkChange, networkChange, strongerChange } from "../apps/mobile/src/shared/lib/network-change";
import {
  createPathWatch,
  PATH_SILENCE_MS,
  PATH_WATCH_INTERVAL_MS,
  type PathReading,
  RELAY_UPGRADE_DELAYS_MS,
} from "../packages/team-client/src/remote-path-watch";
import {
  createRemoteConnectionRecovery,
  REMOTE_RETRY_COOLDOWN_MS,
  REMOTE_RETRY_DELAYS_MS,
  REMOTE_RETRY_LIMIT,
  type RemoteRecoveryStatus,
} from "../packages/team-client/src/remote-recovery";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, ".openbot-build", "mobile-reconnect-e2e");
const JITTER = 0.2;
const TIMER_SLACK_MS = 250;
const FAST_RECOVERY_GOAL_MS = 12_500;

const checks: { name: string; passed: boolean; detail?: unknown }[] = [];
function check(name: string, passed: boolean, detail?: unknown) {
  checks.push({ name, passed, ...(detail === undefined ? {} : { detail }) });
}

function settled<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function recoveryAfterDrops(failures: number) {
  const attempts: number[] = [];
  const statuses: RemoteRecoveryStatus[] = [];
  const online = settled<number>();
  const startedAt = performance.now();
  const recovery = createRemoteConnectionRecovery(
    async () => {
      attempts.push(performance.now() - startedAt);
      if (attempts.length <= failures) throw new Error("The host did not answer.");
    },
    () => {},
    (status) => {
      statuses.push(status);
      if (status.phase === "online") online.resolve(performance.now() - startedAt);
    },
  );
  recovery.setActive(true);
  const onlineAfterMs = await online.promise;
  recovery.dispose();
  return { attempts, statuses, onlineAfterMs };
}

async function cooldownAfterLimit() {
  const cooldown = settled<RemoteRecoveryStatus>();
  let attempts = 0;
  const startedAt = performance.now();
  const recovery = createRemoteConnectionRecovery(
    async () => {
      attempts += 1;
      throw new Error("The host did not answer.");
    },
    () => {},
    (status) => {
      if (status.phase === "cooldown") cooldown.resolve(status);
    },
  );
  recovery.setActive(true);
  const status = await cooldown.promise;
  const reachedAfterMs = performance.now() - startedAt;
  recovery.dispose();
  return { status, attempts, reachedAfterMs };
}

function networkScenarios() {
  const wifi = (address: string | null) => ({ type: "WIFI", address });
  const cellular = { type: "CELLULAR", address: null };
  const scenarios: {
    name: string;
    steps: { type: string; address: string | null }[];
    expected: NetworkChange | null;
  }[] = [
    { name: "Wi-Fi to mobile data", steps: [wifi("192.168.1.20"), cellular], expected: "moved" },
    { name: "mobile data to Wi-Fi", steps: [cellular, wifi("192.168.1.20")], expected: "moved" },
    {
      name: "iOS VPN turns on",
      steps: [wifi("192.168.1.20"), { type: "UNKNOWN", address: "192.168.1.20" }],
      expected: "changed",
    },
    {
      name: "Android VPN turns off",
      steps: [{ type: "VPN", address: "100.101.4.9" }, wifi("192.168.1.20")],
      expected: "changed",
    },
    { name: "another Wi-Fi network", steps: [wifi("192.168.1.20"), wifi("10.0.0.31")], expected: "moved" },
    {
      name: "VPN address changes",
      steps: [
        { type: "VPN", address: "100.101.4.9" },
        { type: "VPN", address: "100.88.1.2" },
      ],
      expected: "changed",
    },
    { name: "signal strength only", steps: [wifi("192.168.1.20"), wifi("192.168.1.20")], expected: null },
    { name: "cellular with no address", steps: [cellular, cellular], expected: null },
    {
      name: "VPN on, then Wi-Fi to mobile data in the same second",
      steps: [wifi("192.168.1.20"), { type: "UNKNOWN", address: "192.168.1.20" }, cellular],
      expected: "changed",
    },
    {
      name: "VPN on, then another Wi-Fi network",
      steps: [wifi("192.168.1.20"), { type: "UNKNOWN", address: "192.168.1.20" }, wifi("10.0.0.31")],
      expected: "changed",
    },
    {
      name: "Wi-Fi to mobile data, then VPN on",
      steps: [wifi("192.168.1.20"), cellular, { type: "UNKNOWN", address: null }],
      expected: "moved",
    },
  ];
  return scenarios.map((scenario) => {
    let change: NetworkChange | null = null;
    for (let index = 1; index < scenario.steps.length; index += 1) {
      const previous = scenario.steps[index - 1];
      const next = scenario.steps[index];
      if (previous && next) change = strongerChange(change, networkChange(previous, next));
    }
    return { name: scenario.name, expected: scenario.expected, actual: change };
  });
}

function pathTimeline(readings: (now: number) => PathReading | null, untilMs: number) {
  const watch = createPathWatch();
  const silentAt: number[] = [];
  const upgradeAt: number[] = [];
  const routeChangedAt: number[] = [];
  for (let now = PATH_WATCH_INTERVAL_MS; now <= untilMs; now += PATH_WATCH_INTERVAL_MS) {
    const step = watch.observe(readings(now), now);
    if (step.silent) silentAt.push(now);
    if (step.routeChanged) routeChangedAt.push(now);
    if (step.upgradeDue) {
      upgradeAt.push(now);
      watch.upgradeStarted(now);
    }
  }
  return { silentAt, upgradeAt, routeChangedAt };
}

function pathScenarios() {
  const direct = (received: number): PathReading => ({ pairId: "direct", received, relayed: false });
  const busy = pathTimeline((now) => direct(now), 120_000);
  const deadAt = 30_000;
  const dead = pathTimeline((now) => direct(Math.min(now, deadAt)), 60_000);
  const relayed = pathTimeline((now) => ({ pairId: "relay", received: now, relayed: true }), 900_000);
  const upgraded = pathTimeline(
    (now) => (now < 70_000 ? { pairId: "relay", received: now, relayed: true } : direct(now)),
    900_000,
  );
  const lost = pathTimeline((now) => (now < 20_000 ? direct(now) : null), 60_000);
  return { busy, dead, deadAt, relayed, upgraded, lost };
}

async function run() {
  await mkdir(OUT, { recursive: true });

  const failures = REMOTE_RETRY_DELAYS_MS.length;
  const recovery = await recoveryAfterDrops(failures);
  const gaps = recovery.attempts.slice(1).map((at, index) => at - (recovery.attempts[index] ?? 0));
  gaps.forEach((gap, index) => {
    const base = REMOTE_RETRY_DELAYS_MS[index] ?? 0;
    check(
      `retry ${index + 1} waits ${base} ms plus jitter`,
      gap >= base - 20 && gap <= base * (1 + JITTER) + TIMER_SLACK_MS,
      { gapMs: Math.round(gap) },
    );
  });
  check(
    `online after ${failures} failed attempts within ${FAST_RECOVERY_GOAL_MS} ms`,
    recovery.onlineAfterMs <= FAST_RECOVERY_GOAL_MS,
    {
      onlineAfterMs: Math.round(recovery.onlineAfterMs),
    },
  );
  check("first attempt starts at once", (recovery.attempts[0] ?? Number.POSITIVE_INFINITY) < 100, {
    firstAttemptMs: Math.round(recovery.attempts[0] ?? -1),
  });

  const cooldown = await cooldownAfterLimit();
  check(`cooldown starts after ${REMOTE_RETRY_LIMIT} failed attempts`, cooldown.attempts === REMOTE_RETRY_LIMIT, {
    attempts: cooldown.attempts,
  });
  check(
    `cooldown is about ${REMOTE_RETRY_COOLDOWN_MS / 1000} s`,
    cooldown.status.remainingSeconds >= REMOTE_RETRY_COOLDOWN_MS / 1000 &&
      cooldown.status.remainingSeconds <= Math.ceil((REMOTE_RETRY_COOLDOWN_MS * (1 + JITTER)) / 1000),
    { remainingSeconds: cooldown.status.remainingSeconds, reachedAfterMs: Math.round(cooldown.reachedAfterMs) },
  );

  const network = networkScenarios();
  for (const scenario of network)
    check(`network: ${scenario.name} is ${scenario.expected ?? "no change"}`, scenario.actual === scenario.expected, {
      actual: scenario.actual,
    });

  const path = pathScenarios();
  check("path: a busy direct path is never silent", path.busy.silentAt.length === 0, path.busy);
  check("path: a busy direct path never upgrades", path.busy.upgradeAt.length === 0, path.busy);
  const firstSilent = path.dead.silentAt[0];
  check(
    `path: a dead path is silent ${PATH_SILENCE_MS} ms after its last bytes`,
    firstSilent !== undefined &&
      firstSilent - path.deadAt >= PATH_SILENCE_MS &&
      firstSilent - path.deadAt < PATH_SILENCE_MS + PATH_WATCH_INTERVAL_MS,
    path.dead,
  );
  const silentGaps = path.dead.silentAt.slice(1).map((at, index) => at - (path.dead.silentAt[index] ?? 0));
  check(
    "path: a dead path is not checked more often than the silence time",
    silentGaps.every((gap) => gap >= PATH_SILENCE_MS),
    { silentGaps },
  );
  const expectedUpgrades: number[] = [];
  let since = PATH_WATCH_INTERVAL_MS;
  for (const delay of RELAY_UPGRADE_DELAYS_MS) {
    since = Math.ceil((since + delay) / PATH_WATCH_INTERVAL_MS) * PATH_WATCH_INTERVAL_MS;
    expectedUpgrades.push(since);
  }
  check(
    `path: a relayed path tries ${RELAY_UPGRADE_DELAYS_MS.length} upgrades, then stops`,
    JSON.stringify(path.relayed.upgradeAt) === JSON.stringify(expectedUpgrades),
    { actual: path.relayed.upgradeAt, expected: expectedUpgrades },
  );
  check(
    "path: an upgraded path reports the new route and tries no more upgrades",
    path.upgraded.upgradeAt.length === 1 && path.upgraded.routeChangedAt.length === 1,
    path.upgraded,
  );
  check("path: a lost pair is not reported as silent", path.lost.silentAt.length === 0, path.lost);

  const passed = checks.every((item) => item.passed);
  const report = {
    status: passed ? "passed" : "failed",
    retryDelaysMs: REMOTE_RETRY_DELAYS_MS,
    cooldownMs: REMOTE_RETRY_COOLDOWN_MS,
    recovery: {
      attemptsAtMs: recovery.attempts.map(Math.round),
      gapsMs: gaps.map(Math.round),
      onlineAfterMs: Math.round(recovery.onlineAfterMs),
    },
    network,
    path,
    checks,
  };
  const reportPath = join(OUT, "report.json");
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  const logger = createOpenBotLogger("mobile-reconnect-e2e");
  for (const item of checks) {
    if (item.passed) logger.info(`ok ${item.name}`);
    else logger.error(`FAIL ${item.name}`);
  }
  logger.info(`Report: ${reportPath}`);
  return passed ? 0 : 1;
}

process.exit(await run());
