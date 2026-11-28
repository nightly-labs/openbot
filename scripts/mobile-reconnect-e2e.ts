import { mock } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createOpenBotLogger } from "@openbot/logging";
import type { NetworkChange } from "../apps/mobile/src/shared/lib/network-change";
import {
  createRemoteConnectionRecovery,
  REMOTE_RETRY_COOLDOWN_MAX_MS,
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
const CHANGE_SETTLE_MS = 1_000;
const MOVE_LIMIT_MS = 200;
const NETWORK_EVENT_LIMIT_MS = 3_000;
const NETWORK_QUIET_MS = 1_500;

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

async function growingCooldown() {
  const firstOfCycle = new Map<number, ReturnType<typeof settled<RemoteRecoveryStatus>>>();
  const cycle = (attempts: number) => {
    const waiter = firstOfCycle.get(attempts) ?? settled<RemoteRecoveryStatus>();
    firstOfCycle.set(attempts, waiter);
    return waiter;
  };
  let attempts = 0;
  const recovery = createRemoteConnectionRecovery(
    async () => {
      attempts += 1;
      throw new Error("The host did not answer.");
    },
    () => {},
    (status) => {
      if (status.phase === "cooldown") cycle(attempts).resolve(status);
    },
  );
  recovery.setActive(true);
  const first = await cycle(REMOTE_RETRY_LIMIT).promise;
  const second = await cycle(REMOTE_RETRY_LIMIT * 2).promise;
  recovery.refresh();
  const afterRefresh = await cycle(REMOTE_RETRY_LIMIT * 3).promise;
  recovery.dispose();
  return {
    attempts,
    firstSeconds: first.remainingSeconds,
    secondSeconds: second.remainingSeconds,
    afterRefreshSeconds: afterRefresh.remainingSeconds,
  };
}

interface NativeNetworkState {
  type: string;
  isConnected: boolean;
}

const readWaiters: { count: number; resolve: () => void }[] = [];
const networkListeners = new Set<(state: NativeNetworkState) => void>();
const appStateListeners = new Set<(state: string) => void>();
const native: { state: NativeNetworkState; address: string; reads: number } = {
  state: { type: "WIFI", isConnected: true },
  address: "0.0.0.0",
  reads: 0,
};

mock.module("expo-network", () => ({
  NetworkStateType: {
    NONE: "NONE",
    UNKNOWN: "UNKNOWN",
    CELLULAR: "CELLULAR",
    WIFI: "WIFI",
    ETHERNET: "ETHERNET",
    VPN: "VPN",
    OTHER: "OTHER",
  },
  addNetworkStateListener: (listener: (state: NativeNetworkState) => void) => {
    networkListeners.add(listener);
    return { remove: () => networkListeners.delete(listener) };
  },
  getNetworkStateAsync: async () => ({ ...native.state }),
  getIpAddressAsync: async () => {
    native.reads += 1;
    const address = native.address;
    for (const waiter of readWaiters.filter((item) => native.reads >= item.count)) {
      readWaiters.splice(readWaiters.indexOf(waiter), 1);
      setImmediate(waiter.resolve);
    }
    return address;
  },
}));
mock.module("react-native", () => ({
  AppState: {
    addEventListener: (_event: string, listener: (state: string) => void) => {
      appStateListeners.add(listener);
      return { remove: () => appStateListeners.delete(listener) };
    },
  },
}));
type SubscribeNetworkMoves = (listener: (change: NetworkChange) => void) => () => void;

function isNetworkPathModule(value: unknown): value is { subscribeNetworkMoves: SubscribeNetworkMoves } {
  return (
    typeof value === "object" &&
    value !== null &&
    "subscribeNetworkMoves" in value &&
    typeof value.subscribeNetworkMoves === "function"
  );
}

const NETWORK_PATH_MODULE = join(ROOT, "apps", "mobile", "src", "shared", "lib", "network-path.ts");
const networkPath = await import(NETWORK_PATH_MODULE);
if (!isNetworkPathModule(networkPath)) throw new Error("network-path.ts does not export subscribeNetworkMoves.");
const { subscribeNetworkMoves } = networkPath;

function addressRead(): Promise<void> {
  const count = native.reads + 1;
  return new Promise((resolve) => readWaiters.push({ count, resolve }));
}

function within<T>(promise: Promise<T>, limitMs: number): Promise<T | null> {
  return Promise.race([promise, new Promise<null>((resolve) => setTimeout(() => resolve(null), limitMs))]);
}

interface NetworkStep {
  type: string;
  address: string;
  connected?: boolean;
  via?: "listener" | "return";
}

interface NetworkScenario {
  name: string;
  steps: [NetworkStep, ...NetworkStep[]];
  expected: NetworkChange | null;
}

async function applyStep(step: NetworkStep) {
  native.state = { type: step.type, isConnected: step.connected ?? true };
  native.address = step.address;
  const read = step.connected === false ? Promise.resolve() : addressRead();
  if (step.via === "return") for (const listener of appStateListeners) listener("active");
  else for (const listener of networkListeners) listener({ ...native.state });
  await read;
}

async function runNetworkScenario(scenario: NetworkScenario) {
  const [first, ...rest] = scenario.steps;
  native.state = { type: first.type, isConnected: true };
  native.address = first.address;
  const events: { change: NetworkChange; afterLastStepMs: number }[] = [];
  const firstEvent = settled<void>();
  let lastStepAt = performance.now();
  const initialRead = addressRead();
  const unsubscribe = subscribeNetworkMoves((change) => {
    events.push({ change, afterLastStepMs: Math.round(performance.now() - lastStepAt) });
    firstEvent.resolve();
  });
  await initialRead;
  for (const step of rest) {
    lastStepAt = performance.now();
    await applyStep(step);
  }
  await within(firstEvent.promise, NETWORK_EVENT_LIMIT_MS);
  await within(new Promise<never>(() => {}), NETWORK_QUIET_MS);
  unsubscribe();
  return { name: scenario.name, expected: scenario.expected, events };
}

async function networkScenarios() {
  const wifi = (address: string): NetworkStep => ({ type: "WIFI", address });
  const home = wifi("192.168.1.20");
  const scenarios: NetworkScenario[] = [
    { name: "Wi-Fi to mobile data", steps: [home, { type: "CELLULAR", address: "0.0.0.0" }], expected: "moved" },
    { name: "iOS VPN turns on", steps: [home, { type: "UNKNOWN", address: "192.168.1.20" }], expected: "changed" },
    { name: "Android VPN turns off", steps: [{ type: "VPN", address: "100.101.4.9" }, home], expected: "changed" },
    {
      name: "iOS VPN on, Wi-Fi to mobile data",
      steps: [
        { type: "UNKNOWN", address: "192.168.1.20" },
        { type: "UNKNOWN", address: "0.0.0.0" },
      ],
      expected: "changed",
    },
    {
      name: "iOS VPN on, mobile data to Wi-Fi",
      steps: [
        { type: "UNKNOWN", address: "0.0.0.0" },
        { type: "UNKNOWN", address: "192.168.1.20" },
      ],
      expected: "changed",
    },
    {
      name: "Android VPN on, same tunnel address",
      steps: [
        { type: "VPN", address: "100.101.4.9" },
        { type: "VPN", address: "100.101.4.9" },
      ],
      expected: null,
    },
    { name: "another Wi-Fi network", steps: [home, wifi("10.0.0.31")], expected: "moved" },
    { name: "signal strength only", steps: [home, home], expected: null },
    {
      name: "no address while roaming, then another Wi-Fi",
      steps: [home, wifi("0.0.0.0"), wifi("10.0.0.31")],
      expected: "moved",
    },
    {
      name: "VPN flaps three times in one second",
      steps: [home, { type: "UNKNOWN", address: "192.168.1.20" }, home, { type: "UNKNOWN", address: "192.168.1.20" }],
      expected: "changed",
    },
    {
      name: "Wi-Fi drops and comes back",
      steps: [home, { type: "NONE", address: "0.0.0.0", connected: false }, home],
      expected: null,
    },
    {
      name: "mobile data seen at the return to the app",
      steps: [home, { type: "CELLULAR", address: "0.0.0.0", via: "return" }],
      expected: "moved",
    },
  ];
  const results = [];
  for (const scenario of scenarios) results.push(await runNetworkScenario(scenario));
  return results;
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

  const growing = await growingCooldown();
  const doubled = (REMOTE_RETRY_COOLDOWN_MS * 2) / 1000;
  check(
    `the second cooldown is about ${doubled} s`,
    growing.secondSeconds >= doubled && growing.secondSeconds <= Math.ceil(doubled * (1 + JITTER)),
    growing,
  );
  check(
    `a refresh starts the cooldown again at ${REMOTE_RETRY_COOLDOWN_MS / 1000} s`,
    growing.afterRefreshSeconds >= REMOTE_RETRY_COOLDOWN_MS / 1000 &&
      growing.afterRefreshSeconds <= Math.ceil((REMOTE_RETRY_COOLDOWN_MS * (1 + JITTER)) / 1000),
    growing,
  );

  const network = await networkScenarios();
  for (const scenario of network) {
    const changes = scenario.events.map((event) => event.change);
    const expected = scenario.expected === null ? [] : [scenario.expected];
    check(
      `network: ${scenario.name} sends ${scenario.expected ?? "nothing"}`,
      JSON.stringify(changes) === JSON.stringify(expected),
      scenario.events,
    );
    const delay = scenario.events[0]?.afterLastStepMs;
    if (scenario.expected === "moved")
      check(`network: ${scenario.name} goes at once`, delay !== undefined && delay < MOVE_LIMIT_MS, { delay });
    if (scenario.expected === "changed")
      check(
        `network: ${scenario.name} waits about 1 s`,
        delay !== undefined && delay >= CHANGE_SETTLE_MS - 50 && delay < CHANGE_SETTLE_MS + MOVE_LIMIT_MS,
        { delay },
      );
  }

  const passed = checks.every((item) => item.passed);
  const report = {
    status: passed ? "passed" : "failed",
    retryDelaysMs: REMOTE_RETRY_DELAYS_MS,
    cooldownMs: REMOTE_RETRY_COOLDOWN_MS,
    cooldownMaxMs: REMOTE_RETRY_COOLDOWN_MAX_MS,
    growing,
    recovery: {
      attemptsAtMs: recovery.attempts.map(Math.round),
      gapsMs: gaps.map(Math.round),
      onlineAfterMs: Math.round(recovery.onlineAfterMs),
    },
    network,
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
