import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ScheduledUpdateRestart, UpdatePreference, UpdateStatus } from "@openbot/contracts/ipc";
import type { HostRestartState } from "@openbot/contracts/team-protocol/host-update-v1";
import { createOpenBotLogger } from "@openbot/logging";
import { Effect } from "effect";
import { RequestedUpdate } from "../src/main/requested-update";
import { checkRestartReadiness, type RestartReadinessInput } from "../src/main/update-readiness";

const logger = createOpenBotLogger("hosted-update-idle-wait-e2e");
const OUT = resolve(import.meta.dirname, "../.openbot-build/hosted-update-idle-wait-e2e");
const RELEASE = "0.99.0";
const POLL_MS = 20;
const MAXIMUM_WAIT_MS = 400;
const POLLS_PAST_MAXIMUM = 10;
const DEADLINE_MS = 20_000;

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

class StagedReleaseUpdater extends EventEmitter {
  status: UpdateStatus = {
    phase: "ready",
    currentVersion: "0.98.0",
    availableVersion: RELEASE,
    progress: null,
    checkedAt: null,
    message: null,
    errorCode: null,
  };
  installs = 0;
  #set(change: Partial<UpdateStatus>): void {
    this.status = { ...this.status, ...change };
    this.emit("status", this.status);
  }
  getStatus = () => this.status;
  checkForUpdates = () => Effect.sync(() => this.status);
  downloadUpdate = () => Effect.sync(() => this.status);
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

interface HostState {
  agentTurn: boolean;
  browserView: boolean;
  remoteDesktop: boolean;
  browserControls: number;
  providerIdleWait: boolean;
  providerOperation: boolean;
  clientInUse: boolean;
}

function readinessInput(state: HostState): RestartReadinessInput {
  return {
    agentWork: [
      ...(state.agentTurn ? ["agent-turn"] : []),
      ...(state.providerIdleWait || state.providerOperation ? ["provider-process"] : []),
    ],
    hostBlockers: [...(state.remoteDesktop ? ["remote-desktop"] : []), ...(state.browserView ? ["browser-view"] : [])],
    activeBrowserControls: state.browserControls,
    activeFileTransfers: false,
    updaterBusy: false,
    initializationPending: false,
  };
}

function hostedServer(state: HostState, maximumWaitMs: number | null) {
  const updater = new StagedReleaseUpdater();
  const log: string[] = [];
  const announced: HostRestartState[] = [];
  let readinessChecks = 0;
  const preference: UpdatePreference = { autoDownload: true, allowRemoteUpdates: true, autoInstall: false };
  const requested = new RequestedUpdate({
    updater,
    describeReadiness: () => {
      readinessChecks += 1;
      return checkRestartReadiness(readinessInput(state));
    },
    preference,
    savePreference: () => Effect.succeed(preference),
    log: (message) => {
      log.push(message);
      logger.info(message);
    },
    announce: (restartState) => announced.push(restartState),
    pollMs: POLL_MS,
    graceMs: 0,
    clientInUse: () => state.clientInUse,
    maximumIdleWait:
      maximumWaitMs === null
        ? undefined
        : { afterMs: maximumWaitMs, providerOperationPending: () => state.providerOperation },
  });
  return { updater, requested, log, announced, readinessChecks: () => readinessChecks };
}

async function until(label: string, done: () => boolean): Promise<void> {
  const deadline = Date.now() + DEADLINE_MS;
  while (!done()) {
    if (Date.now() > deadline) throw new Error(`Timed out while waiting for ${label}.`);
    await new Promise((next) => setImmediate(next));
  }
}

async function morePolls(server: ReturnType<typeof hostedServer>, count: number): Promise<void> {
  const target = server.readinessChecks() + count;
  await until(`${count} more readiness checks`, () => server.readinessChecks() >= target);
}

const hasLine = (log: string[], text: string) => log.some((line) => line.includes(text));

const softAndHard: HostState = {
  agentTurn: true,
  browserView: true,
  remoteDesktop: true,
  browserControls: 1,
  providerIdleWait: true,
  providerOperation: false,
  clientInUse: true,
};
const hosted = hostedServer(softAndHard, MAXIMUM_WAIT_MS);
const allReasons = "agent-turn, provider-process, remote-desktop, browser-view, browser-control, client-use";
await until("the logged wait reasons", () => hasLine(hosted.log, `waits for: ${allReasons}.`));
assert.deepEqual(hosted.updater.status.scheduledRestart?.waitingFor, allReasons.split(", "));
softAndHard.clientInUse = false;
await until("the logged change of wait reasons", () =>
  hasLine(hosted.log, "waits for: agent-turn, provider-process, remote-desktop, browser-view, browser-control."),
);
softAndHard.clientInUse = true;
await until("the end of the maximum wait", () => hasLine(hosted.log, "It now waits only for"));
await morePolls(hosted, POLLS_PAST_MAXIMUM);
assert.equal(hosted.updater.installs, 0, "The release installed while an agent turn ran.");
assert.deepEqual(hosted.updater.status.scheduledRestart?.waitingFor, ["agent-turn"]);
assert.ok(hasLine(hosted.log, "waits for: agent-turn."), "The reduced wait reasons were not logged.");
softAndHard.agentTurn = false;
await until("the install that ignores soft blockers", () => hosted.updater.installs === 1);
assert.ok(
  hasLine(hosted.log, "It ignored: provider-process, remote-desktop, browser-view, browser-control, client-use."),
  "The end of the wait was not logged with the ignored reasons.",
);
assert.ok(hosted.log.some((line) => /stopped waiting after \d+ s\./.test(line)));
assert.deepEqual(hosted.announced, ["waiting", "restarting"]);
await Effect.runPromise(hosted.requested.dispose());

const providerState: HostState = {
  agentTurn: false,
  browserView: true,
  remoteDesktop: false,
  browserControls: 0,
  providerIdleWait: false,
  providerOperation: true,
  clientInUse: false,
};
const provider = hostedServer(providerState, MAXIMUM_WAIT_MS);
await until("the end of the maximum wait", () => hasLine(provider.log, "It now waits only for"));
await morePolls(provider, POLLS_PAST_MAXIMUM);
assert.equal(provider.updater.installs, 0, "The release installed while a provider CLI was replaced.");
providerState.providerOperation = false;
await until("the install after the provider operation", () => provider.updater.installs === 1);
await Effect.runPromise(provider.requested.dispose());

const unlimitedState: HostState = { ...providerState, providerOperation: false, browserView: true };
const unlimited = hostedServer(unlimitedState, null);
await until("the logged wait without a maximum", () => hasLine(unlimited.log, "waits for: browser-view."));
await morePolls(unlimited, (MAXIMUM_WAIT_MS / POLL_MS) * 2);
assert.equal(unlimited.updater.installs, 0, "A schedule without a maximum wait ignored a browser view.");
assert.ok(!hasLine(unlimited.log, "It now waits only for"));
unlimitedState.browserView = false;
await until("the install after the browser view closed", () => unlimited.updater.installs === 1);
await Effect.runPromise(unlimited.requested.dispose());

const report = {
  ok: true,
  checkedAt: new Date().toISOString(),
  maximumWaitMs: MAXIMUM_WAIT_MS,
  pollMs: POLL_MS,
  hosted: { installs: hosted.updater.installs, announced: hosted.announced, log: hosted.log },
  providerOperation: { installs: provider.updater.installs, log: provider.log },
  withoutMaximum: { installs: unlimited.updater.installs, log: unlimited.log },
};
writeFileSync(resolve(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
logger.info(`Passed. Report: ${resolve(OUT, "report.json")}`);
