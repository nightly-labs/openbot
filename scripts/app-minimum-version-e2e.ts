// End-to-end check of the minimum app version (plan 011, item 24).
//   bun scripts/app-minimum-version-e2e.ts
// 1. The rule: `resolveAppMinimumVersion` on fixed releases and fixed days (window edge, over-the-air
//    versions, store dates, no release old enough).
// 2. The routes: starts the site's development server on a free port, reads
//    `/v1/app/minimum-version` for each surface and `/v1/mobile/features`, and compares them with the
//    rule on the real CHANGELOG.md files.
// 3. The desktop and host client: `RequiredUpdate` against the real route (below and above the
//    minimum), against a closed port and a failing answer (never blocks, keeps the last state), and
//    `RequestedUpdate` with a required update: it checks, downloads, and does not install while an
//    agent turn runs.
// Writes .openbot-build/app-minimum-version-e2e/report.json.
import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { resolve } from "node:path";
import {
  APP_MINIMUM_VERSION_PATH,
  APP_SURFACES,
  isBelowMinimumVersion,
  parseAppMinimumVersion,
} from "@openbot/contracts/app-minimum-version";
import type { ScheduledUpdateRestart, UpdatePreference, UpdateStatus } from "@openbot/contracts/ipc";
import { createOpenBotLogger } from "@openbot/logging";
import { Effect } from "effect";
import { type ChangelogPlatform, type ChangelogRelease, parseChangelog } from "../apps/auth-api/src/lib/changelog";
import { resolveAppMinimumVersion } from "../apps/auth-api/src/server/app-minimum-version";
import { RequestedUpdate } from "../src/main/requested-update";
import { RequiredUpdate, type RequiredUpdateFetch, type RequiredUpdateOutcome } from "../src/main/required-update";

const logger = createOpenBotLogger("app-minimum-version-e2e");
const ROOT = resolve(import.meta.dirname, "..");
const OUT = resolve(ROOT, ".openbot-build/app-minimum-version-e2e");
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// 1. The rule ----------------------------------------------------------------------
function release(version: string, date: string, stores: ChangelogRelease["stores"] = []): ChangelogRelease {
  return { version, date, stores, anchor: "", intro: [], notices: [], groups: [] };
}
const FIXTURE: Record<ChangelogPlatform, ChangelogRelease[]> = {
  desktop: [
    release("0.70.0", "2026-11-10"),
    release("0.60.0", "2026-09-20"),
    release("0.58.1", "2026-09-18"),
    release("0.58.0", "2026-09-10"),
    release("0.57.0", ""),
  ],
  mobile: [
    // An over-the-air version never counts, even with a date: the phone reports its store version.
    release("1.3.0.1", "2026-08-01", [{ store: "ios", date: "2026-08-01", skipped: false }]),
    release("1.3.0", "2026-09-01", [
      { store: "android", date: "2026-09-01", skipped: false },
      { store: "ios", date: "2026-09-25", skipped: false },
    ]),
    release("1.2.0", "2026-08-15", [
      { store: "android", date: "2026-08-15", skipped: false },
      { store: "ios", date: "2026-08-15", skipped: false },
    ]),
  ],
};
const day = (iso: string) => Date.parse(`${iso}T12:00:00.000Z`);
const ruleCases = [
  // 60 days before 2026-11-17 is 2026-09-18: a release of that day is the minimum.
  { surface: "desktop", now: "2026-11-17", expected: "0.58.1" },
  { surface: "host", now: "2026-11-16", expected: "0.58.0" },
  { surface: "desktop", now: "2026-11-08", expected: null },
  { surface: "android", now: "2026-11-17", expected: "1.3.0" },
  // iOS had 1.3.0 only on 2026-09-25, after the first day of its window.
  { surface: "ios", now: "2026-11-17", expected: "1.2.0" },
  { surface: "ios", now: "2026-10-01", expected: null },
] as const;
const rule = ruleCases.map((testCase) => {
  const actual = resolveAppMinimumVersion(FIXTURE, testCase.surface, day(testCase.now));
  assert.equal(actual, testCase.expected, `${testCase.surface} on ${testCase.now}`);
  return { ...testCase, actual };
});

const decisions = [
  { current: "0.40.0", minimum: "0.58.0", below: true },
  { current: "0.58.0", minimum: "0.58.0", below: false },
  { current: "0.71.0", minimum: "0.58.0", below: false },
  { current: "0.40.0", minimum: null, below: false },
  // A development version that cannot be read never blocks.
  { current: "dev", minimum: "0.58.0", below: false },
] as const;
for (const decision of decisions) {
  assert.equal(isBelowMinimumVersion(decision.current, decision.minimum), decision.below, JSON.stringify(decision));
}
assert.equal(parseAppMinimumVersion({ minimumVersion: 5 }), null);
assert.equal(parseAppMinimumVersion({ minimumVersion: "not a version" }), null);
assert.equal(parseAppMinimumVersion(null), null);

// 2. The routes --------------------------------------------------------------------
const REAL: Record<ChangelogPlatform, readonly ChangelogRelease[]> = {
  desktop: parseChangelog(readFileSync(resolve(ROOT, "CHANGELOG.md"), "utf8")),
  mobile: parseChangelog(readFileSync(resolve(ROOT, "apps/mobile/CHANGELOG.md"), "utf8"), {
    anchorPrefix: "mobile-",
    stores: true,
  }),
};

const freePort = () =>
  new Promise<number>((done, fail) => {
    const server = createServer();
    server.once("error", fail);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert.ok(address && typeof address === "object");
      server.close(() => done(address.port));
    });
  });

/** Resolves once Vite prints the address it listens on, or rejects when the server exits first. */
function waitForSite(child: ChildProcess, address: string): Promise<void> {
  return new Promise((done, fail) => {
    let output = "";
    const read = (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes(address)) done();
    };
    child.stdout?.on("data", read);
    child.stderr?.on("data", read);
    child.once("exit", () => fail(new Error("The site's development server stopped before it listened.")));
  });
}

const port = await freePort();
const site = spawn(
  process.execPath,
  [resolve(ROOT, "scripts/run-development.ts"), "api", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
  { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] },
);
let siteOutput = "";
site.stdout?.on("data", (chunk: Buffer) => {
  siteOutput += chunk.toString();
});
site.stderr?.on("data", (chunk: Buffer) => {
  siteOutput += chunk.toString();
});
const origin = `http://127.0.0.1:${port}`;

/** A fake updater with the parts of `UpdateService` that the two classes use. */
class FakeUpdater extends EventEmitter {
  status: UpdateStatus;
  requiredVersions: (string | null)[] = [];
  installs = 0;
  constructor(currentVersion: string) {
    super();
    this.status = {
      phase: "up-to-date",
      currentVersion,
      availableVersion: null,
      progress: null,
      checkedAt: null,
      message: null,
      errorCode: null,
    };
  }
  #set(change: Partial<UpdateStatus>): UpdateStatus {
    this.status = { ...this.status, ...change };
    this.emit("status", this.status);
    return this.status;
  }
  getStatus = () => this.status;
  setRequiredVersion = (version: string | null) => {
    this.requiredVersions.push(version);
    if (version === null) {
      const { requiredVersion: _cleared, ...rest } = this.status;
      this.status = rest;
    } else this.#set({ requiredVersion: version });
  };
  checkForUpdates = () => Effect.sync(() => this.#set({ phase: "available", availableVersion: "0.99.0" }));
  downloadUpdate = () => Effect.sync(() => this.#set({ phase: "ready" }));
  installUpdate = () =>
    Effect.sync(() => {
      this.installs += 1;
      this.#set({ phase: "installing" });
    });
  setScheduledRestart = (restart: ScheduledUpdateRestart | null) => {
    if (restart) this.#set({ scheduledRestart: restart });
    else {
      const { scheduledRestart: _cleared, ...rest } = this.status;
      this.#set(rest);
    }
  };
  getAutoDownload = () => true;
  setAutoDownload = () => Effect.void;
}

/** Resolves when a status of `updater` meets `done`. It rejects after 10 s so a broken flow cannot hang. */
function waitForStatus(updater: FakeUpdater, label: string, done: (status: UpdateStatus) => boolean) {
  return new Promise<UpdateStatus>((resolveStatus, reject) => {
    if (done(updater.status)) {
      resolveStatus(updater.status);
      return;
    }
    const timeout = setTimeout(() => {
      updater.off("status", listener);
      reject(new Error(`Timed out waiting for: ${label}. Last status: ${JSON.stringify(updater.status)}`));
    }, 10_000);
    const listener = (status: UpdateStatus) => {
      if (!done(status)) return;
      clearTimeout(timeout);
      updater.off("status", listener);
      resolveStatus(status);
    };
    updater.on("status", listener);
  });
}

function requiredUpdate(
  updater: FakeUpdater,
  apiOrigin: string,
  setRequired: (required: boolean) => void,
  fetchOverride?: RequiredUpdateFetch,
) {
  const logs: string[] = [];
  const instance = new RequiredUpdate({
    surface: "desktop",
    currentVersion: updater.status.currentVersion,
    resolveApiUrl: (path) => new URL(path, apiOrigin).toString(),
    updater,
    setRequired,
    log: (line) => logs.push(line),
    ...(fetchOverride ? { fetch: fetchOverride } : {}),
  });
  return { instance, logs };
}

try {
  await waitForSite(site, origin);

  const routes: { surface: string; minimumVersion: string | null; expected: string | null }[] = [];
  for (const surface of APP_SURFACES) {
    const response = await fetch(`${origin}${APP_MINIMUM_VERSION_PATH}?surface=${surface}`);
    assert.equal(response.status, 200, surface);
    assert.match(response.headers.get("cache-control") ?? "", /max-age=3600/u);
    const minimumVersion = parseAppMinimumVersion(await response.json());
    const expected = resolveAppMinimumVersion(REAL, surface, Date.now());
    assert.equal(minimumVersion, expected, surface);
    routes.push({ surface, minimumVersion, expected });
  }
  const unknown = await (await fetch(`${origin}${APP_MINIMUM_VERSION_PATH}?surface=tablet`)).json();
  assert.deepEqual(unknown, { minimumVersion: null });

  const mobile: { platform: string; minimumVersion: string | null; blocksVersion0: boolean }[] = [];
  for (const platform of ["ios", "android"] as const) {
    const minimumVersion = parseAppMinimumVersion(
      await (await fetch(`${origin}/v1/mobile/features?platform=${platform}&version=1.0.0`)).json(),
    );
    assert.equal(minimumVersion, resolveAppMinimumVersion(REAL, platform, Date.now()), platform);
    // The decision of the phone overlay for a store version 0.0.1.
    mobile.push({ platform, minimumVersion, blocksVersion0: isBelowMinimumVersion("0.0.1", minimumVersion) });
  }
  const desktopMinimum = routes.find((route) => route.surface === "desktop")?.minimumVersion ?? null;
  assert.ok(desktopMinimum, "The desktop changelog has releases older than 60 days, so there is a minimum.");

  // 3. The client ------------------------------------------------------------------
  // Below the minimum: the status names it, and the install by itself turns on.
  const old = new FakeUpdater("0.0.1");
  const oldRequired: boolean[] = [];
  const below = requiredUpdate(old, origin, (required) => oldRequired.push(required));
  const belowOutcome: RequiredUpdateOutcome = await Effect.runPromise(below.instance.check());
  assert.equal(belowOutcome.kind, "required");
  assert.equal(old.status.requiredVersion, desktopMinimum);
  assert.deepEqual(oldRequired, [true]);

  // Offline afterwards: the state stays, nothing is unblocked or blocked.
  const closedPort = await freePort();
  const offline = requiredUpdate(old, `http://127.0.0.1:${closedPort}`, (required) => oldRequired.push(required));
  const offlineOutcome = await Effect.runPromise(offline.instance.check());
  assert.equal(offlineOutcome.kind, "unknown");
  assert.equal(old.status.requiredVersion, desktopMinimum);
  assert.deepEqual(oldRequired, [true]);
  assert.ok(offline.logs.some((line) => line.startsWith("The minimum version check failed")));
  const belowReport = { outcome: belowOutcome, requiredVersion: old.status.requiredVersion, logs: below.logs };
  const offlineAfterRequiredReport = { outcome: offlineOutcome, requiredVersion: old.status.requiredVersion };

  // Never confirmed: an offline app, an error answer and a damaged answer do not block.
  const fresh = new FakeUpdater("0.0.1");
  const freshRequired: boolean[] = [];
  const offlineFresh = requiredUpdate(fresh, `http://127.0.0.1:${closedPort}`, (r) => freshRequired.push(r));
  assert.equal((await Effect.runPromise(offlineFresh.instance.check())).kind, "unknown");
  const failing = requiredUpdate(
    fresh,
    origin,
    (r) => freshRequired.push(r),
    async () => new Response("", { status: 503 }),
  );
  assert.equal((await Effect.runPromise(failing.instance.check())).kind, "unknown");
  const damaged = requiredUpdate(
    fresh,
    origin,
    (r) => freshRequired.push(r),
    async () => Response.json({ minimumVersion: { major: 99 } }),
  );
  assert.equal((await Effect.runPromise(damaged.instance.check())).kind, "supported");
  assert.equal(fresh.status.requiredVersion, undefined);
  assert.deepEqual(freshRequired, []);
  const neverConfirmedReport = {
    requiredVersion: fresh.status.requiredVersion ?? null,
    setRequiredCalls: freshRequired,
  };

  // Above the minimum: nothing changes.
  const current = new FakeUpdater("999.0.0");
  const currentRequired: boolean[] = [];
  const above = requiredUpdate(current, origin, (r) => currentRequired.push(r));
  assert.equal((await Effect.runPromise(above.instance.check())).kind, "supported");
  assert.equal(current.status.requiredVersion, undefined);
  assert.deepEqual(currentRequired, []);
  const aboveReport = { requiredVersion: current.status.requiredVersion ?? null };

  // A tenant whose host manages updates is never blocked by this check.
  const tenant = new FakeUpdater("0.0.1");
  tenant.status = { ...tenant.status, managedByHost: true };
  const tenantRequired: boolean[] = [];
  assert.equal(
    (await Effect.runPromise(requiredUpdate(tenant, origin, (r) => tenantRequired.push(r)).instance.check())).kind,
    "supported",
  );
  assert.deepEqual(tenantRequired, []);

  // The required install waits for the agent turn, then installs.
  const host = new FakeUpdater("0.0.1");
  let agentTurn = true;
  const preference: UpdatePreference = { autoDownload: true, allowRemoteUpdates: true, autoInstall: false };
  const requested = new RequestedUpdate({
    updater: host,
    describeReadiness: () => ({ safeToRestart: !agentTurn, reasons: agentTurn ? ["agent-turn"] : [] }),
    preference,
    savePreference: () => Effect.succeed(preference),
    log: () => undefined,
    pollMs: 20,
    graceMs: 0,
  });
  const hostCheck = requiredUpdate(host, origin, (required) => requested.setRequired(required));
  assert.equal((await Effect.runPromise(hostCheck.instance.check())).kind, "required");
  const waiting = await waitForStatus(
    host,
    "a when-idle restart that waits for the agent turn",
    (status) => status.phase === "ready" && status.scheduledRestart?.waitingFor.includes("agent-turn") === true,
  );
  assert.equal(host.installs, 0, "The required update installed while an agent turn ran.");
  agentTurn = false;
  await waitForStatus(host, "the install after the turn", (status) => status.phase === "installing");
  assert.equal(host.installs, 1);
  const installAfterTurnReport = {
    waitedFor: waiting.scheduledRestart?.waitingFor ?? [],
    mode: waiting.scheduledRestart?.mode ?? null,
    installs: host.installs,
  };
  await Effect.runPromise(requested.dispose());
  for (const instance of [below, offline, offlineFresh, failing, damaged, above, hostCheck]) {
    await Effect.runPromise(instance.instance.dispose());
  }

  const client = {
    below: belowReport,
    offlineAfterRequired: offlineAfterRequiredReport,
    neverConfirmed: neverConfirmedReport,
    above: aboveReport,
    installAfterTurn: installAfterTurnReport,
  };
  const report = { ok: true, checkedAt: new Date().toISOString(), rule, decisions, routes, mobile, client };
  writeFileSync(resolve(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  logger.info(`Passed. Report: ${resolve(OUT, "report.json")}`);
} catch (error) {
  writeFileSync(resolve(OUT, "site-output.log"), siteOutput);
  throw error;
} finally {
  const exited = new Promise<void>((done) => (site.exitCode === null ? site.once("exit", () => done()) : done()));
  site.kill("SIGTERM");
  await exited;
}
