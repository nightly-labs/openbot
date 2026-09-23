// Starts this worktree's desktop stack and the iOS simulator app, then pairs
// them without a camera: the desktop issues a Mobile Connect ticket over CDP and
// `simctl openurl` hands the QR link to the development build, which redeems it.
// The ticket is a credential, so it is never printed.

import { type ChildProcess, execFile, spawn } from "node:child_process";
import { connect } from "node:net";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { parseMobileConnectUrl } from "@openbot/contracts/mobile-connect";
import { isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger } from "@openbot/logging";
import { connectToDevApp } from "./dev-automation/cdp-client";
import { type DevInstanceRecord, readDevInstanceRecords, selectDevInstance } from "./dev-automation/instance-registry";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const MOBILE_BUNDLE_ID = "run.openbot.mobile";
const DEFAULT_METRO_PORT = 8081;
const DESKTOP_TIMEOUT_MS = 5 * 60_000;
// The first native build takes minutes.
const METRO_TIMEOUT_MS = 20 * 60_000;
const TICKET_TIMEOUT_MS = 3 * 60_000;
const PAIRING_ATTEMPTS = 4;
const PAIRING_CONFIRM_MS = 20_000;
const POLL_INTERVAL_MS = 1_000;

const writeLine = (line: string) => process.stderr.write(`${line}\n`);
const logger = createOpenBotLogger("dev-mobile", writeLine, "info");
// The CDP client reports every connection, and pairing polls the desktop each second.
const cdpLogger = createOpenBotLogger("dev-mobile", writeLine, "warn");
const runCommand = promisify(execFile);

export interface DevMobileOptions {
  pairOnly: boolean;
  simulator: string | null;
  metroPort: number;
  mobileArgs: string[];
}

export function parseDevMobileArgs(argv: string[]): DevMobileOptions {
  const mobileArgs: string[] = [];
  let pairOnly = false;
  let simulator: string | null = null;
  for (const arg of argv) {
    if (arg === "--") continue;
    if (arg === "--pair-only") pairOnly = true;
    else if (arg.startsWith("--simulator=")) simulator = arg.slice("--simulator=".length) || null;
    else mobileArgs.push(arg);
  }
  return { pairOnly, simulator, metroPort: readMetroPort(mobileArgs), mobileArgs };
}

// `expo run:ios` takes `--port <n>`, `--port=<n>` and `-p <n>`.
function readMetroPort(args: string[]): number {
  for (const [index, arg] of args.entries()) {
    const raw = arg.startsWith("--port=")
      ? arg.slice("--port=".length)
      : arg === "--port" || arg === "-p"
        ? args[index + 1]
        : undefined;
    const port = Number(raw);
    if (raw !== undefined && Number.isInteger(port) && port > 0 && port <= 65_535) return port;
  }
  return DEFAULT_METRO_PORT;
}

// Metro lists a JavaScript runtime once the app has started it. A link opened
// before that can reach the old build or nothing at all.
export function hasMobileRuntime(targets: unknown): boolean {
  return (
    Array.isArray(targets) && targets.some((target) => isDynamicRecord(target) && target.appId === MOBILE_BUNDLE_ID)
  );
}

export function hasNewIosDevice(devices: unknown, since: number): boolean {
  return (
    Array.isArray(devices) &&
    devices.some(
      (device) =>
        isDynamicRecord(device) &&
        device.platform === "ios" &&
        isNumber(device.connectedAt) &&
        device.connectedAt >= since,
    )
  );
}

export function bootedSimulatorIds(list: unknown): string[] {
  if (!isDynamicRecord(list) || !isDynamicRecord(list.devices)) return [];
  return Object.values(list.devices).flatMap((devices) =>
    Array.isArray(devices)
      ? devices.flatMap((device) =>
          isDynamicRecord(device) && device.state === "Booted" && isString(device.udid) ? [device.udid] : [],
        )
      : [],
  );
}

const children: { name: string; child: ChildProcess }[] = [];
let childFailure: string | null = null;

function startChild(name: string, command: string, args: string[], stdin: "inherit" | "ignore"): void {
  const child = spawn(command, args, { cwd: projectRoot, stdio: [stdin, "inherit", "inherit"], env: process.env });
  children.push({ name, child });
  child.on("exit", (code, signal) => {
    childFailure ??= `${name} exited (${signal ?? `code ${code}`}).`;
  });
}

function childrenExited(): Promise<void> {
  return Promise.all(
    children.map(
      ({ child }) =>
        new Promise<void>((resolve) => {
          if (child.exitCode !== null || child.signalCode !== null) resolve();
          else child.once("exit", () => resolve());
        }),
    ),
  ).then(() => undefined);
}

async function waitFor<T>(label: string, timeoutMs: number, probe: () => Promise<T | null>): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    if (childFailure) throw new Error(`${childFailure} Stopped while waiting for ${label}.`);
    try {
      const value = await probe();
      if (value !== null) return value;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(`Timed out waiting for ${label}.${lastError ? ` Last error: ${lastError}` : ""}`);
}

// Every worktree builds the same bundle id, so a Metro that already listens on
// the port would report another worktree's app as this one.
function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

function findWorktreeDesktop(): DevInstanceRecord | null {
  const selection = selectDevInstance(readDevInstanceRecords(), { projectRoot, service: "app" });
  if (selection.kind === "ambiguous") {
    throw new Error("This worktree runs more than one dev app. Stop the extra one with `bun run dev:stop`.");
  }
  return selection.kind === "selected" && selection.match === "worktree" ? selection.record : null;
}

// Evaluated in the app window, so these are strings: this file is typechecked
// against Node globals and knows nothing about `window`.
async function evaluateInDesktop<T>(
  desktop: DevInstanceRecord,
  expression: string,
  parse: (value: unknown) => T,
): Promise<T> {
  const session = await connectToDevApp(desktop.remoteDebuggingPort, cdpLogger, {
    expectedRendererPort: desktop.rendererPort,
    ownerPid: desktop.pid,
  });
  try {
    return parse(await session.page.evaluate(expression));
  } finally {
    await session.close();
  }
}

function readPairingLink(ticket: unknown): string {
  const link = isDynamicRecord(ticket) && isString(ticket.qrData) ? ticket.qrData : null;
  if (!link || !parseMobileConnectUrl(link)) throw new Error("The desktop returned an invalid Mobile Connect link.");
  return link;
}

async function createPairingLink(desktop: DevInstanceRecord): Promise<string> {
  // The desktop publishes its host on the first request, which can fail while
  // the dev account signs in or the Signal service starts.
  return waitFor("a Mobile Connect ticket from the desktop", TICKET_TIMEOUT_MS, async () => {
    return evaluateInDesktop(desktop, "window.openbot.auth.createMobileConnect()", readPairingLink);
  });
}

async function selectSimulator(requested: string | null): Promise<string> {
  if (requested) return requested;
  const { stdout } = await runCommand("xcrun", ["simctl", "list", "devices", "booted", "--json"]);
  const withApp: string[] = [];
  for (const udid of bootedSimulatorIds(JSON.parse(stdout))) {
    try {
      await runCommand("xcrun", ["simctl", "get_app_container", udid, MOBILE_BUNDLE_ID]);
      withApp.push(udid);
    } catch {
      // OpenBot is not installed on this simulator.
    }
  }
  const [udid, ...extra] = withApp;
  if (!udid) throw new Error("No booted simulator has OpenBot installed. Run without --pair-only to build it.");
  if (extra.length > 0) {
    throw new Error(`Several booted simulators have OpenBot. Pass --simulator=<udid>: ${withApp.join(", ")}`);
  }
  return udid;
}

async function pairSimulator(desktop: DevInstanceRecord, simulator: string): Promise<void> {
  for (let attempt = 1; attempt <= PAIRING_ATTEMPTS; attempt += 1) {
    // A new ticket each attempt: it lives two minutes and issuing one consumes
    // the previous one, so no unused ticket stays valid.
    const link = await createPairingLink(desktop);
    const sentAt = Date.now() - 1_000;
    try {
      await runCommand("xcrun", ["simctl", "openurl", simulator, link]);
    } catch {
      // The command error repeats its arguments, and the link holds the ticket.
      throw new Error(`simctl could not open the Mobile Connect link on simulator ${simulator}.`);
    }
    try {
      await waitFor("the simulator to redeem the ticket", PAIRING_CONFIRM_MS, async () =>
        (await evaluateInDesktop(desktop, "window.openbot.auth.listMobileConnectedDevices()", (devices) =>
          hasNewIosDevice(devices, sentAt),
        ))
          ? true
          : null,
      );
      logger.info(`Paired simulator ${simulator} with this worktree's desktop.`);
      return;
    } catch (error) {
      if (childFailure) throw error;
      logger.warn(`The simulator did not redeem the ticket (attempt ${attempt} of ${PAIRING_ATTEMPTS}).`);
    }
  }
  throw new Error("The simulator did not pair. Check the Metro log for `Development Mobile Connect failed`.");
}

async function main(): Promise<void> {
  if (process.platform !== "darwin") throw new Error("The iOS simulator requires macOS.");
  const options = parseDevMobileArgs(process.argv.slice(2));

  if (!options.pairOnly && (await isPortInUse(options.metroPort))) {
    throw new Error(
      `Port ${options.metroPort} is in use, possibly by another worktree's Metro. Pass --port=<free port>.`,
    );
  }
  let desktop = findWorktreeDesktop();
  if (!desktop && options.pairOnly) throw new Error("No dev app runs in this worktree. Run without --pair-only.");
  if (desktop) logger.info("Reusing this worktree's dev app.");
  else startChild("bun run dev", "bun", ["scripts/dev-services.ts", "app"], "ignore");
  if (!options.pairOnly) {
    // Metro reads keyboard shortcuts, so it owns the terminal input.
    startChild("bun mobile:ios", "bun", ["scripts/mobile-ios.ts", ...options.mobileArgs], "inherit");
  }
  const forward = (signal: NodeJS.Signals) => {
    for (const { child } of children) child.kill(signal);
  };
  // Ctrl+C reaches the children through the process group. Wait for them to stop.
  process.on("SIGINT", () => {
    if (children.length === 0) process.exit(130);
  });
  process.on("SIGTERM", () => forward("SIGTERM"));

  try {
    desktop ??= await waitFor("this worktree's dev app", DESKTOP_TIMEOUT_MS, async () => findWorktreeDesktop());
    if (!options.pairOnly) {
      await waitFor(`the app runtime on Metro :${options.metroPort}`, METRO_TIMEOUT_MS, async () => {
        const response = await fetch(`http://127.0.0.1:${options.metroPort}/json/list`, {
          signal: AbortSignal.timeout(2_000),
        });
        return response.ok && hasMobileRuntime(await response.json()) ? true : null;
      });
    }
    await pairSimulator(desktop, await selectSimulator(options.simulator));
  } catch (error) {
    // Keep the desktop and Metro running, so `--pair-only` can try again.
    logger.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
  await childrenExited();
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    logger.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
