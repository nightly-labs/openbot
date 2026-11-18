// Starts this worktree's dev stack three times and checks the run marker of the main process:
//   1. Start, wait for the marker to say `running`, and kill the Electron main process by its PID.
//   2. Start again. The marker of run 1 makes one `system_unclean_exit` event: the main log says so
//      once, and a local capture server receives it once when analytics can send it.
//   3. Send SIGTERM to the Electron main process. OpenBot quits for `signal` and runs its teardown.
//      Check that the marker says `clean`, and start again. This start makes no event.
// `bun run dev:stop` is not the clean quit here: it stops the whole process group and sends SIGKILL
// after 3 s, which can end the teardown first. The run then correctly counts as `quitting`.
// The script stops the stack at the end with `bun run dev:stop` and writes
// .openbot-build/unclean-exit-e2e/report.json.
//
//   bun scripts/unclean-exit-e2e.ts [--capture-port=47321]
//
// It never kills by name: it kills the one PID that it finds under its own dev supervisor.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { createOpenBotLogger } from "@openbot/logging";
import { z } from "zod";
import { RUN_MARKER_FILE } from "../src/main/run-marker";
import { readDevInstanceRecords } from "./dev-automation/instance-registry";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, ".openbot-build/unclean-exit-e2e");
const portFlag = process.argv.find((argument) => argument.startsWith("--capture-port="));
const CAPTURE_PORT = Number(portFlag?.slice("--capture-port=".length) ?? 47321);
const START_TIMEOUT_MS = 240_000;
const EVENT_TIMEOUT_MS = 60_000;
const UNCLEAN_LINE = "The previous run did not quit cleanly";

if (process.platform !== "darwin") throw new Error("This check reads the macOS user data folder.");
mkdirSync(OUT, { recursive: true });

const openPanelBody = z.object({
  type: z.string(),
  payload: z.object({ name: z.string().optional(), properties: z.record(z.string(), z.unknown()).optional() }),
});
interface Captured {
  run: number;
  name: string | null;
  properties: z.infer<typeof openPanelBody>["payload"]["properties"] & {};
}
/** The run marker file that `src/main/run-marker.ts` writes. */
const runMarkerFile = z.object({
  version: z.literal(1),
  appVersion: z.string(),
  startedAt: z.number(),
  heartbeatAt: z.number(),
  state: z.enum(["running", "quitting", "quit_timeout", "clean"]),
  quitReason: z.string().nullable(),
  sleeping: z.boolean(),
  slept: z.boolean(),
  osShutdown: z.boolean(),
});
type RunMarkerFile = z.infer<typeof runMarkerFile>;
interface RunReport {
  run: number;
  electronPid: number;
  marker?: RunMarkerFile | null;
  uncleanLogLines?: number;
  uncleanLogLine?: string | null;
  captureEvents?: Captured[];
  capturedEventNames?: (string | null)[];
}
interface Report {
  startedAt: string;
  capturePort: number;
  /** Run 1: the marker after the kill. Run 3: the marker before the start, after the clean quit. */
  runs: RunReport[];
  passed?: boolean;
  error?: string;
  finishedAt?: string;
}
const captured: Captured[] = [];
let currentRun = 0;

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

/** `localhost` can resolve to either loopback address, so the server listens on both. */
async function listenOnLoopback(port: number): Promise<Server[]> {
  const servers: Server[] = [];
  for (const host of ["127.0.0.1", "::1"]) {
    const server = createServer((request, response) => {
      if (request.method === "OPTIONS") {
        response.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-headers": "*" }).end();
        return;
      }
      void readBody(request).then((body) => {
        const parsed = openPanelBody.safeParse(body ? JSON.parse(body) : null);
        if (parsed.success) {
          const { type, payload } = parsed.data;
          captured.push({
            run: currentRun,
            name: type === "track" ? (payload.name ?? null) : type,
            properties: payload.properties ?? {},
          });
        }
        response.writeHead(200, { "access-control-allow-origin": "*", "content-type": "application/json" }).end("{}");
      });
    });
    await new Promise<void>((done, fail) => {
      server.once("error", fail);
      server.listen(port, host, () => done());
    });
    servers.push(server);
  }
  return servers;
}

async function waitFor<T>(what: string, read: () => T | null | undefined, timeoutMs: number): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value !== null && value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}.`);
    await sleep(250);
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function ownAppRecord() {
  return readDevInstanceRecords().find((record) => record.service === "app" && record.projectRoot === ROOT) ?? null;
}

/** The Electron main process under this supervisor: an Electron binary with no `--type=` switch. */
function electronMainPid(supervisorPid: number): number | null {
  const rows = execFileSync("ps", ["-A", "-o", "pid=,ppid=,command="], { encoding: "utf8" })
    .split("\n")
    .flatMap((line) => {
      const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/u.exec(line);
      return match ? [{ pid: Number(match[1]), ppid: Number(match[2]), command: match[3] ?? "" }] : [];
    });
  const descendants = new Set([supervisorPid]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const row of rows) {
      if (!descendants.has(row.pid) && descendants.has(row.ppid)) {
        descendants.add(row.pid);
        grew = true;
      }
    }
  }
  const mains = rows.filter(
    (row) =>
      descendants.has(row.pid) &&
      /\/Electron\.app\/Contents\/MacOS\/Electron(\s|$)/u.test(row.command) &&
      !row.command.includes("--type="),
  );
  return mains.length === 1 ? (mains[0]?.pid ?? null) : null;
}

const environment: NodeJS.ProcessEnv = {
  ...process.env,
  OPENBOT_ANALYTICS_CAPTURE_URL: `http://localhost:${CAPTURE_PORT}`,
};
delete environment.ELECTRON_RUN_AS_NODE;

interface Started {
  supervisorPid: number;
  electronPid: number;
  userData: string;
}

async function startStack(run: number): Promise<Started> {
  currentRun = run;
  assert.equal(ownAppRecord(), null, "This worktree already runs a dev stack. Stop it first.");
  const log = openSync(join(OUT, `dev-run-${run}.log`), "w");
  const spawnedAt = Date.now();
  const child = spawn("bun", ["run", "dev"], { cwd: ROOT, env: environment, stdio: ["ignore", log, log] });
  const supervisorPid = child.pid;
  if (!supervisorPid) throw new Error("Could not start bun run dev.");
  child.unref();
  const record = await waitFor(`the app record of run ${run}`, ownAppRecord, START_TIMEOUT_MS);
  const userData = join(homedir(), "Library/Application Support", record.profile);
  const electronPid = await waitFor(
    `the Electron main process of run ${run}`,
    () => electronMainPid(supervisorPid),
    START_TIMEOUT_MS,
  );
  // The marker is written right after the single-instance lock, before the window opens.
  await waitFor(
    `a running marker of run ${run}`,
    () => {
      const marker = readMarker(userData);
      return marker?.state === "running" && Number(marker.startedAt) >= spawnedAt ? marker : null;
    },
    START_TIMEOUT_MS,
  );
  return { supervisorPid, electronPid, userData };
}

function readMarker(userData: string): RunMarkerFile | null {
  const path = join(userData, RUN_MARKER_FILE);
  if (!existsSync(path)) return null;
  try {
    return runMarkerFile.parse(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return null;
  }
}

function mainLog(userData: string): string {
  const path = join(userData, "logs/main/main.log");
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function countLines(text: string, needle: string): number {
  return text.split("\n").filter((line) => line.includes(needle)).length;
}

function devStop(): void {
  execFileSync("bun", ["run", "dev:stop"], { cwd: ROOT, env: environment, stdio: "inherit" });
}

const capture = await listenOnLoopback(CAPTURE_PORT);
const report: Report = { startedAt: new Date().toISOString(), capturePort: CAPTURE_PORT, runs: [] };
let failure: unknown = null;
try {
  // Run 1: start and kill the main process.
  const first = await startStack(1);
  process.kill(first.electronPid, "SIGKILL");
  await waitFor("the end of the killed Electron process", () => (isAlive(first.electronPid) ? null : true), 30_000);
  // The supervisor stops the other services when the app ends.
  await waitFor(
    "the end of the first dev supervisor",
    () => (isAlive(first.supervisorPid) || ownAppRecord() ? null : true),
    60_000,
  );
  const killedMarker = readMarker(first.userData);
  assert.equal(killedMarker?.state, "running", "A killed run leaves its marker in `running`.");
  report.runs.push({ run: 1, electronPid: first.electronPid, marker: killedMarker });

  // Run 2: the start after the kill.
  const logBefore = mainLog(first.userData).length;
  const second = await startStack(2);
  const secondLog = await waitFor(
    "the unclean exit line in the main log",
    () => {
      const text = mainLog(second.userData).slice(logBefore);
      return text.includes(UNCLEAN_LINE) ? text : null;
    },
    EVENT_TIMEOUT_MS,
  );
  const uncleanEvents = () => captured.filter((event) => event.run === 2 && event.name === "system_unclean_exit");
  const sent = await waitFor(
    "a system_unclean_exit event",
    () => (uncleanEvents().length > 0 ? uncleanEvents() : null),
    EVENT_TIMEOUT_MS,
  );
  // A second flush must not send it again: wait for the renderer's open event, which comes later.
  await waitFor(
    "the desktop_app_opened event of run 2",
    () => captured.find((event) => event.run === 2 && event.name === "desktop_app_opened"),
    EVENT_TIMEOUT_MS,
  ).catch(() => null);
  report.runs.push({
    run: 2,
    electronPid: second.electronPid,
    uncleanLogLines: countLines(secondLog, UNCLEAN_LINE),
    uncleanLogLine: secondLog.split("\n").find((line) => line.includes(UNCLEAN_LINE)) ?? null,
    captureEvents: uncleanEvents(),
    capturedEventNames: captured.filter((event) => event.run === 2).map((event) => event.name),
  });
  assert.equal(countLines(secondLog, UNCLEAN_LINE), 1, "Run 2 logs the unclean exit once.");
  assert.equal(uncleanEvents().length, 1, "Run 2 sends the unclean exit once.");
  assert.equal(sent[0]?.properties.phase, "running", "A kill of the main process has the running phase.");
  assert.equal(sent[0]?.properties.host_kind, "desktop", "The dev app is a desktop host.");

  // Clean quit, then run 3. The supervisor stops the other services when the app ends.
  process.kill(second.electronPid, "SIGTERM");
  await waitFor("the end of the quit Electron process", () => (isAlive(second.electronPid) ? null : true), 60_000);
  await waitFor(
    "the end of the second dev supervisor",
    () => (isAlive(second.supervisorPid) || ownAppRecord() ? null : true),
    60_000,
  );
  const cleanMarker = readMarker(second.userData);
  assert.equal(cleanMarker?.state, "clean", "A SIGTERM quit leaves the marker in `clean`.");
  const logBeforeThird = mainLog(second.userData).length;
  const third = await startStack(3);
  await waitFor(
    "the desktop_app_opened event of run 3",
    () => captured.find((event) => event.run === 3 && event.name === "desktop_app_opened"),
    EVENT_TIMEOUT_MS,
  ).catch(() => null);
  const thirdLog = mainLog(third.userData).slice(logBeforeThird);
  report.runs.push({
    run: 3,
    electronPid: third.electronPid,
    marker: cleanMarker,
    uncleanLogLines: countLines(thirdLog, UNCLEAN_LINE),
    captureEvents: captured.filter((event) => event.run === 3 && event.name === "system_unclean_exit"),
    capturedEventNames: captured.filter((event) => event.run === 3).map((event) => event.name),
  });
  assert.equal(countLines(thirdLog, UNCLEAN_LINE), 0, "Run 3 logs no unclean exit.");
  assert.equal(
    captured.filter((event) => event.run === 3 && event.name === "system_unclean_exit").length,
    0,
    "Run 3 sends no unclean exit.",
  );
} catch (error) {
  failure = error;
} finally {
  if (ownAppRecord()) devStop();
  for (const server of capture) server.close();
}
report.passed = failure === null;
if (failure) report.error = failure instanceof Error ? failure.message : String(failure);
report.finishedAt = new Date().toISOString();
writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
const logger = createOpenBotLogger("unclean-exit-e2e");
if (failure) logger.error(`Failed: ${report.error}`);
else logger.info(`Passed. Wrote ${join(OUT, "report.json")}.`);
if (failure) process.exitCode = 1;
