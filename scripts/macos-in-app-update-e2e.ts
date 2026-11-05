// Drives a real in-app update of a released OpenBot on a Mac that has no OpenBot, such as a CI
// runner (issue #5039: on macOS 27 Restart quits, but ShipIt never runs and the old version stays).
// It installs the released app in /Applications, opens it with a debugging port, and calls the
// update check, download and install of the main window, as the Restart button does. Then it waits
// for the new version to start, and records each step of Squirrel: the ShipIt cache folder, the
// ShipIt launchd job, the OpenBot logs, the crash reports and the system log.
// Usage: bun scripts/macos-in-app-update-e2e.ts <released OpenBot zip> <expected new version>
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger } from "@openbot/logging";

const logger = createOpenBotLogger("macos-in-app-update-e2e");

if (process.platform !== "darwin") throw new Error("This test drives the macOS updater and must run on macOS.");
// It replaces /Applications/OpenBot.app and the OpenBot data of this user.
if (process.env.GITHUB_ACTIONS !== "true") throw new Error("This test replaces /Applications/OpenBot.app; CI only.");

const [zipArgument, expectedVersion] = process.argv.slice(2);
if (!zipArgument || !expectedVersion) throw new Error("Usage: <released OpenBot zip> <expected new version>");

const APP = "/Applications/OpenBot.app";
const EXECUTABLE = `${APP}/Contents/MacOS/OpenBot`;
const SHIPIT = join(homedir(), "Library", "Caches", "app.openbot.desktop.ShipIt");
const USER_DATA = join(homedir(), "Library", "Application Support", "OpenBot");
const OUTPUT = resolve(".openbot-build", "macos-in-app-update-e2e");
const PORT = 9555;
const uid = String(process.getuid?.() ?? "");

type Step = { at: string; name: string; detail: string };
type Sample = { at: string; sinceInstallMs: number; pids: string[]; version: string; shipIt: string[] };
type Status = { phase: string; detail: string };
type Report = {
  os: string;
  arch: string;
  startVersion: string;
  expectedVersion: string;
  codesign: string;
  spctl: string;
  steps: Step[];
  samples: Sample[];
  oldExitedAfterMs: number | null;
  updated: boolean;
  endVersion: string;
  shipItEntries: string[];
  launchdUser: string;
  launchdSystem: string;
  launchdDisabled: string[];
};

const run = (command: string, args: string[]) => {
  const result = spawnSync(command, args, { encoding: "utf8" });
  return `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
};
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
const appVersion = () =>
  run("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleShortVersionString", `${APP}/Contents/Info.plist`]);
const mainPids = () =>
  run("pgrep", ["-f", `^${EXECUTABLE}`])
    .split("\n")
    .filter(Boolean);
const shipItEntries = () => (existsSync(SHIPIT) ? readdirSync(SHIPIT).sort() : []);
const stamp = () => new Date().toISOString();

rmSync(OUTPUT, { recursive: true, force: true });
mkdirSync(OUTPUT, { recursive: true });
rmSync(APP, { recursive: true, force: true });
rmSync(SHIPIT, { recursive: true, force: true });
rmSync(USER_DATA, { recursive: true, force: true });
execFileSync("ditto", ["-x", "-k", resolve(zipArgument), "/Applications"]);
const startVersion = appVersion();

const report: Report = {
  os: run("sw_vers", []),
  arch: run("uname", ["-m"]),
  startVersion,
  expectedVersion,
  codesign: run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", APP]),
  spctl: run("spctl", ["--assess", "--type", "execute", "--verbose", APP]),
  steps: [],
  samples: [],
  oldExitedAfterMs: null,
  updated: false,
  endVersion: "",
  shipItEntries: [],
  launchdUser: "",
  launchdSystem: "",
  launchdDisabled: [],
};
const step = (name: string, detail = "") => {
  report.steps.push({ at: stamp(), name, detail });
  logger.info(name, { detail });
};

/** Runs `expression` in the page and returns its awaited value as JSON text, or "" when the page went away. */
async function evaluateJson(socketUrl: string, expression: string): Promise<string> {
  const socket = new WebSocket(socketUrl);
  await new Promise((done, fail) => {
    socket.onopen = done;
    socket.onerror = fail;
  });
  try {
    return await new Promise<string>((done, fail) => {
      socket.onmessage = (message) => {
        const reply = JSON.parse(String(message.data));
        if (!isDynamicRecord(reply) || reply.id !== 1) return;
        const result = isDynamicRecord(reply.result) ? reply.result : {};
        if (result.exceptionDetails) fail(new Error(JSON.stringify(result.exceptionDetails)));
        const value = isDynamicRecord(result.result) ? result.result.value : undefined;
        done(isString(value) ? value : "");
      };
      socket.onclose = () => done("");
      socket.send(
        JSON.stringify({
          id: 1,
          method: "Runtime.evaluate",
          params: {
            expression: `(async () => JSON.stringify(await (${expression})))()`,
            awaitPromise: true,
            returnByValue: true,
          },
        }),
      );
    });
  } finally {
    socket.close();
  }
}

async function mainWindowSocket(deadline: number): Promise<string> {
  while (Date.now() < deadline) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      for (const target of Array.isArray(targets) ? targets : []) {
        if (!isDynamicRecord(target) || target.type !== "page") continue;
        const { url, webSocketDebuggerUrl } = target;
        if (!isString(url) || !isString(webSocketDebuggerUrl) || url.includes("helper.html")) continue;
        const ready = await evaluateJson(webSocketDebuggerUrl, "typeof window.openbot?.update?.install === 'function'");
        if (ready === "true") return webSocketDebuggerUrl;
      }
    } catch {
      // The app is still starting.
    }
    await sleep(1_000);
  }
  throw new Error("The main window of OpenBot did not load.");
}

async function readStatus(socket: string): Promise<Status> {
  const text = await evaluateJson(socket, "window.openbot.update.getStatus()");
  const value = text ? JSON.parse(text) : null;
  const phase = isDynamicRecord(value) && isString(value.phase) ? value.phase : "";
  return { phase, detail: text };
}

let installAt = 0;
try {
  run("open", [APP, "--args", `--remote-debugging-port=${PORT}`, "--remote-debugging-address=127.0.0.1"]);
  const socket = await mainWindowSocket(Date.now() + 180_000);
  step("main window loaded", mainPids().join(","));

  let status: Status = { phase: "", detail: "" };
  const readyDeadline = Date.now() + 900_000;
  while (Date.now() < readyDeadline) {
    const next = await readStatus(socket);
    if (next.phase !== status.phase) step("update status", next.detail);
    status = next;
    if (status.phase === "ready" || status.phase === "unsupported") break;
    if (status.phase === "idle" || status.phase === "up-to-date" || status.phase === "error") {
      await evaluateJson(socket, "window.openbot.update.check().catch((error) => String(error))");
    } else if (status.phase === "available") {
      await evaluateJson(socket, "window.openbot.update.download().catch((error) => String(error))");
    }
    await sleep(3_000);
  }
  if (status.phase !== "ready") throw new Error(`The update did not become ready: ${status.detail}`);

  const oldPids = mainPids();
  installAt = Date.now();
  step("install requested", `pids ${oldPids.join(",")}; ShipIt ${shipItEntries().join(",")}`);
  // The page goes away while the call runs, so its answer is not awaited.
  void evaluateJson(socket, "window.openbot.update.install().catch((error) => String(error))").catch(() => "");

  let oldExitedAt: number | null = null;
  let lastEntries = "";
  const deadline = Date.now() + 480_000;
  while (Date.now() < deadline) {
    const pids = mainPids();
    const entries = shipItEntries();
    const version = appVersion();
    report.samples.push({ at: stamp(), sinceInstallMs: Date.now() - installAt, pids, version, shipIt: entries });
    if (entries.join(",") !== lastEntries) step("ShipIt folder changed", entries.join(","));
    lastEntries = entries.join(",");
    if (oldExitedAt === null && !oldPids.some((pid) => pids.includes(pid))) {
      oldExitedAt = Date.now();
      step("old process exited", `${oldExitedAt - installAt} ms after install`);
    }
    if (version === expectedVersion && pids.some((pid) => !oldPids.includes(pid))) {
      report.updated = true;
      step("new version running", `${Date.now() - installAt} ms after install`);
      break;
    }
    await sleep(2_000);
  }
  report.oldExitedAfterMs = oldExitedAt === null ? null : oldExitedAt - installAt;
} catch (error) {
  step("failed", String(error));
} finally {
  report.endVersion = appVersion();
  report.shipItEntries = shipItEntries();
  report.launchdUser = run("launchctl", ["print", `gui/${uid}/app.openbot.desktop.ShipIt`]);
  report.launchdSystem = run("launchctl", ["print", "system/app.openbot.desktop.ShipIt"]);
  report.launchdDisabled = run("launchctl", ["print-disabled", `gui/${uid}`])
    .split("\n")
    .filter((line) => /openbot/iu.test(line));
  for (const name of report.shipItEntries) {
    if (name.endsWith(".log") || name.endsWith(".plist")) cpSync(join(SHIPIT, name), join(OUTPUT, `shipit-${name}`));
  }
  if (existsSync(join(USER_DATA, "logs"))) {
    cpSync(join(USER_DATA, "logs"), join(OUTPUT, "openbot-logs"), { recursive: true });
  }
  const crashReports = join(homedir(), "Library", "Logs", "DiagnosticReports");
  if (existsSync(crashReports)) {
    for (const name of readdirSync(crashReports)) {
      if (/^(OpenBot|ShipIt)/u.test(name)) cpSync(join(crashReports, name), join(OUTPUT, name));
    }
  }
  if (installAt > 0) {
    const start = new Date(installAt - 10_000).toISOString().replace("T", " ").slice(0, 19);
    const predicate = [
      'eventMessage CONTAINS[c] "openbot"',
      'eventMessage CONTAINS "ShipIt"',
      ...["OpenBot", "ShipIt", "syspolicyd", "tccd", "SecurityAgent", "launchd", "runningboardd", "powerd"].map(
        (name) => `process == "${name}"`,
      ),
    ].join(" OR ");
    // `log show` reads UTC when the time has a zone; without one it reads local time, so pass UTC.
    writeFileSync(
      join(OUTPUT, "system.log"),
      run("log", ["show", "--style", "compact", "--info", "--start", `${start}+0000`, "--predicate", predicate]),
    );
  }
  writeFileSync(join(OUTPUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  const updateLog = join(USER_DATA, "logs", "update", "update.log");
  logger.info("update.log", { text: existsSync(updateLog) ? readFileSync(updateLog, "utf8") : "" });
  logger.info("Result", { updated: report.updated, from: startVersion, to: report.endVersion });
}
process.exit(report.updated ? 0 : 1);
