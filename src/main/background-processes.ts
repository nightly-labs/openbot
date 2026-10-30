// The programs that agents left running, such as a dev server that `nohup ... &` started (#3961).
//
// Each provider process gets `AGENT_PROCESS_VARIABLE`, and so every program that an agent starts.
// When the shell of a tool call ends, the system adopts a program that it left in the background:
// its parent becomes PID 1, or a subreaper such as `systemd --user` on Linux. A process with the
// variable and such a parent is the root of a left program, also after OpenBot quit and started
// again. A provider process that OpenBot runs has OpenBot as its parent, so it is never one.
//
// macOS shows the environment of a program, but not of an Apple system program such as `/bin/sleep`.
// Such a program is not found. The environment stays in memory: it can hold secrets.

import { execFile } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import { sep } from "node:path";
import type { BackgroundProcess } from "@openbot/contracts/ipc";
import { redactText } from "@openbot/logging";
import { Effect, Schema } from "effect";
import { causeHelpers } from "../backend/effect-boundary";
import { AGENT_PROCESS_VARIABLE } from "./server-memory";

class BackgroundProcessFailure extends Schema.TaggedError<BackgroundProcessFailure>()("BackgroundProcessFailure", {
  cause: Schema.Defect(),
}) {}

const { io } = causeHelpers(BackgroundProcessFailure);

const COMMAND_TIMEOUT_MS = 5_000;
// With `-E`, macOS writes the environment of each process after its command line.
const COMMAND_MAX_BUFFER = 32 * 1024 * 1024;
const MAX_COMMAND_LENGTH = 500;
/** How long a stopped tree has to end after SIGTERM, before SIGKILL. */
const STOP_GRACE_MS = 3_000;
const STOP_CHECK_INTERVAL_MS = 100;
const MARKER = `${AGENT_PROCESS_VARIABLE}=1`;

export interface BackgroundProcessAgent {
  id: string;
  workspacePath: string;
}

interface ProcessRow {
  pid: number;
  ppid: number;
  uid: number;
  startedAt: number;
  command: string;
}

interface LeftProcess {
  root: ProcessRow;
  /** The root first, then its descendants. */
  tree: ProcessRow[];
}

/**
 * `ps` runs in the C locale: `lstart` is then `Fri Oct 30 14:42:59 2026` on macOS and with procps. lsof
 * keeps the user's locale, because in the C locale it writes a non-ASCII byte of a path as `\xNN`.
 */
function run(command: string, args: readonly string[]): Effect.Effect<string, BackgroundProcessFailure> {
  return io(
    (signal) =>
      new Promise<string>((resolve, reject) => {
        execFile(
          command,
          args,
          {
            encoding: "utf8",
            timeout: COMMAND_TIMEOUT_MS,
            maxBuffer: COMMAND_MAX_BUFFER,
            signal,
            env: command === "ps" ? { ...process.env, LC_ALL: "C" } : process.env,
          },
          (error, stdout) => {
            // lsof exits with 1 when no file matches.
            if (error && !(command === "lsof" && error.code === 1)) reject(error);
            else resolve(stdout);
          },
        );
      }),
  );
}

function parseProcessTable(text: string): ProcessRow[] {
  const rows: ProcessRow[] = [];
  for (const line of text.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\w{3}\s+\w{3}\s+\d+\s+[\d:]{8}\s+\d{4})\s+(.+?)\s*$/u.exec(line);
    if (!match) continue;
    const [, pid, ppid, uid, started, command] = match;
    const startedAt = Date.parse(started ?? "");
    if (Number.isNaN(startedAt) || !command) continue;
    rows.push({ pid: Number(pid), ppid: Number(ppid), uid: Number(uid), startedAt, command });
  }
  return rows;
}

const readProcessTable = run("ps", ["-A", "-ww", "-o", "pid=,ppid=,uid=,lstart=,command="]).pipe(
  Effect.map(parseProcessTable),
);

/** The pids of `candidates` whose environment has the marker. */
const markedProcesses = Effect.fn("BackgroundProcesses.marked")(function* (
  platform: NodeJS.Platform,
  candidates: readonly number[],
) {
  if (candidates.length === 0) return new Set<number>();
  if (platform === "linux") {
    const marked = yield* Effect.forEach(
      candidates,
      (pid) =>
        io(() => readFile(`/proc/${pid}/environ`, "latin1")).pipe(
          Effect.map((environment) => `\0${environment}\0`.includes(`\0${MARKER}\0`)),
          // A process can end during the pass.
          Effect.orElseSucceed(() => false),
        ),
      { concurrency: 16 },
    );
    return new Set(candidates.filter((_, index) => marked[index]));
  }
  const text = yield* run("ps", ["-ww", "-E", "-o", "pid=,command=", "-p", candidates.join(",")]);
  const marked = new Set<number>();
  for (const line of text.split("\n")) {
    const match = /^\s*(\d+)\s(.*)$/u.exec(line);
    if (match && ` ${match[2]} `.includes(` ${MARKER} `)) marked.add(Number(match[1]));
  }
  return marked;
});

/** The left programs of this user, each with its descendants. */
const findLeftProcesses = Effect.fn("BackgroundProcesses.find")(function* (platform: NodeJS.Platform) {
  const rows = yield* readProcessTable;
  const uid = process.getuid?.() ?? -1;
  const children = new Map<number, ProcessRow[]>();
  for (const row of rows) {
    const siblings = children.get(row.ppid) ?? [];
    siblings.push(row);
    children.set(row.ppid, siblings);
  }
  // On Linux a desktop session adopts orphans in the user's systemd manager, not in PID 1.
  const reapers = new Set(
    rows.filter((row) => row.uid === uid && /(^|\/)systemd --user\b/u.test(row.command)).map((row) => row.pid),
  );
  const candidates = rows.filter(
    (row) => row.uid === uid && row.pid !== process.pid && (row.ppid === 1 || reapers.has(row.ppid)),
  );
  const marked = yield* markedProcesses(
    platform,
    candidates.map((row) => row.pid),
  );
  const left: LeftProcess[] = [];
  for (const root of candidates) {
    if (!marked.has(root.pid)) continue;
    const tree = [root];
    for (let index = 0; index < tree.length; index++) tree.push(...(children.get(tree[index]?.pid ?? -1) ?? []));
    // An OpenBot that an agent started is never stopped from this one.
    if (tree.some((row) => row.pid === process.pid)) continue;
    left.push({ root, tree });
  }
  return left;
});

function processId(row: ProcessRow): string {
  return `${row.pid}:${row.startedAt}`;
}

/** `lsof -F` writes one field a line: `p` starts a process, `n` is a name. */
function parseLsof(text: string): Map<number, string[]> {
  const names = new Map<number, string[]>();
  let current: string[] | null = null;
  for (const line of text.split("\n")) {
    if (line.startsWith("p")) {
      current = [];
      names.set(Number(line.slice(1)), current);
    } else if (line.startsWith("n")) current?.push(line.slice(1));
  }
  return names;
}

/** lsof can be missing on Linux. Then ports and owners are not known. */
function lsof(args: readonly string[]): Effect.Effect<Map<number, string[]>> {
  return run("lsof", ["-nP", "-F", "pn", ...args]).pipe(
    Effect.map(parseLsof),
    Effect.orElseSucceed(() => new Map<number, string[]>()),
  );
}

function ownerOf(cwd: string | undefined, agents: readonly BackgroundProcessAgent[]): string | null {
  if (!cwd) return null;
  let owner: BackgroundProcessAgent | null = null;
  for (const agent of agents) {
    const inside = cwd === agent.workspacePath || cwd.startsWith(`${agent.workspacePath}${sep}`);
    if (inside && agent.workspacePath.length > (owner?.workspacePath.length ?? -1)) owner = agent;
  }
  return owner?.id ?? null;
}

/** Null on Windows, where OpenBot cannot find these programs. */
export const listBackgroundProcesses = Effect.fn("BackgroundProcesses.list")(function* (
  platform: NodeJS.Platform,
  agents: readonly BackgroundProcessAgent[],
) {
  if (platform === "win32") return null;
  const left = yield* findLeftProcesses(platform);
  if (left.length === 0) return [];
  const roots = left.map(({ root }) => root.pid).join(",");
  const everyPid = left.flatMap(({ tree }) => tree.map((row) => row.pid)).join(",");
  const [cwds, listening] = yield* Effect.all(
    [lsof(["-a", "-d", "cwd", "-p", roots]), lsof(["-a", "-iTCP", "-sTCP:LISTEN", "-p", everyPid])],
    { concurrency: 2 },
  );
  // lsof gives the real path of a folder, such as `/private/tmp` for `/tmp` on macOS.
  const workspaces = yield* Effect.forEach(
    agents,
    (agent) =>
      io(() => realpath(agent.workspacePath)).pipe(
        Effect.orElseSucceed(() => agent.workspacePath),
        Effect.map((workspacePath) => ({ id: agent.id, workspacePath })),
      ),
    { concurrency: 16 },
  );
  return left
    .map(({ root, tree }): BackgroundProcess => {
      const ports = new Set<number>();
      for (const row of tree) {
        for (const address of listening.get(row.pid) ?? []) {
          const port = Number(address.slice(address.lastIndexOf(":") + 1));
          if (Number.isInteger(port) && port > 0) ports.add(port);
        }
      }
      return {
        id: processId(root),
        pid: root.pid,
        command: redactText(root.command).slice(0, MAX_COMMAND_LENGTH),
        startedAt: root.startedAt,
        ports: [...ports].sort((left, right) => left - right),
        agentId: ownerOf(cwds.get(root.pid)?.[0], workspaces),
      };
    })
    .sort((left, right) => right.startedAt - left.startedAt);
});

function signal(pid: number, name: NodeJS.Signals | 0): boolean {
  try {
    process.kill(pid, name);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ends one left program and its children: SIGTERM, then SIGKILL to each process that still runs
 * after `STOP_GRACE_MS`. The id must name a left program now, so a page cannot signal another process.
 */
export const stopBackgroundProcess = Effect.fn("BackgroundProcesses.stop")(function* (
  platform: NodeJS.Platform,
  id: string,
) {
  if (platform === "win32") return;
  const found = (yield* findLeftProcesses(platform)).find(({ root }) => processId(root) === id);
  if (!found) return;
  const pids = found.tree.map((row) => row.pid);
  for (const pid of pids) signal(pid, "SIGTERM");
  for (let waited = 0; waited < STOP_GRACE_MS; waited += STOP_CHECK_INTERVAL_MS) {
    if (!pids.some((pid) => signal(pid, 0))) return;
    yield* Effect.sleep(STOP_CHECK_INTERVAL_MS);
  }
  // A pid that ended in the grace period can name a new program now: only the same start is killed.
  const current = new Map((yield* readProcessTable).map((row) => [row.pid, row.startedAt]));
  for (const row of found.tree) if (current.get(row.pid) === row.startedAt) signal(row.pid, "SIGKILL");
});
