// `storybook dev -p 6006` in a second worktree silently lands on 6007, prints
// a URL nobody was watching, and leaves the developer looking at the first
// worktree's stories - or, with `--exact-port`, fails outright. Neither is
// useful when several worktrees are open, so this wrapper allocates through the
// same registry `bun run dev` uses: the port it announces is one no sibling
// will take, and `bun run dev:status` and `bun run dev:stop` can see it.

import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { withDevPortAllocation } from "./dev-automation/port-allocation";
import {
  conflictingDevStacks,
  type DevStackRecord,
  describeDevStack,
  heldDevStackPorts,
  removeDevStackRecord,
  writeDevStackRecord,
} from "./dev-automation/stack-registry";
import { findAvailablePort, stopOwnedProcesses } from "./dev-services";

const logger = createOpenBotLogger("dev-storybook");

const scriptsRoot = dirname(fileURLToPath(import.meta.url));
const projectRoot = dirname(scriptsRoot);

export const DEFAULT_STORYBOOK_PORT = 6_006;

export interface StorybookInvocation {
  force: boolean;
  passthrough: string[];
}

// `--force` is this script's own; everything else goes to Storybook untouched,
// so `bun run storybook --no-open --quiet` still works. `-p`/`--port` is
// refused rather than passed on: the registry is what chooses the port, and a
// port it did not hand out is one a sibling worktree can be told to take.
export function parseStorybookInvocation(args: string[]): StorybookInvocation {
  const conflicting = args.find(
    (argument) => argument === "-p" || argument === "--port" || argument.startsWith("--port="),
  );
  if (conflicting) {
    throw new Error(
      "Storybook's port is allocated per worktree, so --port cannot be passed through. " +
        "Set OPENBOT_STORYBOOK_PORT to change where the search starts.",
    );
  }
  return {
    force: args.includes("--force"),
    passthrough: args.filter((argument) => argument !== "--force"),
  };
}

export function storybookExecutable(root = projectRoot): string {
  return join(root, "node_modules", ".bin", process.platform === "win32" ? "storybook.cmd" : "storybook");
}

export function createStorybookStackRecord(port: number, supervisorPid: number, startedAt: number): DevStackRecord {
  return {
    services: ["storybook"],
    projectRoot,
    supervisorPid,
    startedAt,
    ports: [{ name: "storybook", port }],
    processes: [],
  };
}

function readPreferredPort(value: string | undefined): number {
  if (value === undefined || value.trim() === "") return DEFAULT_STORYBOOK_PORT;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1_024 || port > 65_535) {
    throw new Error("OPENBOT_STORYBOOK_PORT must be an integer from 1024 to 65535.");
  }
  return port;
}

async function main(): Promise<void> {
  const { force, passthrough } = parseStorybookInvocation(process.argv.slice(2));
  const executable = storybookExecutable();
  if (!existsSync(executable)) {
    throw new Error(`storybook is missing at ${executable}. Run bun install.`);
  }

  const { port, stack } = await withDevPortAllocation(async (records) => {
    const conflicts = conflictingDevStacks(records, { projectRoot, services: ["storybook"] });
    if (conflicts.length > 0) {
      const detail = conflicts.map((record) => `- ${describeDevStack(record)}`).join("\n");
      if (!force) {
        throw new Error(
          `This worktree already runs Storybook:\n${detail}\n` +
            "Open that one, stop it with `bun run dev:stop`, or start beside it with --force.",
        );
      }
      logger.warn(`This worktree already runs Storybook:\n${detail}`);
    }
    const preferred = readPreferredPort(process.env.OPENBOT_STORYBOOK_PORT);
    const allocated = await findAvailablePort(preferred, new Set(), heldDevStackPorts(records));
    if (allocated !== preferred) logger.info(`Storybook port ${preferred} is busy. Using ${allocated}.`);
    const record = createStorybookStackRecord(allocated, process.pid, Date.now());
    writeDevStackRecord(record);
    return { port: allocated, stack: record };
  });

  logger.info(`Storybook: http://localhost:${port}`);
  // `--exact-port` because the port is already reserved and probed. Letting
  // Storybook walk on its own would put it on a port the registry promised to
  // another worktree, which is the collision this script exists to prevent.
  const child: ChildProcess = spawn(executable, ["dev", "--port", String(port), "--exact-port", ...passthrough], {
    cwd: projectRoot,
    stdio: "inherit",
    shell: false,
    detached: process.platform !== "win32",
  });
  if (child.pid) {
    stack.processes.push({ name: "storybook", pid: child.pid, startedAt: Date.now() });
    writeDevStackRecord(stack);
  }

  let stopping = false;
  const stopAll = async (signal: NodeJS.Signals): Promise<void> => {
    if (stopping) return;
    stopping = true;
    await stopOwnedProcesses([child], signal);
    removeDevStackRecord(stack);
  };

  process.once("SIGINT", () => void stopAll("SIGTERM").then(() => process.exit(130)));
  process.once("SIGTERM", () => void stopAll("SIGTERM").then(() => process.exit(143)));
  process.once("SIGHUP", () => void stopAll("SIGTERM").then(() => process.exit(129)));

  child.once("error", (error) => {
    logger.error("Could not start Storybook:", error.message);
    void stopAll("SIGTERM").then(() => {
      process.exitCode = 1;
    });
  });
  child.once("exit", (code, signal) => {
    if (stopping) return;
    removeDevStackRecord(stack);
    process.exitCode = signal ? 1 : (code ?? 0);
  });
}

const invokedFile = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedFile === fileURLToPath(import.meta.url)) {
  void main().catch((error) => {
    logger.error(error instanceof Error ? error.message : toLogValue(error));
    process.exitCode = 1;
  });
}
