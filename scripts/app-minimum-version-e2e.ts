import assert from "node:assert/strict";
import { spawn } from "node:child_process";
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
import { type ChangelogRelease, parseChangelog } from "../apps/auth-api/src/lib/changelog";
import { APP_MINIMUM_VERSIONS } from "../apps/auth-api/src/server/app-minimum-version";
import { RequestedUpdate } from "../src/main/requested-update";
import { RequiredUpdate, type RequiredUpdateFetch } from "../src/main/required-update";
import { appMinimumVersionProblems } from "./check-app-minimum-version";

const logger = createOpenBotLogger("app-minimum-version-e2e");
const ROOT = resolve(import.meta.dirname, "..");
const OUT = resolve(ROOT, ".openbot-build/app-minimum-version-e2e");
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

function release(version: string, date: string, stores: ChangelogRelease["stores"] = []): ChangelogRelease {
  return { version, date, stores, anchor: "", intro: [], notices: [], groups: [] };
}
const FIXTURE = {
  desktop: [release("0.70.0", "2026-11-10"), release("0.58.0", "2026-09-18")],
  mobile: [
    release("1.3.0.1", "2026-08-01", [{ store: "ios", date: "2026-08-01", skipped: false }]),
    release("1.3.0", "2026-09-01", [
      { store: "android", date: "2026-09-01", skipped: false },
      { store: "ios", date: "2026-09-25", skipped: false },
    ]),
  ],
};
const NONE = { desktop: null, host: null, ios: null, android: null };
const checkCases = [
  { versions: NONE, problems: 0 },
  { versions: { ...NONE, desktop: "0.58.0", host: "0.58.0", android: "1.3.0" }, problems: 0 },
  { versions: { ...NONE, desktop: "0.70.0" }, problems: 1 },
  { versions: { ...NONE, host: "0.59.0" }, problems: 1 },
  { versions: { ...NONE, ios: "1.3.0" }, problems: 1 },
  { versions: { ...NONE, ios: "1.3.0.1" }, problems: 1 },
];
const check = checkCases.map((testCase) => {
  const problems = appMinimumVersionProblems(testCase.versions, FIXTURE, "2026-11-17");
  assert.equal(problems.length, testCase.problems, JSON.stringify({ testCase, problems }));
  return { versions: testCase.versions, problems };
});
const real = {
  desktop: parseChangelog(readFileSync(resolve(ROOT, "CHANGELOG.md"), "utf8")),
  mobile: parseChangelog(readFileSync(resolve(ROOT, "apps/mobile/CHANGELOG.md"), "utf8"), { stores: true }),
};
assert.deepEqual(appMinimumVersionProblems(APP_MINIMUM_VERSIONS, real, new Date().toISOString().slice(0, 10)), []);

const decisions = [
  { current: "0.40.0", minimum: "0.58.0", below: true },
  { current: "0.58.0", minimum: "0.58.0", below: false },
  { current: "0.40.0", minimum: null, below: false },
  { current: "dev", minimum: "0.58.0", below: false },
] as const;
for (const decision of decisions) {
  assert.equal(isBelowMinimumVersion(decision.current, decision.minimum), decision.below, JSON.stringify(decision));
}
assert.equal(parseAppMinimumVersion({ minimumVersion: 5 }), null);
assert.equal(parseAppMinimumVersion({ minimumVersion: "not a version" }), null);

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

const port = await freePort();
const origin = `http://127.0.0.1:${port}`;
const site = spawn(
  process.execPath,
  [resolve(ROOT, "scripts/run-development.ts"), "api", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
  { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] },
);
let siteOutput = "";
const siteReady = new Promise<void>((done, fail) => {
  const read = (chunk: Buffer) => {
    siteOutput += chunk.toString();
    if (siteOutput.includes(origin)) done();
  };
  site.stdout?.on("data", read);
  site.stderr?.on("data", read);
  site.once("exit", () => fail(new Error("The site's development server stopped before it listened.")));
});

class FakeUpdater extends EventEmitter {
  status: UpdateStatus;
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
  return new RequiredUpdate({
    surface: "desktop",
    currentVersion: updater.status.currentVersion,
    resolveApiUrl: (path) => new URL(path, apiOrigin).toString(),
    updater,
    setRequired,
    log: () => undefined,
    ...(fetchOverride ? { fetch: fetchOverride } : {}),
  });
}
const answer =
  (body: unknown, status = 200): RequiredUpdateFetch =>
  async () =>
    Response.json(body, { status });
const MINIMUM = "0.58.0";

try {
  await siteReady;

  const routes: { surface: string; minimumVersion: string | null }[] = [];
  for (const surface of APP_SURFACES) {
    const response = await fetch(`${origin}${APP_MINIMUM_VERSION_PATH}?surface=${surface}`);
    assert.equal(response.status, 200, surface);
    const body = await response.json();
    assert.deepEqual(body, { minimumVersion: APP_MINIMUM_VERSIONS[surface] }, surface);
    routes.push({ surface, ...body });
  }
  assert.deepEqual(await (await fetch(`${origin}${APP_MINIMUM_VERSION_PATH}?surface=tablet`)).json(), {
    minimumVersion: null,
  });
  for (const platform of ["ios", "android"] as const) {
    const body = await (await fetch(`${origin}/v1/mobile/features?platform=${platform}&version=1.0.0`)).json();
    assert.equal(body.minimumVersion, APP_MINIMUM_VERSIONS[platform], platform);
    routes.push({ surface: `features:${platform}`, minimumVersion: body.minimumVersion });
  }

  const run = (instance: RequiredUpdate) => Effect.runPromise(instance.check());
  const closedPort = await freePort();
  const closed = `http://127.0.0.1:${closedPort}`;

  const realApp = new FakeUpdater("0.0.1");
  const realOutcome = await run(requiredUpdate(realApp, origin, () => undefined));
  assert.equal(realOutcome, APP_MINIMUM_VERSIONS.desktop ? "required" : "supported");

  const old = new FakeUpdater("0.0.1");
  const oldRequired: boolean[] = [];
  assert.equal(
    await run(requiredUpdate(old, origin, (r) => oldRequired.push(r), answer({ minimumVersion: MINIMUM }))),
    "required",
  );
  assert.equal(old.status.requiredVersion, MINIMUM);
  assert.equal(await run(requiredUpdate(old, closed, (r) => oldRequired.push(r))), "unknown");
  assert.equal(old.status.requiredVersion, MINIMUM);
  assert.deepEqual(oldRequired, [true]);

  const fresh = new FakeUpdater("0.0.1");
  const freshRequired: boolean[] = [];
  const freshOutcomes = [
    await run(requiredUpdate(fresh, closed, (r) => freshRequired.push(r))),
    await run(requiredUpdate(fresh, origin, (r) => freshRequired.push(r), answer({}, 503))),
    await run(requiredUpdate(fresh, origin, (r) => freshRequired.push(r), answer({ minimumVersion: { major: 99 } }))),
  ];
  assert.deepEqual(freshOutcomes, ["unknown", "unknown", "supported"]);
  assert.equal(fresh.status.requiredVersion, undefined);
  assert.deepEqual(freshRequired, []);

  const tenant = new FakeUpdater("0.0.1");
  tenant.status = { ...tenant.status, managedByHost: true };
  assert.equal(
    await run(requiredUpdate(tenant, origin, () => undefined, answer({ minimumVersion: MINIMUM }))),
    "supported",
  );

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
    automaticSpreadMs: 0,
  });
  const hostCheck = requiredUpdate(host, origin, (r) => requested.setRequired(r), answer({ minimumVersion: MINIMUM }));
  assert.equal(await run(hostCheck), "required");
  const waiting = await waitForStatus(
    host,
    "a when-idle restart that waits for the agent turn",
    (status) => status.phase === "ready" && status.scheduledRestart?.waitingFor.includes("agent-turn") === true,
  );
  assert.equal(host.installs, 0, "The required update installed while an agent turn ran.");
  agentTurn = false;
  await waitForStatus(host, "the install after the turn", (status) => status.phase === "installing");
  assert.equal(host.installs, 1);
  await Effect.runPromise(requested.dispose());

  const report = {
    ok: true,
    checkedAt: new Date().toISOString(),
    check,
    decisions,
    routes,
    client: {
      realRoute: realOutcome,
      belowThenOffline: { requiredVersion: old.status.requiredVersion, setRequired: oldRequired },
      neverConfirmed: freshOutcomes,
      installAfterTurn: { waitedFor: waiting.scheduledRestart?.waitingFor ?? [], installs: host.installs },
    },
  };
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
