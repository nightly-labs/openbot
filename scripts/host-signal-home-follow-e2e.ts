import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createOpenBotLogger } from "@openbot/logging";
import { Effect } from "effect";
import { RemoteWorkflowError } from "../src/main/remote-service-effects";
import { TeamStore } from "../src/main/team-store";
import { TeamWebRtcBridge } from "../src/main/team-webrtc-bridge";
import { TeamWebRtcHostGateway } from "../src/main/team-webrtc-host-gateway";

const OUT = resolve(import.meta.dirname, "../.openbot-build/host-signal-home-follow-e2e");
const HOST_ID = "host-signal-home-follow-e2e";
const SIGNAL_URLS = { a: "wss://signal-a.e2e.invalid", b: "wss://signal-b.e2e.invalid" };
const MOVE_WAIT_MS = 30_000;
const POLL_MS = 50;

type SignalHome = keyof typeof SIGNAL_URLS;

const logger = createOpenBotLogger("host-signal-home-follow-e2e");

interface Check {
  name: string;
  passed: boolean;
  evidence: string;
}

interface TicketRequest {
  at: string;
  failedSignalUrl: string | null;
  storedHome: SignalHome;
  answerReachedHost: boolean;
}

const checks: Check[] = [];

function record(name: string, passed: boolean, evidence: string): void {
  checks.push({ name, passed, evidence });
  if (passed) logger.info(`PASS ${name}`);
  else logger.error(`FAIL ${name}: ${evidence}`);
}

async function until(predicate: () => boolean, label: string, limit = MOVE_WAIT_MS): Promise<void> {
  const deadline = Date.now() + limit;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`${label} did not happen in ${limit / 1000} s.`);
    await new Promise((done) => setTimeout(done, POLL_MS));
  }
}

function hostTicket(home: SignalHome): string {
  const claims = Buffer.from(JSON.stringify({ hostId: HOST_ID, role: "host", signal: home })).toString("base64url");
  return `e2e.${claims}.e2e`;
}

function otherHome(home: SignalHome): SignalHome {
  return home === "a" ? "b" : "a";
}

class AccountService {
  storedHome: SignalHome = "a";
  lostAnswers = 0;
  readonly requests: TicketRequest[] = [];

  readonly renewSignal = (_hostId: string, failedSignalUrl?: string) =>
    Effect.suspend(() => {
      if (failedSignalUrl === SIGNAL_URLS[this.storedHome]) this.storedHome = otherHome(this.storedHome);
      const answerReachedHost = this.lostAnswers === 0;
      if (!answerReachedHost) this.lostAnswers -= 1;
      this.requests.push({
        at: new Date().toISOString(),
        failedSignalUrl: failedSignalUrl ?? null,
        storedHome: this.storedHome,
        answerReachedHost,
      });
      if (!answerReachedHost)
        return Effect.fail(new RemoteWorkflowError({ cause: new Error("The ticket answer did not reach the host.") }));
      return Effect.succeed({ signalUrl: SIGNAL_URLS[this.storedHome], ticket: hostTicket(this.storedHome) });
    });
}

class ScriptedBridge extends TeamWebRtcBridge {
  signalUrl: string | null = null;
  readonly commands: string[] = [];

  override readonly start = () => Effect.void;
  override readonly setPrivateNetwork = () => Effect.void;
  override readonly connect = (input: { peerId: string; signalUrl: string }) =>
    Effect.sync(() => this.#open("connect", input.peerId, input.signalUrl));
  override readonly moveSignal = (input: { peerId: string; signalUrl: string }) =>
    Effect.sync(() => this.#open("move", input.peerId, input.signalUrl));
  override readonly disconnect = (peerId: string) =>
    Effect.sync(() => {
      this.commands.push(`disconnect ${peerId}`);
      this.signalUrl = null;
    });

  #open(command: string, peerId: string, signalUrl: string): void {
    this.commands.push(`${command} ${signalUrl}`);
    this.signalUrl = signalUrl;
    queueMicrotask(() => this.emit("signalReady", peerId));
  }

  closeSignal(peerId: string): void {
    this.commands.push(`close 1013 ${this.signalUrl ?? "none"}`);
    this.emit("signalClosed", peerId, "1013", false);
  }

  reconnectWithSavedTicket(peerId: string): void {
    this.commands.push(`ready again ${this.signalUrl ?? "none"}`);
    this.emit("signalReady", peerId);
  }
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const work = mkdtempSync(join(tmpdir(), "openbot-host-signal-home-"));
  const account = new AccountService();
  const bridge = new ScriptedBridge();
  const gateway = new TeamWebRtcHostGateway({
    bridge,
    store: new TeamStore(join(work, "team.json")),
    appVersion: "0.0.0-e2e",
    transferDirectory: join(work, "transfers"),
    renewSignal: account.renewSignal,
  });
  try {
    await Effect.runPromise(
      gateway.start({ hostId: HOST_ID, signalUrl: SIGNAL_URLS.a, ticket: hostTicket("a"), localApiPort: 1 }),
    );
    record(
      "host starts on home a",
      bridge.signalUrl === SIGNAL_URLS.a && gateway.signalHome() === "a",
      `bridge ${bridge.signalUrl}, gateway home ${gateway.signalHome()}`,
    );

    account.lostAnswers = 2;
    bridge.closeSignal(HOST_ID);
    await until(() => account.requests.length === 1, "The move request after the close");
    await new Promise((done) => setImmediate(done));
    const move = account.requests[0];
    record(
      "the account service stores home b, but the answer is lost",
      move?.storedHome === "b" && move.answerReachedHost === false && move.failedSignalUrl === SIGNAL_URLS.a,
      JSON.stringify(move),
    );

    bridge.reconnectWithSavedTicket(HOST_ID);
    record(
      "the bridge is ready again on the old home a",
      bridge.signalUrl === SIGNAL_URLS.a,
      `bridge ${bridge.signalUrl}, stored home ${account.storedHome}`,
    );

    await until(() => account.requests.length === 2, "The home check after the ready");
    const firstCheck = account.requests[1];
    record(
      "the host checks its home after it is ready, and that answer is lost too",
      firstCheck?.failedSignalUrl === null && firstCheck.answerReachedHost === false,
      JSON.stringify(firstCheck),
    );

    await until(() => bridge.signalUrl === SIGNAL_URLS.b, "The move to home b");
    const secondCheck = account.requests[2];
    record(
      "the host checks again later and moves to the stored home b",
      secondCheck?.answerReachedHost === true &&
        secondCheck.storedHome === "b" &&
        gateway.signalHome() === "b" &&
        bridge.commands.includes(`move ${SIGNAL_URLS.b}`),
      `bridge ${bridge.signalUrl}, gateway home ${gateway.signalHome()}, request ${JSON.stringify(secondCheck)}`,
    );
    record(
      "the host home and the stored home agree",
      gateway.signalHome() === account.storedHome,
      `gateway ${gateway.signalHome()}, stored ${account.storedHome}`,
    );
  } catch (error) {
    record("scenario", false, error instanceof Error ? error.message : String(error));
  } finally {
    await Effect.runPromise(gateway.dispose().pipe(Effect.catch(() => Effect.void)));
    rmSync(work, { recursive: true, force: true });
  }
  const passed = checks.every((check) => check.passed);
  const report = {
    generatedAt: new Date().toISOString(),
    passed,
    checks,
    ticketRequests: account.requests,
    bridgeCommands: bridge.commands,
  };
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  logger.info(`Report: ${join(OUT, "report.json")}`);
  if (!passed) process.exit(1);
}

await main();
