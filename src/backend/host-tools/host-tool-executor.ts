import { type ChildProcess, spawn } from "node:child_process";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { sourceText } from "@openbot/i18n/source";
import type { HostToolRequest, ListedMachine } from "./host-tool-types";
import { readResultMessage, shellResultMessage } from "./local-exec-frames";

export interface HostCommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

interface HostCaptureResult {
  readonly png: Uint8Array;
  readonly thumbnailPng: Uint8Array;
}

export interface HostExecutorDeps {
  readonly root: string;
  readonly computer: ListedMachine;
  readonly run: (command: string, cwd: string) => Promise<HostCommandResult>;
  readonly capture: () => Promise<HostCaptureResult | { readonly denied: true }>;
  readonly writeShot: (png: Uint8Array, thumbnail: Uint8Array) => Promise<{ path: string; thumbnailPath: string }>;
}

export interface HostActionResult {
  readonly ok: boolean;
  readonly text: string;
  readonly message: unknown;
  readonly stdout?: string;
  readonly exitCode?: number;
  readonly path?: string;
  readonly thumbnailPath?: string;
}

const shells = new Map<number, ChildProcess>();
let nextShellId = 1;

/** Stops background shells this process started. The end-to-end script calls this. */
/** Runs one foreground command. Background shells use `executeHostAction` instead. */
export function runHostCommand(command: string, cwd: string): Promise<HostCommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, { cwd, shell: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    });
    child.on("error", () => resolve({ code: 1, stdout, stderr }));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

export function closeBackgroundShells(): void {
  for (const child of shells.values()) {
    const pid = child.pid;
    child.kill("SIGTERM");
    if (pid !== undefined) {
      try {
        process.kill(-pid, "SIGTERM");
      } catch {
        // The process group is already gone.
      }
    }
    child.unref();
  }
  shells.clear();
}

/** Resolves `target` under `root`. Throws when the path leaves `root`. */
function containPath(root: string, target: string): string {
  const base = resolve(root);
  const resolved = resolve(base, target);
  const fromRoot = relative(base, resolved);
  if (fromRoot.startsWith("..") || isAbsolute(fromRoot)) {
    throw new Error(sourceText("error.backend.hostToolRefused"));
  }
  return resolved;
}

function unavailable(): HostActionResult {
  const text = sourceText("error.backend.hostToolMachineUnavailable");
  return { ok: false, text, message: { error: text } };
}

function refused(message: unknown): HostActionResult {
  const text = sourceText("error.backend.hostToolRefused");
  return { ok: false, text, message };
}

export async function executeHostAction(request: HostToolRequest, deps: HostExecutorDeps): Promise<HostActionResult> {
  if (request.machineId !== undefined && request.machineId !== deps.computer.id) return unavailable();
  if (request.action === "mcp") return unavailable();
  if (request.action === "shell") return runShell(request, deps);
  if (request.action === "screenshot") return captureScreen(deps);
  if (request.action === "read-file") return readContained(request, deps);
  if (request.action === "list-directory") return listContained(request, deps);
  if (request.action === "write-file") return writeContained(request, deps);
  if (request.action === "send-input") return sendInput(request);
  return unavailable();
}

async function runShell(request: HostToolRequest, deps: HostExecutorDeps): Promise<HostActionResult> {
  const command = request.command;
  if (command === undefined) return refused({ error: sourceText("error.backend.hostToolRefused") });
  const cwd = request.workingDirectory ?? deps.root;
  if (request.isBackground === true) return startBackgroundShell(command, cwd);
  const result = await deps.run(command, cwd);
  const text = `${result.stdout.trimEnd()}\n${sourceText("status.agent.hostToolExit", { code: String(result.code) })}`;
  return {
    ok: true,
    text,
    message: shellResultMessage(command, cwd, result.code, result.stdout, result.stderr),
    stdout: result.stdout,
    exitCode: result.code,
  };
}

function startBackgroundShell(command: string, cwd: string): HostActionResult {
  const shellId = nextShellId;
  nextShellId += 1;
  const child = spawn(command, {
    cwd,
    shell: true,
    detached: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.on("error", () => {
    shells.delete(shellId);
  });
  shells.set(shellId, child);
  const text = `shell ${shellId}`;
  return {
    ok: true,
    text,
    message: shellResultMessage(command, cwd, 0, text, ""),
    stdout: text,
  };
}

async function captureScreen(deps: HostExecutorDeps): Promise<HostActionResult> {
  const shot = await deps.capture();
  if ("denied" in shot) {
    const text = sourceText("error.backend.hostToolScreenCaptureDenied");
    return { ok: false, text, message: { computerUseResult: { error: { error: text } } } };
  }
  const written = await deps.writeShot(shot.png, shot.thumbnailPng);
  const text = `${written.path}\n${sourceText("status.agent.hostToolThumbnail", { path: written.thumbnailPath })}`;
  return {
    ok: true,
    text,
    message: {
      computerUseResult: { success: { actionCount: 1, durationMs: 0, screenshot: written.path } },
    },
    path: written.path,
    thumbnailPath: written.thumbnailPath,
  };
}

async function readContained(request: HostToolRequest, deps: HostExecutorDeps): Promise<HostActionResult> {
  const target = request.path;
  if (target === undefined) return refused({ readResult: { error: sourceText("error.backend.hostToolRefused") } });
  let resolved: string;
  try {
    resolved = containPath(deps.root, target);
  } catch {
    return refused({ readResult: { error: sourceText("error.backend.hostToolRefused") } });
  }
  const content = await readFile(resolved, "utf8");
  return {
    ok: true,
    text: content,
    message: readResultMessage(resolved, content),
  };
}

async function listContained(request: HostToolRequest, deps: HostExecutorDeps): Promise<HostActionResult> {
  const target = request.path;
  if (target === undefined) return refused({ error: sourceText("error.backend.hostToolRefused") });
  let resolved: string;
  try {
    resolved = containPath(deps.root, target);
  } catch {
    return refused({ lsResult: { error: sourceText("error.backend.hostToolRefused") } });
  }
  const entries = await readdir(resolved, { withFileTypes: true });
  const fileNames = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  const directories = entries.filter((entry) => entry.isDirectory());
  return {
    ok: true,
    text: fileNames.join("\n"),
    message: {
      lsResult: {
        success: {
          directoryTreeRoot: {
            absPath: resolved,
            childrenFiles: fileNames.map((name) => ({ name })),
            childrenDirs: directories.map((entry) => ({
              absPath: join(resolved, entry.name),
              childrenFiles: [],
              childrenDirs: [],
              childrenWereProcessed: false,
              numFiles: 0,
            })),
            childrenWereProcessed: true,
            numFiles: fileNames.length,
          },
        },
      },
    },
  };
}

async function writeContained(request: HostToolRequest, deps: HostExecutorDeps): Promise<HostActionResult> {
  const target = request.path;
  if (target === undefined) return refused({ error: sourceText("error.backend.hostToolRefused") });
  let resolved: string;
  try {
    resolved = containPath(deps.root, target);
  } catch {
    return refused({ writeResult: { error: sourceText("error.backend.hostToolRefused") } });
  }
  const fileText = request.fileText ?? "";
  await writeFile(resolved, fileText, "utf8");
  return {
    ok: true,
    text: resolved,
    message: {
      writeResult: {
        success: {
          path: resolved,
          linesCreated: fileText.split("\n").length,
          fileSize: Buffer.byteLength(fileText),
        },
      },
    },
  };
}

function sendInput(request: HostToolRequest): HostActionResult {
  const shellId = request.shellId;
  const stdin = shellId === undefined ? undefined : shells.get(shellId)?.stdin;
  if (stdin === null || stdin === undefined || stdin.destroyed) return unavailable();
  stdin.write(request.chars ?? "");
  return { ok: true, text: request.chars ?? "", message: { writeShellStdinResult: { success: true } } };
}
