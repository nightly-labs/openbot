import { type ChildProcess, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { utilityProcess } from "electron";
import type { LaunchedProcess, ProcessLaunchOptions } from "../backend/process-launch";
import {
  PROCESS_LAUNCHER_START_DEADLINE_MS,
  type ProcessLauncherEvent,
  type ProcessLauncherRequest,
} from "./process-launcher-protocol";

const logger = createOpenBotLogger("process-launcher");

const MAX_FAILED_HOST_STARTS = 3;

export interface ProcessLauncherHost {
  send(request: ProcessLauncherRequest): void;
  onEvent(listener: (event: ProcessLauncherEvent) => void): void;
  onExit(listener: (code: number) => void): void;
  kill(): void;
}

export function forkProcessLauncherHost(hostPath = join(__dirname, "process-launcher-host.js")): ProcessLauncherHost {
  const child = utilityProcess.fork(hostPath, [], {
    serviceName: "OpenBot process launcher",
    stdio: "ignore",
  });
  return {
    send: (request) => child.postMessage(request),
    onEvent: (listener) => {
      child.on("message", (event: ProcessLauncherEvent) => listener(event));
    },
    onExit: (listener) => {
      child.once("exit", listener);
    },
    kill: () => {
      child.kill();
    },
  };
}

interface ChildTarget {
  write(chunk: Buffer): void;
  end(): void;
  kill(signal: NodeJS.Signals): void;
}

class LauncherChild extends EventEmitter implements LaunchedProcess {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  killed = false;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  #target: ChildTarget | null = null;
  #requestedSignal: NodeJS.Signals | null = null;
  #done = false;

  attach(target: ChildTarget): void {
    this.#target = target;
    this.stdin.on("data", (chunk: Buffer) => target.write(chunk));
    this.stdin.once("end", () => target.end());
    if (this.#requestedSignal) target.kill(this.#requestedSignal);
  }

  kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
    if (this.#done) return false;
    this.killed = true;
    if (this.#target) this.#target.kill(signal);
    else this.#requestedSignal = signal;
    return true;
  }

  output(stream: "stdout" | "stderr", data: Uint8Array): void {
    if (!this.#done) this[stream].write(data);
  }

  exited(code: number | null, signal: NodeJS.Signals | null): void {
    if (!this.#finish()) return;
    this.exitCode = code;
    this.signalCode = signal;
    this.emit("exit", code, signal);
  }

  failed(error: Error): void {
    if (!this.#finish()) return;
    if (this.listenerCount("error") > 0) this.emit("error", error);
  }

  #finish(): boolean {
    if (this.#done) return false;
    this.#done = true;
    this.stdout.end();
    this.stderr.end();
    return true;
  }
}

function definedEnvironment(env: ProcessLaunchOptions["env"]): Record<string, string> {
  const defined: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) if (value !== undefined) defined[key] = value;
  return defined;
}

function launchError(message: string, code: string | null): Error {
  return Object.assign(new Error(message), code ? { code } : {});
}

function spawnDirectly(child: LauncherChild, options: ProcessLaunchOptions): void {
  let spawned: ChildProcess;
  try {
    spawned = spawn(options.command, [...options.args], {
      cwd: options.cwd,
      env: definedEnvironment(options.env),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
  } catch (error) {
    queueMicrotask(() => child.failed(error instanceof Error ? error : new Error(String(error))));
    return;
  }
  spawned.stdout?.on("data", (data: Buffer) => child.output("stdout", data));
  spawned.stderr?.on("data", (data: Buffer) => child.output("stderr", data));
  spawned.stdin?.on("error", () => {});
  spawned.stdout?.on("error", () => {});
  spawned.stderr?.on("error", () => {});
  spawned.on("error", (error) => {
    if (spawned.pid === undefined) child.failed(error);
  });
  spawned.on("close", (code, signal) => {
    if (spawned.pid !== undefined) child.exited(code, signal);
  });
  child.attach({
    write: (chunk) => spawned.stdin?.write(chunk),
    end: () => spawned.stdin?.end(),
    kill: (signal) => spawned.kill(signal),
  });
}

interface PendingLaunch {
  readonly id: number;
  readonly child: LauncherChild;
  readonly options: ProcessLaunchOptions;
}

export class ProcessLauncher {
  readonly #startHost: () => ProcessLauncherHost;
  #host: ProcessLauncherHost | null = null;
  #ready = false;
  #startDeadline: ReturnType<typeof setTimeout> | undefined;
  #pending: PendingLaunch[] = [];
  readonly #children = new Map<number, LauncherChild>();
  #nextId = 1;
  #failedStarts = 0;
  #disposed = false;

  constructor(startHost: () => ProcessLauncherHost = forkProcessLauncherHost) {
    this.#startHost = startHost;
  }

  readonly launch = (options: ProcessLaunchOptions): LaunchedProcess => {
    const child = new LauncherChild();
    const host = this.#availableHost();
    if (!host) {
      spawnDirectly(child, options);
      return child;
    }
    const launch = { id: this.#nextId++, child, options };
    if (this.#ready) this.#spawnInHost(host, launch);
    else this.#pending.push(launch);
    return child;
  };

  dispose(): void {
    this.#disposed = true;
    this.#stopHost();
  }

  #availableHost(): ProcessLauncherHost | null {
    if (this.#host) return this.#host;
    if (this.#disposed || this.#failedStarts >= MAX_FAILED_HOST_STARTS) return null;
    let host: ProcessLauncherHost;
    try {
      host = this.#startHost();
    } catch (error) {
      this.#failedStarts += 1;
      logger.warn("Could not start the process launcher.", toLogValue(error));
      return null;
    }
    this.#host = host;
    this.#ready = false;
    host.onEvent((event) => {
      if (this.#host === host) this.#accept(host, event);
    });
    host.onExit((code) => {
      if (this.#host === host) this.#lostHost(code);
    });
    this.#startDeadline = setTimeout(() => {
      if (this.#host !== host || this.#ready) return;
      logger.warn("The process launcher did not start in time.");
      this.#stopHost();
    }, PROCESS_LAUNCHER_START_DEADLINE_MS);
    return host;
  }

  #accept(host: ProcessLauncherHost, event: ProcessLauncherEvent): void {
    if (event.kind === "ready") {
      clearTimeout(this.#startDeadline);
      this.#ready = true;
      this.#failedStarts = 0;
      const pending = this.#pending;
      this.#pending = [];
      for (const launch of pending) this.#spawnInHost(host, launch);
      return;
    }
    const child = this.#children.get(event.id);
    if (!child) return;
    switch (event.kind) {
      case "stdout":
      case "stderr":
        child.output(event.kind, event.data);
        return;
      case "error":
        if (!event.spawnFailed) return;
        this.#children.delete(event.id);
        child.failed(launchError(event.message, event.code));
        return;
      case "exit":
        this.#children.delete(event.id);
        child.exited(event.code, event.signal);
        return;
    }
  }

  #spawnInHost(host: ProcessLauncherHost, { id, child, options }: PendingLaunch): void {
    this.#children.set(id, child);
    host.send({
      kind: "spawn",
      id,
      command: options.command,
      args: [...options.args],
      cwd: options.cwd,
      env: definedEnvironment(options.env),
    });
    child.attach({
      write: (chunk) => host.send({ kind: "stdin", id, data: new Uint8Array(chunk) }),
      end: () => host.send({ kind: "stdin-end", id }),
      kill: (signal) => host.send({ kind: "kill", id, signal }),
    });
  }

  #lostHost(code: number): void {
    if (!this.#ready) this.#failedStarts += 1;
    if (!this.#disposed) logger.warn("The process launcher stopped.", { code, ready: this.#ready });
    this.#release();
  }

  #stopHost(): void {
    const host = this.#host;
    if (!host) return;
    if (!this.#ready) this.#failedStarts += 1;
    this.#release();
    host.kill();
  }

  #release(): void {
    clearTimeout(this.#startDeadline);
    this.#host = null;
    this.#ready = false;
    const pending = this.#pending;
    this.#pending = [];
    for (const launch of pending) spawnDirectly(launch.child, launch.options);
    const children = [...this.#children.values()];
    this.#children.clear();
    for (const child of children) child.exited(null, "SIGKILL");
  }
}
