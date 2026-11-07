// The programs that OpenBot itself starts for an agent, with their output and exit code (#PR3).
//
// A provider shell can leave a program behind, but it cannot show what the program writes while it
// runs: OpenCode sends a tool update only when the call ends, and a detached `nohup` has no caller
// left. This store starts the program under OpenBot instead, keeps its output in a log file, and
// records the exit code, so a conversation can show the last line while the program runs.

import { type ChildProcess, spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { mkdir, open, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BackgroundTask } from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { redactText } from "@openbot/logging";
import { AGENT_PROCESS_VARIABLE } from "./server-memory";

const MAX_COMMAND_LENGTH = 500;
const MAX_TITLE_LENGTH = 120;
/** The log keeps at most this much on disk, so a download that prints often cannot fill the disk. */
const LOG_LIMIT_BYTES = 5 * 1024 * 1024;
/**
 * When the log passes the limit it is cut back to this much. A smaller tail than the limit means the
 * file is not rewritten again after a few more bytes, which a busy program would otherwise cause.
 */
const LOG_KEEP_BYTES = 1 * 1024 * 1024;
/** How often a running log may be measured and cut, so a fast writer cannot stall the poll. */
const LOG_TRIM_INTERVAL_MS = 2_000;
const LAST_LINE_BYTES = 8 * 1024;
const LAST_LINE_LENGTH = 160;
const MAX_KEPT_TASKS = 50;
const STOP_GRACE_MS = 3_000;
const STOP_CHECK_INTERVAL_MS = 100;
const LOG_FILE = "output.log";
const EXIT_FILE = "output.log.exit";

interface StoredTask extends BackgroundTask {
  workspace: string;
}

export interface StartBackgroundTaskInput {
  agentId: string;
  workspace: string;
  command: string;
  title?: string | undefined;
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** The escape sequences a program writes for colour and cursor moves, which a row does not show. */
const ANSI_CODES = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[A-Za-z]`, "gu");

/** The last line a running program wrote, with the terminal control codes that it may contain. */
export function lastLogLine(text: string): string {
  const cleaned = text.replace(ANSI_CODES, "");
  const lines = cleaned.split(/\r?\n|\r/gu);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = (lines[index] ?? "").replace(/\s+/gu, " ").trim();
    if (line.length === 0) continue;
    return redactText(line).slice(0, LAST_LINE_LENGTH);
  }
  return "";
}

function callerArguments(command: string): [string, string[]] {
  if (process.platform === "win32") return ["cmd.exe", ["/d", "/s", "/c", command]];
  return ["/bin/sh", ["-c", command]];
}

/** One path as a shell word, so a folder with a space or a quote still names the same file. */
function shellQuote(value: string): string {
  return `'${value.split("'").join(`'\\''`)}'`;
}

/**
 * The command in a subshell, so an `exit` inside it does not skip the line that records the code.
 * The wrapper outlives OpenBot: even when the app quits first, the program writes its own exit file.
 */
function commandWithExitFile(command: string, exitPath: string): string {
  return `( ${command}\n); printf %s $? > ${shellQuote(exitPath)}`;
}

export class BackgroundTasks {
  readonly #root: string;
  readonly #file: string;
  readonly #tasks = new Map<string, StoredTask>();
  readonly #children = new Map<string, ChildProcess>();
  /** Tasks whose stop the app asked for, so their exit reads as stopped, not finished. */
  readonly #stopping = new Set<string>();
  /** When each task's log was last measured, so trimming runs at most once per interval. */
  readonly #trimmedAt = new Map<string, number>();
  #loaded: Promise<void> | null = null;
  /** Writes run one after another, so two settlements cannot rename the file at once. */
  #saving: Promise<void> = Promise.resolve();

  constructor(root: string) {
    this.#root = root;
    this.#file = join(root, "tasks.json");
    // A log that is measured only when a page polls would grow while the window is hidden.
    setInterval(() => void this.#trimRunningLogs(), LOG_TRIM_INTERVAL_MS).unref();
  }

  async list(agentId: string): Promise<BackgroundTask[]> {
    await this.#load();
    await this.#reconcile();
    const tasks = [...this.#tasks.values()]
      .filter((task) => task.agentId === agentId)
      .sort((left, right) => right.startedAt - left.startedAt);
    // A running task writes to its log the whole time, so read the tail here
    // instead of making the card ask for every row again.
    return Promise.all(
      tasks.map(async (task) => {
        const presented = this.#present(task);
        if (presented.status === "running") {
          presented.lastLine = await this.#readLastLine(task.id);
          await this.#trimLog(task.id);
        }
        return presented;
      }),
    );
  }

  async start(input: StartBackgroundTaskInput): Promise<BackgroundTask> {
    await this.#load();
    const id = crypto.randomUUID();
    const folder = join(this.#root, id);
    await mkdir(folder, { recursive: true });
    const logPath = join(folder, LOG_FILE);
    const exitPath = join(folder, EXIT_FILE);
    const startedAt = Date.now();
    const record: StoredTask = {
      id,
      agentId: input.agentId,
      command: redactText(input.command).slice(0, MAX_COMMAND_LENGTH),
      title: (input.title?.trim() || firstLine(input.command)).slice(0, MAX_TITLE_LENGTH),
      pid: 0,
      startedAt,
      endedAt: null,
      exitCode: null,
      status: "running",
      lastLine: "",
      logPath,
      workspace: input.workspace,
    };
    const command = process.platform === "win32" ? input.command : commandWithExitFile(input.command, exitPath);
    const [caller, args] = callerArguments(command);
    const fd = openSync(logPath, "a");
    let child: ChildProcess;
    try {
      child = spawn(caller, args, {
        cwd: input.workspace,
        detached: true,
        stdio: ["ignore", fd, fd],
        env: { ...process.env, [AGENT_PROCESS_VARIABLE]: "1" },
      });
    } finally {
      closeSync(fd);
    }
    await new Promise<void>((resolve, reject) => {
      const failed = (cause: unknown) => reject(cause instanceof Error ? cause : new Error(String(cause)));
      child.once("error", failed);
      child.once("spawn", () => resolve());
    });
    record.pid = child.pid ?? 0;
    this.#tasks.set(id, record);
    this.#children.set(id, child);
    child.once("exit", (code) => {
      const stopped = this.#stopping.delete(id);
      void this.#finish(id, stopped, code);
    });
    child.unref();
    await this.#save();
    return this.#present(record);
  }

  async tail(id: string, maxBytes: number): Promise<string | null> {
    await this.#load();
    const task = this.#tasks.get(id);
    if (!task) return null;
    const logPath = join(this.#root, task.id, LOG_FILE);
    try {
      const info = await stat(logPath);
      const length = Math.min(info.size, Math.max(1, maxBytes));
      const handle = await open(logPath, "r");
      try {
        const buffer = Buffer.alloc(length);
        await handle.read(buffer, 0, length, info.size - length);
        return buffer.toString("utf8");
      } finally {
        await handle.close();
      }
    } catch {
      return "";
    }
  }

  async stop(id: string): Promise<void> {
    await this.#load();
    const task = this.#tasks.get(id);
    if (task?.status !== "running" || task.pid <= 0) return;
    this.#stopping.add(id);
    const group = process.platform === "win32" ? task.pid : -task.pid;
    try {
      process.kill(group, "SIGTERM");
    } catch {
      // The program ended on its own between the list and the stop.
    }
    for (let waited = 0; waited < STOP_GRACE_MS; waited += STOP_CHECK_INTERVAL_MS) {
      if (!isRunning(task.pid)) break;
      await new Promise((resolve) => setTimeout(resolve, STOP_CHECK_INTERVAL_MS));
    }
    if (isRunning(task.pid)) {
      try {
        process.kill(group, "SIGKILL");
      } catch {
        // Same: the end is what the stop wants.
      }
    }
    await this.#settle(id, null, "stopped");
  }

  #present(task: StoredTask): BackgroundTask {
    const { workspace: _workspace, ...presented } = task;
    return presented;
  }

  /** Reads the code that the program itself wrote when OpenBot was not around to see it end. */
  async #finish(id: string, stopped: boolean, code: number | null): Promise<void> {
    if (stopped) {
      await this.#settle(id, null, "stopped");
      return;
    }
    const [fileCode] = await this.#readExit(id);
    await this.#settle(id, fileCode ?? code);
  }

  async #settle(id: string, exitCode: number | null, status?: "stopped"): Promise<void> {
    const task = this.#tasks.get(id);
    if (task?.status !== "running") return;
    this.#children.delete(id);
    const endedAt = Date.now();
    task.endedAt = endedAt;
    task.exitCode = exitCode;
    task.status = status ?? (exitCode === null ? "unknown" : "finished");
    task.lastLine = await this.#readLastLine(id);
    await this.#trimLog(id, true);
    await writeFile(join(this.#root, id, EXIT_FILE), exitCode === null ? "" : String(exitCode)).catch(() => undefined);
    await this.#save();
  }

  async #readLastLine(id: string): Promise<string> {
    const logPath = join(this.#root, id, LOG_FILE);
    try {
      const info = await stat(logPath);
      const length = Math.min(info.size, LAST_LINE_BYTES);
      const handle = await open(logPath, "r");
      try {
        const buffer = Buffer.alloc(length);
        await handle.read(buffer, 0, length, info.size - length);
        return lastLogLine(buffer.toString("utf8"));
      } finally {
        await handle.close();
      }
    } catch {
      return "";
    }
  }

  /** Marks the programs that ended while OpenBot was not running. */
  async #reconcile(): Promise<void> {
    let changed = false;
    for (const task of this.#tasks.values()) {
      if (task.status !== "running" || this.#children.has(task.id)) continue;
      const [exitCode, endedAt] = await this.#readExit(task.id);
      if (endedAt !== null) {
        task.status = exitCode === null ? "unknown" : "finished";
        task.exitCode = exitCode;
        task.endedAt = endedAt;
        task.lastLine = await this.#readLastLine(task.id);
        changed = true;
      } else if (task.pid > 0 && !isRunning(task.pid)) {
        task.status = "unknown";
        task.endedAt = Date.now();
        task.lastLine = await this.#readLastLine(task.id);
        changed = true;
      }
    }
    if (changed) await this.#save();
  }

  async #readExit(id: string): Promise<[number | null, number | null]> {
    const exitPath = join(this.#root, id, EXIT_FILE);
    try {
      const text = (await readFile(exitPath, "utf8")).trim();
      const code = text === "" ? null : Number(text);
      const info = await stat(exitPath);
      return [Number.isInteger(code) ? code : null, info.mtimeMs];
    } catch {
      return [null, null];
    }
  }

  /** Cuts a log that passed the limit back to its tail; the program keeps appending after it. */
  async #trimLog(id: string, force = false): Promise<void> {
    const now = Date.now();
    if (!force && now - (this.#trimmedAt.get(id) ?? 0) < LOG_TRIM_INTERVAL_MS) return;
    this.#trimmedAt.set(id, now);
    const logPath = join(this.#root, id, LOG_FILE);
    try {
      const info = await stat(logPath);
      if (info.size <= LOG_LIMIT_BYTES) return;
      const length = Math.min(info.size, LOG_KEEP_BYTES);
      const handle = await open(logPath, "r");
      try {
        const buffer = Buffer.alloc(length);
        await handle.read(buffer, 0, length, info.size - length);
        await writeFile(logPath, buffer);
      } finally {
        await handle.close();
      }
    } catch {
      // A program that wrote nothing has no log to trim.
    }
  }

  /** Trims the log of every running task, so a hidden window cannot let one grow without bound. */
  async #trimRunningLogs(): Promise<void> {
    if (!this.#loaded) return;
    for (const task of this.#tasks.values()) {
      if (task.status === "running") await this.#trimLog(task.id);
    }
  }

  async #load(): Promise<void> {
    if (this.#loaded) return this.#loaded;
    this.#loaded = (async () => {
      await mkdir(this.#root, { recursive: true });
      try {
        const parsed = JSON.parse(await readFile(this.#file, "utf8"));
        if (!Array.isArray(parsed)) return;
        for (const entry of parsed) {
          if (!isStoredTask(entry)) continue;
          this.#tasks.set(entry.id, entry);
        }
      } catch {
        // A first run, or a file that a crash left half written.
      }
    })();
    return this.#loaded;
  }

  #save(): Promise<void> {
    this.#saving = this.#saving
      .then(async () => {
        const tasks = [...this.#tasks.values()].sort((left, right) => right.startedAt - left.startedAt);
        // The oldest finished programs leave first; a running one never does.
        const kept = tasks.slice(0, MAX_KEPT_TASKS);
        this.#tasks.clear();
        for (const task of kept) this.#tasks.set(task.id, task);
        const temporary = `${this.#file}.tmp`;
        await writeFile(temporary, JSON.stringify(kept, null, 2), "utf8");
        await rename(temporary, this.#file);
      })
      .catch(() => undefined);
    return this.#saving;
  }
}

function firstLine(command: string): string {
  return command.split(/\r?\n/gu)[0] ?? command;
}

function isStoredTask(value: unknown): value is StoredTask {
  if (!isDynamicRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.agentId === "string" &&
    typeof value.command === "string" &&
    typeof value.title === "string" &&
    typeof value.pid === "number" &&
    typeof value.startedAt === "number" &&
    typeof value.logPath === "string" &&
    (value.status === "running" ||
      value.status === "finished" ||
      value.status === "stopped" ||
      value.status === "unknown") &&
    typeof value.workspace === "string"
  );
}
