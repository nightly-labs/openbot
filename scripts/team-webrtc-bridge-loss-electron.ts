// Electron side of `scripts/team-webrtc-bridge-loss-e2e.ts`. It runs the real `TeamWebRtcBridge` and
// `TeamWebRtcHostGateway` against the local Signal, stops the renderer of the hidden bridge window
// with `forcefullyCrashRenderer()`, and records each case in `resultFile`. Each case has its own
// bridge and host, so the wait of a bridge after repeated losses does not carry over.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Result } from "effect";
import { app, BrowserWindow } from "electron";
import { RemoteWorkflowError } from "../src/main/remote-service-effects";
import { TeamStore } from "../src/main/team-store";
import { TeamWebRtcBridge } from "../src/main/team-webrtc-bridge";
import { TeamWebRtcHostGateway } from "../src/main/team-webrtc-host-gateway";

// The longest wait for one state. It is longer than the 30 s that a host connect waits for Signal,
// so a case that ends on that timeout fails on its own check, not on this wait.
const STATE_TIMEOUT_MS = 45_000;
// The move waits 20 s after the close of the host socket before it asks for a new ticket.
const MOVE_TIMEOUT_MS = 60_000;
// Longer than the first wait of the bridge recovery (1 s) and a ticket request on this computer. A
// check for something that must not occur waits this long.
const SETTLE_MS = 3_000;

interface Config {
  userData: string;
  accountUrl: string;
  signalUrl: string;
  signalUrlAlias: string;
  pageUrl: string;
  preloadPath: string;
  resultFile: string;
}

interface Check {
  name: string;
  passed: boolean;
  evidence: string;
}

function argument(name: string): string {
  const value = process.argv.find((item) => item.startsWith(`--${name}=`));
  if (!value) throw new Error(`Missing --${name}=`);
  return value.slice(name.length + 3);
}

const config: Config = JSON.parse(readFileSync(argument("config"), "utf8"));
const checks: Check[] = [];
// A closed output must not stop the test app with an error dialog.
process.stdout.on("error", () => undefined);
process.stderr.on("error", () => undefined);
app.setPath("userData", config.userData);
// The app keeps running with no window, as OpenBot does in the tray.
app.on("window-all-closed", () => undefined);

function expect(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function check(name: string, run: () => Promise<string>) {
  try {
    checks.push({ name, passed: true, evidence: await run() });
  } catch (error) {
    checks.push({ name, passed: false, evidence: error instanceof Error ? error.message : String(error) });
  }
}

function result<A, E>(effect: Effect.Effect<A, E>) {
  return Effect.runPromise(Effect.result(effect));
}

function failureText(failure: unknown): string {
  if (failure instanceof RemoteWorkflowError && failure.cause instanceof Error) return failure.cause.message;
  return failure instanceof Error ? failure.message : String(failure);
}

async function until<T>(read: () => T | undefined | null | false, what: string, limit = STATE_TIMEOUT_MS) {
  const deadline = Date.now() + limit;
  for (;;) {
    const value = read();
    if (value !== undefined && value !== null && value !== false) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for: ${what}.`);
    await sleep(50);
  }
}

/** Stops or starts Signal through the account service of the run. */
async function signal(action: "stop" | "start") {
  const response = await fetch(`${config.accountUrl}/e2e/signal/${action}`, { method: "POST" });
  expect(response.ok, `the Signal ${action} answered ${response.status}`);
}

async function mint(hostId: string, role: "host" | "member", options: { ttlSeconds?: number; home?: boolean } = {}) {
  const response = await fetch(`${config.accountUrl}/e2e/ticket`, {
    method: "POST",
    body: JSON.stringify({ hostId, role, ...options }),
  });
  expect(response.ok, `the ticket request answered ${response.status}`);
  const answer = await response.json();
  expect(isDynamicRecord(answer) && typeof answer.ticket === "string", "the account service made no ticket");
  return answer.ticket;
}

/** The live windows of the bridge whose page loads under `/<owner>/`. */
function windowsOf(owner: string): BrowserWindow[] {
  return BrowserWindow.getAllWindows().filter(
    (window) => !window.isDestroyed() && window.webContents.getURL().includes(`/${owner}/`),
  );
}

/** One host: its bridge, its gateway, and what they reported. */
class Host {
  readonly bridge: TeamWebRtcBridge;
  readonly gateway: TeamWebRtcHostGateway;
  ready = 0;
  readonly lost: string[] = [];
  readonly failures: string[] = [];
  readonly renewals: string[] = [];
  quitting = false;
  renewalUrl = config.signalUrl;
  renewalHome = false;
  /** Holds the next renewal until `release`. */
  gate: { requested: boolean; release: (ok: boolean) => void; outcome: Promise<boolean> } | null = null;

  constructor(readonly hostId: string) {
    this.bridge = new TeamWebRtcBridge({
      developmentUrl: `${config.pageUrl}/${hostId}`,
      preloadPath: config.preloadPath,
      quitting: () => this.quitting,
    });
    this.bridge.on("signalReady", (peerId) => {
      if (peerId === hostId) this.ready += 1;
    });
    this.bridge.on("disconnected", (peerId, bridgeLost) => {
      if (bridgeLost) this.lost.push(peerId);
    });
    this.gateway = new TeamWebRtcHostGateway({
      bridge: this.bridge,
      store: new TeamStore(join(config.userData, `${hostId}.json`)),
      appVersion: "0.0.0-e2e",
      transferDirectory: join(config.userData, hostId, "transfers"),
      renewSignal: (renewedHostId) =>
        Effect.tryPromise({
          try: () => this.#renew(renewedHostId),
          catch: (cause) => new RemoteWorkflowError({ cause }),
        }),
      onSignalRecoveryFailure: (_error, reason) => this.failures.push(reason),
    });
  }

  async #renew(hostId: string) {
    this.renewals.push(hostId);
    const gate = this.gate;
    if (gate) {
      this.gate = null;
      gate.requested = true;
      if (!(await gate.outcome)) throw new Error("The account service is offline.");
    }
    return { signalUrl: this.renewalUrl, ticket: await mint(hostId, "host", { home: this.renewalHome }) };
  }

  holdNextRenewal() {
    let release: (ok: boolean) => void = () => undefined;
    const outcome = new Promise<boolean>((done) => {
      release = done;
    });
    const gate = { requested: false, release, outcome };
    this.gate = gate;
    return gate;
  }

  window(): BrowserWindow {
    const window = windowsOf(this.hostId)[0];
    expect(window !== undefined, `${this.hostId} has no bridge window`);
    return window;
  }

  async start(options: { ttlSeconds?: number; home?: boolean } = {}) {
    return result(
      this.gateway.start({
        hostId: this.hostId,
        signalUrl: config.signalUrl,
        ticket: await mint(this.hostId, "host", options),
        localApiPort: 1,
      }),
    );
  }

  /** Stops the renderer of the bridge window when the host Signal socket opens next. */
  crashOnNextSignalOpen() {
    const onOpen = (peerId: string) => {
      if (peerId !== this.hostId) return;
      this.bridge.off("signalOpen", onOpen);
      this.window().webContents.forcefullyCrashRenderer();
    };
    this.bridge.on("signalOpen", onOpen);
  }

  async close() {
    this.quitting = false;
    await result(this.gateway.dispose());
    await result(this.bridge.stop());
  }
}

/**
 * A device with a client ticket connects to the host through Signal and gets a WebRTC data channel.
 * The client stays connected until `close`.
 */
async function connectClient(hostId: string, name: string) {
  const owner = `${name}-client`;
  const bridge = new TeamWebRtcBridge({
    developmentUrl: `${config.pageUrl}/${owner}`,
    preloadPath: config.preloadPath,
  });
  let connected = false;
  let disconnected = false;
  bridge.on("connected", (peerId) => {
    if (peerId === hostId) connected = true;
  });
  bridge.on("disconnected", (peerId) => {
    if (peerId === hostId && connected) disconnected = true;
  });
  const connecting = await result(
    bridge.connect({
      peerId: hostId,
      signalUrl: config.signalUrl,
      token: await mint(hostId, "member"),
      peer: "client",
    }),
  );
  expect(Result.isSuccess(connecting), "the client connect command failed");
  await until(() => connected, `the client data channel to ${hostId}`);
  return {
    disconnected: () => disconnected,
    close: () => result(bridge.stop()),
  };
}

async function main() {
  await app.whenReady();

  await check("A new window registers the host again after the renderer stops, and a device connects", async () => {
    const host = new Host("host-main");
    try {
      const started = await host.start();
      expect(
        Result.isSuccess(started),
        `the host did not start: ${Result.isFailure(started) ? failureText(started.failure) : ""}`,
      );
      const first = host.window();
      const firstPid = first.webContents.getOSProcessId();
      first.webContents.forcefullyCrashRenderer();
      await until(() => host.ready >= 2, "a second signalReady");
      const second = host.window();
      const secondPid = second.webContents.getOSProcessId();
      expect(second !== first && secondPid !== firstPid, "the bridge did not load a new window");
      expect(host.lost.includes("host-main"), "the bridge did not report the host peer as lost");
      expect(host.renewals.length === 1, `renewals: ${host.renewals.length}`);
      expect(host.failures.length === 0, `failures: ${host.failures.join(", ")}`);
      const client = await connectClient("host-main", "host-main");
      await client.close();
      return `renderer pid ${firstPid} -> ${secondPid}; 1 renewed ticket; a client got a data channel`;
    } finally {
      await host.close();
    }
  });

  await check("A start fails at once when the window is lost while it waits for Signal", async () => {
    const host = new Host("host-start");
    try {
      host.crashOnNextSignalOpen();
      const started = await host.start();
      expect(Result.isFailure(started), "the start did not fail");
      const text = failureText(started.failure);
      // Without the `disconnected` listener in `HostSignal.connect`, it fails 30 s later with the timeout text.
      expect(text === sourceText("error.remote.bridgeStopped"), `the start failed with: ${text}`);
      const again = await host.start();
      expect(Result.isSuccess(again), "a start after the loss did not register the host");
      expect(host.failures.length === 0, `failures: ${host.failures.join(", ")}`);
      return `the start failed with "${text}"; the next start registered the host on a new window`;
    } finally {
      await host.close();
    }
  });

  await check(
    "A recovery that fails because the window is lost reports no failure, and the host registers",
    async () => {
      const host = new Host("host-auth");
      try {
        // Signal ends the session after its expiry with `authentication_required`, and the host asks
        // for a new ticket. The window is lost while that recovery waits for Signal.
        const started = await host.start({ ttlSeconds: 6 });
        expect(Result.isSuccess(started), "the host did not start");
        host.crashOnNextSignalOpen();
        await until(() => host.lost.includes("host-auth"), "the loss of the window during the recovery");
        await until(() => host.ready >= 2, "a signalReady on the new window");
        expect(host.failures.length === 0, `failures: ${host.failures.join(", ")}`);
        expect(host.renewals.length === 2, `renewals: ${host.renewals.length}`);
        return "the auth recovery failed with the window; the bridge recovery registered the host with a second ticket";
      } finally {
        await host.close();
      }
    },
  );

  await check("A move that registers the host on the new window makes the bridge recovery stop", async () => {
    const host = new Host("host-move");
    host.renewalUrl = config.signalUrlAlias;
    host.renewalHome = true;
    let client: Awaited<ReturnType<typeof connectClient>> | null = null;
    try {
      const started = await host.start({ home: true });
      expect(Result.isSuccess(started), "the host did not start");
      const gate = host.holdNextRenewal();
      // Signal goes away: the host socket closes, and the move asks for a new ticket 20 s later.
      await signal("stop");
      await until(() => gate.requested, "the move asks for a ticket", MOVE_TIMEOUT_MS);
      host.window().webContents.forcefullyCrashRenderer();
      await until(() => host.lost.includes("host-move"), "the loss of the window during the move");
      await signal("start");
      gate.release(true);
      await until(() => host.ready >= 2, "the move registers the host on a new window");
      client = await connectClient("host-move", "host-move");
      await sleep(SETTLE_MS);
      expect(host.renewals.length === 1, `renewals: ${host.renewals.length}`);
      expect(!client.disconnected(), "a second registration closed the device peer");
      expect(host.failures.length === 0, `failures: ${host.failures.join(", ")}`);
      return `one renewal; the device stayed connected ${SETTLE_MS} ms after it connected`;
    } finally {
      await client?.close();
      await host.close();
    }
  });

  await check("A loss during a stop fails the pending close at once and reports nothing", async () => {
    const host = new Host("host-stop");
    try {
      const started = await host.start();
      expect(Result.isSuccess(started), "the host did not start");
      await result(host.gateway.stop());
      const window = host.window();
      // The page does not answer the `close` command: its script stops at the next statement.
      window.webContents.debugger.attach("1.3");
      await window.webContents.debugger.sendCommand("Debugger.enable");
      await window.webContents.debugger.sendCommand("Debugger.pause");
      const stopping = result(host.bridge.stop());
      window.webContents.forcefullyCrashRenderer();
      // A command waits 15 s for its answer. A stop that ends in less than that did not wait for it.
      const stopped = await Promise.race([stopping, sleep(10_000).then(() => "waiting" as const)]);
      expect(stopped !== "waiting", "the stop waited for the close of the lost window");
      expect(Result.isSuccess(stopped), "the stop failed");
      expect(host.lost.length === 0, `lost: ${host.lost.join(", ")}`);
      await sleep(SETTLE_MS);
      expect(windowsOf("host-stop").length === 0, "the bridge loaded a window after its stop");
      return "the stop ended before the command timeout, with no loss reported and no new window";
    } finally {
      await host.close();
    }
  });

  await check("A window that closes while the app quits does not start a recovery", async () => {
    const host = new Host("host-quit");
    try {
      const started = await host.start();
      expect(Result.isSuccess(started), "the host did not start");
      host.quitting = true;
      host.window().destroy();
      await sleep(SETTLE_MS);
      expect(host.lost.length === 0, `lost: ${host.lost.join(", ")}`);
      expect(host.renewals.length === 0, `renewals: ${host.renewals.length}`);
      expect(windowsOf("host-quit").length === 0, "the bridge loaded a window during the quit");
      return "no loss reported, no renewal, and no new window";
    } finally {
      await host.close();
    }
  });
}

main().then(
  () => {
    writeFileSync(config.resultFile, JSON.stringify({ checks }, null, 2));
    app.exit(checks.every((item) => item.passed) ? 0 : 1);
  },
  (error: unknown) => {
    checks.push({
      name: "The run ends",
      passed: false,
      evidence: error instanceof Error ? error.message : String(error),
    });
    writeFileSync(config.resultFile, JSON.stringify({ checks }, null, 2));
    app.exit(1);
  },
);
