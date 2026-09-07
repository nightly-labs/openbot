// What is running on this machine, and how to stop only your part of it.
//
// `pkill -f electron` and `pkill -f bun` are the commands this replaces, and
// both of them kill the other worktrees' work mid-write. The stack registry
// already knows which pids belong to which checkout, so stopping the right ones
// is a lookup rather than a pattern.

import { resolve } from "node:path";
import { createOpenBotLogger, redactText, toLogValue } from "@openbot/logging";
import {
  describeDevInstance,
  readDevInstanceRecords,
  removeDevInstanceRecord,
} from "./dev-automation/instance-registry";
import { isLiveRecordedProcess } from "./dev-automation/registry-files";
import {
  type DevStackPort,
  type DevStackRecord,
  type DevStackService,
  describeDevStack,
  isOrphanedDevStack,
  isSameWorktree,
  readDevStackRecords,
  removeDevStackRecord,
} from "./dev-automation/stack-registry";
import { type OwnedProcess, stopOwnedProcesses } from "./dev-services";

const logger = createOpenBotLogger("dev-stack", (line) => process.stderr.write(`${line}\n`));

const USAGE = "Usage: bun scripts/dev-stack.ts <status|stop> [--all] [--pid=<supervisor pid>]";

export interface DevStackInvocation {
  command: "status" | "stop";
  all: boolean;
  pid: number | null;
}

export function parseDevStackInvocation(args: string[]): DevStackInvocation {
  const command = args.find((argument) => !argument.startsWith("--"));
  if (command !== "status" && command !== "stop") throw new Error(USAGE);
  const raw = args.find((argument) => argument.startsWith("--pid="))?.slice("--pid=".length);
  const pid = raw === undefined ? null : Number(raw);
  if (pid !== null && (!Number.isInteger(pid) || pid <= 0)) throw new Error("--pid must be a positive integer.");
  const all = args.includes("--all");
  if (all && pid !== null) throw new Error("Pass either --all or --pid=<pid>, not both.");
  const unsupported = args.find(
    (argument) => argument.startsWith("--") && argument !== "--all" && !argument.startsWith("--pid="),
  );
  if (unsupported) throw new Error(`Unknown option: ${unsupported}.\n${USAGE}`);
  return { command, all, pid };
}

export type DevStackScope = { kind: "all" } | { kind: "pid"; pid: number } | { kind: "worktree"; projectRoot: string };

export function devStackScope(invocation: DevStackInvocation, projectRoot: string): DevStackScope {
  if (invocation.all) return { kind: "all" };
  if (invocation.pid !== null) return { kind: "pid", pid: invocation.pid };
  return { kind: "worktree", projectRoot };
}

// The default scope is this worktree and nothing else. A sibling's stack takes
// `--pid=` or `--all`, because "stop the dev servers" from inside one checkout
// almost never means "stop the four other agents working on this machine".
export function selectDevStacks(records: DevStackRecord[], scope: DevStackScope): DevStackRecord[] {
  if (scope.kind === "all") return records;
  if (scope.kind === "pid") return records.filter((record) => record.supervisorPid === scope.pid);
  return records.filter((record) => isSameWorktree(record, scope.projectRoot));
}

function ownedProcess(pid: number): OwnedProcess {
  // `exitCode: null` because nothing here was spawned by this process, so
  // nothing has been reaped: liveness comes from signalling the pid.
  return { pid, exitCode: null };
}

// Two rounds, for the two ways a stack ends up needing this. A supervisor that
// is still alive tears its own children down when it gets SIGTERM, which is
// the clean path and the one that removes the instance records. A supervisor
// that is already gone left its detached children holding the ports, and those
// have to be signalled directly.
async function stopDevStack(record: DevStackRecord): Promise<void> {
  // The recorded check, not a bare `kill(pid, 0)`: a supervisor pid the system
  // has since recycled belongs to some unrelated program, and this command
  // must never send it a signal.
  if (isLiveRecordedProcess({ pid: record.supervisorPid, startedAt: record.startedAt })) {
    // "process", not its group: the supervisor sits in whatever group the
    // shell or `bun run` that started it leads, so a group signal would go to
    // that job instead of to the runner.
    await stopOwnedProcesses([ownedProcess(record.supervisorPid)], "SIGTERM", {
      scope: "process",
      timeoutMs: 5_000,
    });
  }
  // Whatever the supervisor did not take with it. These were spawned detached,
  // so each leads a group and the group is what holds the ports: Electron's
  // helpers and the Vite worker outlive their parent otherwise.
  const survivors = record.processes.filter(isLiveRecordedProcess);
  if (survivors.length > 0) {
    logger.info(`Stopping ${survivors.length} process group(s) the supervisor left behind.`);
    await stopOwnedProcesses(
      survivors.map((entry) => ownedProcess(entry.pid)),
      "SIGTERM",
      { scope: "group", timeoutMs: 5_000 },
    );
  }
  removeDevStackRecord(record);
  // A stack the supervisor never got to clean up leaves its instance records
  // behind too. They would be pruned on the next read, but only once `ps`
  // agrees the pid is gone, and a recycled pid keeps that from happening.
  for (const instance of readDevInstanceRecords()) {
    if (record.processes.some((entry) => entry.pid === instance.pid)) removeDevInstanceRecord(instance);
  }
}

interface ReportableDevStackProcess {
  name: DevStackService;
  pid: number;
  startedAt: number;
  live: boolean;
}

export interface ReportableDevStack {
  supervisorPid: number;
  services: DevStackService[];
  ports: DevStackPort[];
  projectRoot: string;
  worktree: boolean;
  orphaned: boolean;
  startedAt: string;
  processes: ReportableDevStackProcess[];
}

// `projectRoot` is a path the developer chose - a checkout under a directory
// named after an email, or one holding a token, would otherwise be copied into
// an agent's transcript verbatim. Selection keeps using the raw records.
function reportableStack(record: DevStackRecord, projectRoot: string): ReportableDevStack {
  return {
    supervisorPid: record.supervisorPid,
    services: record.services,
    ports: record.ports,
    projectRoot: redactText(record.projectRoot),
    worktree: isSameWorktree(record, projectRoot),
    orphaned: isOrphanedDevStack(record),
    startedAt: new Date(record.startedAt).toISOString(),
    processes: record.processes.map((entry) => ({ ...entry, live: isLiveRecordedProcess(entry) })),
  };
}

async function main(): Promise<void> {
  const invocation = parseDevStackInvocation(process.argv.slice(2));
  const projectRoot = resolve(process.cwd());
  const records = readDevStackRecords();

  if (invocation.command === "status") {
    const document = {
      stacks: selectDevStacks(records, devStackScope(invocation, projectRoot)).map((record) =>
        reportableStack(record, projectRoot),
      ),
      instances: readDevInstanceRecords().map((record) => ({
        ...record,
        profile: redactText(record.profile),
        projectRoot: redactText(record.projectRoot),
      })),
    };
    process.stdout.write(`${JSON.stringify(document, null, 2)}\n`);
    return;
  }

  const scope = devStackScope(invocation, projectRoot);
  const selected = selectDevStacks(records, scope);
  if (selected.length === 0) {
    if (scope.kind === "worktree" && records.length > 0) {
      logger.info(
        `No dev stack belongs to this worktree. Live elsewhere:\n${records.map((record) => `- ${describeDevStack(record)}`).join("\n")}`,
      );
      logger.info("Stop one of those with --pid=<supervisor pid>, or every stack with --all.");
      return;
    }
    logger.info("No dev stack is running.");
    return;
  }
  for (const record of selected) {
    logger.info(`Stopping ${describeDevStack(record)}`);
    await stopDevStack(record);
  }
  const remaining = readDevInstanceRecords();
  if (remaining.length > 0) {
    logger.info(`Still published:\n${remaining.map((record) => `- ${describeDevInstance(record)}`).join("\n")}`);
  }
  process.stdout.write(
    `${JSON.stringify(
      { stopped: selected.map((record) => ({ supervisorPid: record.supervisorPid, services: record.services })) },
      null,
      2,
    )}\n`,
  );
}

void main().catch((error) => {
  logger.error(error instanceof Error ? error.message : toLogValue(error));
  process.exitCode = 1;
});
