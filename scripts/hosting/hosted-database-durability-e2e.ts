import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { type DynamicRecord, isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger, registerSecretValue } from "@openbot/logging";

const logger = createOpenBotLogger("hosted-database-durability-e2e");
const BOAT_API_URL = "https://boat.dev/api/v1";
const TTL_SECONDS = 7200;
const REMOTE_DIRECTORY = "/home/user/openbot-durability";
const REPORT_DIRECTORY = join(process.cwd(), ".openbot-build", "hosted-database-durability");
const WRITER_UNIT = "openbot-durability-writer.service";
const PRE_STOP_FLAG = "/run/openbot-durability-pre-stop";
const BOAT_PRE_STOP = "/home/user/.boat/pre-stop";
const SAVED_PRE_STOP = `${REMOTE_DIRECTORY}/openbot-pre-stop`;
const WRITER_PRE_STOP = `${REMOTE_DIRECTORY}/writer-pre-stop`;

const MODES = ["live", "pre-stop"] as const;
type Mode = (typeof MODES)[number];

interface Options {
  sandboxId: string;
  cycles: number;
  mode: Mode;
}

interface CycleReport {
  cycle: number;
  check: DynamicRecord | null;
  writer?: DynamicRecord | null;
  pathView?: DynamicRecord | null;
  restored: boolean | undefined;
  writeSeconds?: number;
  stoppedBy: "script" | "other";
}

const WRITER = `
import json, os, signal, sqlite3, sys, time
db_path, status_path = sys.argv[1], sys.argv[2]
c = sqlite3.connect(db_path, isolation_level=None, timeout=5)
c.execute("pragma journal_mode=wal")
c.execute("pragma synchronous=normal")
c.execute("create table if not exists rows(seq integer primary key, at real, body blob)")
state = {"stopped": False}
signal.signal(signal.SIGTERM, lambda *_: state.update(stopped=True))
seq = c.execute("select coalesce(max(seq), 0) from rows").fetchone()[0]
first = seq
def status():
    tmp = status_path + ".tmp"
    with open(tmp, "w") as f:
        json.dump({"pid": os.getpid(), "first": first, "seq": seq, "at": time.time(), **state}, f)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, status_path)
while not state["stopped"]:
    seq += 1
    c.execute("begin")
    c.execute("insert into rows values(?, ?, ?)", (seq, time.time(), os.urandom(16384)))
    c.execute("delete from rows where seq <= ?", (seq - 1500,))
    c.execute("commit")
    if seq % 20 == 0:
        status()
    time.sleep(0.03)
status()
c.close()
`;

const CHECK = `
import json, os, shutil, sqlite3, struct, subprocess, sys
source, target, flag = sys.argv[1], sys.argv[2], sys.argv[3]
shutil.rmtree(target, ignore_errors=True)
os.makedirs(target)
present = os.path.exists(source + "/test.db")
result = {"present": present, "preStopFlag": os.path.exists(flag)}
try:
    result["writer"] = json.load(open(source + "/writer.json"))
except Exception:
    result["writer"] = None
result["bootId"] = open("/proc/sys/kernel/random/boot_id").read().strip()
result["uptime"] = float(open("/proc/uptime").read().split()[0])
def scan(path):
    data = open(path, "rb").read()
    if len(data) < 32:
        return {"bytes": len(data)}
    magic, version, size, sequence, salt1, salt2, sum1, sum2 = struct.unpack(">8I", data[:32])
    order = "<" if magic & 1 == 0 else ">"
    def checksum(buf, a, b):
        words = struct.unpack(order + str(len(buf) // 4) + "I", buf)
        for i in range(0, len(words), 2):
            a = (a + words[i] + b) & 0xffffffff
            b = (b + words[i + 1] + a) & 0xffffffff
        return a, b
    a, b = checksum(data[:24], 0, 0)
    result = {"header": magic in (0x377f0682, 0x377f0683) and (a, b) == (sum1, sum2), "frames": 0, "committed": 0}
    offset = 32
    while result["header"] and offset + 24 + size <= len(data):
        page, commit, frame1, frame2, check1, check2 = struct.unpack(">6I", data[offset:offset + 24])
        a, b = checksum(data[offset:offset + 8], a, b)
        a, b = checksum(data[offset + 24:offset + 24 + size], a, b)
        if (frame1, frame2) != (salt1, salt2) or (a, b) != (check1, check2):
            break
        result["frames"] += 1
        if commit:
            result["committed"] = result["frames"]
        offset += 24 + size
    return result
result["fstype"] = subprocess.run(["findmnt", "-no", "FSTYPE", "-T", source], capture_output=True, text=True).stdout.strip()
result["hydrated"] = os.path.exists("/var/lib/ascii-lazy/hydration-done")
if present:
    for name in ("test.db", "test.db-wal"):
        if os.path.exists(source + "/" + name):
            shutil.copy2(source + "/" + name, target + "/" + name)
            result[name] = os.path.getsize(target + "/" + name)
    if os.path.exists(target + "/test.db-wal"):
        result["wal"] = scan(target + "/test.db-wal")
    try:
        c = sqlite3.connect(target + "/test.db", isolation_level=None)
        result["quickCheck"] = [row[0] for row in c.execute("pragma quick_check(100)")]
        result["maxSeq"] = c.execute("select coalesce(max(seq), 0) from rows").fetchone()[0]
    except Exception as error:
        result["error"] = repr(error)
print(json.dumps(result))
`;

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const apiKey = process.env.BOAT_API_KEY?.trim();
  if (!apiKey) throw new Error("Set BOAT_API_KEY to a boat key with sandbox and command access.");
  registerSecretValue(apiKey);
  const boat = boatRequester(apiKey);
  const cycles: CycleReport[] = [];
  const startedAt = new Date().toISOString();
  let finalCheck: DynamicRecord | null = null;
  let stoppedBootId: unknown;
  await ensureRunning(boat, options.sandboxId);
  await saveOpenBotHook(boat, options.sandboxId);
  for (let cycle = 1; cycle <= options.cycles; cycle += 1) {
    await ensureRunning(boat, options.sandboxId);
    if (cycle === 1) {
      await command(
        boat,
        options.sandboxId,
        `rm -f ${REMOTE_DIRECTORY}/test.db ${REMOTE_DIRECTORY}/test.db-wal ${REMOTE_DIRECTORY}/test.db-shm`,
      );
    }
    const check = await checkDatabase(boat, options.sandboxId);
    const restored = stoppedBootId === undefined ? undefined : check?.bootId !== stoppedBootId;
    logger.info("Checked the restored test database.", { cycle, restored, check });
    if (check?.present === true && !isGood(check, options.mode)) {
      await restoreOpenBotHook(boat, options.sandboxId);
      cycles.push({ cycle, check, restored, stoppedBy: await stop(boat, options.sandboxId) });
      break;
    }
    await installHook(boat, options.sandboxId, options.mode);
    await startWriter(boat, options.sandboxId, options.mode);
    const startedWriting = Date.now();
    await delay(randomSeconds(30, 120) * 1000);
    const writer = await readWriterStatus(boat, options.sandboxId);
    const pathView = await checkDatabase(boat, options.sandboxId);
    const writeSeconds = Math.round((Date.now() - startedWriting) / 1000);
    stoppedBootId = pathView?.bootId;
    const stoppedBy = await stop(boat, options.sandboxId);
    cycles.push({ cycle, check, restored, writer, pathView, writeSeconds, stoppedBy });
    logger.info("Stopped the sandbox during writes.", { cycle, writer, writeSeconds, stoppedBy });
  }
  if (cycles.length === options.cycles && cycles.at(-1)?.writer !== undefined) {
    await ensureRunning(boat, options.sandboxId);
    finalCheck = await checkDatabase(boat, options.sandboxId);
    if (finalCheck?.bootId === stoppedBootId) logger.warn("The sandbox did not start again before the final check.");
    await restoreOpenBotHook(boat, options.sandboxId);
    await stop(boat, options.sandboxId);
  }
  const checks = [...cycles.map((cycle) => cycle.check), finalCheck];
  const damaged = checks.filter((check) => check?.present === true && !isGood(check, options.mode)).length;
  const report = {
    sandboxId: options.sandboxId,
    mode: options.mode,
    startedAt,
    finishedAt: new Date().toISOString(),
    damaged,
    notRestored: cycles.filter((cycle) => cycle.restored === false).length,
    cycles,
    finalCheck,
  };
  await mkdir(REPORT_DIRECTORY, { recursive: true });
  const reportPath = join(REPORT_DIRECTORY, `${options.mode}-${startedAt.replaceAll(":", "-")}.json`);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  logger.info("Wrote the durability report.", { reportPath, damaged, cycles: options.cycles });
  if (damaged > 0) process.exitCode = 1;
}

function isGood(check: DynamicRecord, mode: Mode): boolean {
  const quickCheck = check.quickCheck;
  const healthy = Array.isArray(quickCheck) && quickCheck.length === 1 && quickCheck[0] === "ok";
  if (!healthy || mode !== "pre-stop" || check.writer === null) return healthy;
  const writer = isDynamicRecord(check.writer) ? check.writer : {};
  return writer.stopped === true && check.maxSeq === writer.seq && check.preStopFlag === false;
}

async function ensureRunning(boat: BoatRequester, sandboxId: string): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const state = await sandboxState(boat, sandboxId);
    if (state === "archived" || state === "stopped") {
      await boat("POST", `/sandboxes/${encodeURIComponent(sandboxId)}/resume`, "Resume", {
        body: { ttlSeconds: TTL_SECONDS },
      });
    }
    try {
      const body = await boat("POST", `/sandboxes/${encodeURIComponent(sandboxId)}/commands`, "Ready probe", {
        body: { command: "true", timeoutSeconds: 10 },
      });
      if (body.exitCode === 0) return;
    } catch (error) {
      if (!(error instanceof BoatRequestError) || error.status !== 409) throw error;
    }
    await delay(5_000);
  }
  throw new Error("The sandbox did not accept commands in 10 minutes.");
}

async function stop(boat: BoatRequester, sandboxId: string): Promise<CycleReport["stoppedBy"]> {
  let stoppedBy: CycleReport["stoppedBy"] = "script";
  try {
    await boat("POST", `/sandboxes/${encodeURIComponent(sandboxId)}/stop`, "Stop", { body: {} });
  } catch (error) {
    if (!(error instanceof BoatRequestError) || error.status !== 409) throw error;
    stoppedBy = "other";
  }
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if ((await sandboxState(boat, sandboxId)) === "archived") return stoppedBy;
    await delay(5_000);
  }
  throw new Error("The sandbox did not stop in 10 minutes.");
}

async function sandboxState(boat: BoatRequester, sandboxId: string): Promise<string> {
  const body = await boat("GET", `/sandboxes/${encodeURIComponent(sandboxId)}`, "Sandbox status");
  const sandbox = isDynamicRecord(body.sandbox) ? body.sandbox : body;
  return isString(sandbox.state) ? sandbox.state : "";
}

async function checkDatabase(boat: BoatRequester, sandboxId: string): Promise<DynamicRecord | null> {
  const output = await command(
    boat,
    sandboxId,
    `mkdir -p ${REMOTE_DIRECTORY} && python3 -I -c ${shellQuote(CHECK)} ${REMOTE_DIRECTORY} /tmp/openbot-durability-check ${PRE_STOP_FLAG}`,
  );
  return parseJson(output);
}

async function saveOpenBotHook(boat: BoatRequester, sandboxId: string): Promise<void> {
  await command(
    boat,
    sandboxId,
    `mkdir -p ${REMOTE_DIRECTORY} && if grep -q '^# openbot-boat-pre-stop:' ${BOAT_PRE_STOP} 2>/dev/null; then cp -p ${BOAT_PRE_STOP} ${SAVED_PRE_STOP}; fi`,
  );
}

async function restoreOpenBotHook(boat: BoatRequester, sandboxId: string): Promise<void> {
  await command(
    boat,
    sandboxId,
    `if [ -f ${SAVED_PRE_STOP} ]; then mv -f ${SAVED_PRE_STOP} ${BOAT_PRE_STOP}; else rm -f ${BOAT_PRE_STOP}; fi`,
  );
}

async function installHook(boat: BoatRequester, sandboxId: string, mode: Mode): Promise<void> {
  const writerHook = (await readFile(join(import.meta.dirname, "openbot-boat-pre-stop"), "utf8"))
    .replaceAll("openbot.service", WRITER_UNIT)
    .replaceAll("/run/openbot-pre-stop", PRE_STOP_FLAG);
  const hook = [
    "#!/bin/bash",
    "# Test hook of hosted-database-durability-e2e.ts.",
    "status=0",
    ...(mode === "pre-stop" ? [`${WRITER_PRE_STOP} || status=1`] : []),
    `if [ -f ${SAVED_PRE_STOP} ]; then /bin/bash ${SAVED_PRE_STOP} || status=1; fi`,
    "exit $status",
    "",
  ].join("\n");
  await command(
    boat,
    sandboxId,
    `printf %s ${shellQuote(writerHook)} > ${WRITER_PRE_STOP} && chmod 0755 ${WRITER_PRE_STOP} && ` +
      `mkdir -p ${BOAT_PRE_STOP.replace(/\/[^/]+$/u, "")} && printf %s ${shellQuote(hook)} > ${BOAT_PRE_STOP} && chmod 0755 ${BOAT_PRE_STOP}`,
  );
}

async function startWriter(boat: BoatRequester, sandboxId: string, mode: Mode): Promise<void> {
  await command(
    boat,
    sandboxId,
    `mkdir -p ${REMOTE_DIRECTORY} && rm -f ${REMOTE_DIRECTORY}/writer.json && printf %s ${shellQuote(WRITER)} > ${REMOTE_DIRECTORY}/writer.py`,
  );
  const writer = `python3 -I ${REMOTE_DIRECTORY}/writer.py ${REMOTE_DIRECTORY}/test.db ${REMOTE_DIRECTORY}/writer.json`;
  if (mode === "pre-stop") {
    await command(
      boat,
      sandboxId,
      `sudo -n systemd-run --quiet --unit=${WRITER_UNIT} --uid=user --gid=user --property=TimeoutStopSec=60 ${writer}`,
    );
    return;
  }
  await boat("POST", `/sandboxes/${encodeURIComponent(sandboxId)}/commands`, "Writer start", {
    body: { command: writer, detached: true },
  });
}

async function readWriterStatus(boat: BoatRequester, sandboxId: string): Promise<DynamicRecord | null> {
  return parseJson(await command(boat, sandboxId, `cat ${REMOTE_DIRECTORY}/writer.json 2>/dev/null || echo null`));
}

async function command(boat: BoatRequester, sandboxId: string, text: string): Promise<string> {
  const body = await boat("POST", `/sandboxes/${encodeURIComponent(sandboxId)}/commands`, "Command", {
    body: { command: text, timeoutSeconds: 120 },
  });
  const stdout = isString(body.stdout) ? body.stdout : "";
  if (body.exitCode !== 0) {
    const stderr = isString(body.stderr) ? body.stderr.slice(-1000) : "";
    throw new Error(`A sandbox command failed (exit ${String(body.exitCode)}): ${stderr}`);
  }
  return stdout;
}

function parseJson(text: string): DynamicRecord | null {
  try {
    const value = JSON.parse(text.trim());
    return isDynamicRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function randomSeconds(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

class BoatRequestError extends Error {
  readonly status: number;

  constructor(status: number, code: string, label: string) {
    super(`${label} failed: ${status} ${code}`);
    this.status = status;
  }
}

type BoatRequester = (
  method: string,
  path: string,
  label: string,
  options?: { body?: unknown },
) => Promise<DynamicRecord>;

function boatRequester(apiKey: string): BoatRequester {
  return async (method, path, label, options = {}) => {
    const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}`, Accept: "application/json" };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${BOAT_API_URL}${path}`, {
      method,
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      signal: AbortSignal.timeout(180_000),
    });
    const payload = parseJson(await response.text());
    if (!response.ok) {
      const code = payload && isString(payload.code) ? payload.code : "http_error";
      throw new BoatRequestError(response.status, code, label);
    }
    return payload ?? {};
  };
}

function parseOptions(argv: string[]): Options {
  const values = new Map(
    argv.map((argument) => {
      const match = /^--([a-z-]+)=(.*)$/u.exec(argument);
      if (!match) throw new Error(`Unknown argument: ${argument}`);
      return [match[1], match[2]] as const;
    }),
  );
  const sandboxId = values.get("sandbox") ?? "";
  if (!/^bx_[a-z0-9]+$/u.test(sandboxId)) throw new Error("Pass --sandbox=<boat sandbox id>.");
  const cycles = Number(values.get("cycles") ?? "10");
  if (!Number.isInteger(cycles) || cycles < 1 || cycles > 50) throw new Error("--cycles must be 1 to 50.");
  const mode = MODES.find((candidate) => candidate === (values.get("mode") ?? "live"));
  if (!mode) throw new Error(`--mode must be one of ${MODES.join(", ")}.`);
  return { sandboxId, cycles, mode };
}

await main();
