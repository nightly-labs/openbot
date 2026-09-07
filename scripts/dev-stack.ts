// What is running on this machine, and how to stop only your part of it.
//
// `pkill -f electron` and `pkill -f bun` are the commands this replaces, and
// both of them kill the other worktrees' work mid-write. The stack registry
// already knows which pids belong to which checkout, so stopping the right ones
// is a lookup rather than a pattern.

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createOpenBotLogger, redactText, toLogValue } from "@openbot/logging";
import {
  type DevInstanceRecord,
  describeDevInstance,
  readAllDevInstanceRecords,
  readDevInstanceRecords,
  removeDevInstanceRecord,
} from "./dev-automation/instance-registry";
import { isProcessGroupAlive, type RecordedProcessState, verifyRecordedProcess } from "./dev-automation/registry-files";
import {
  type DevStackPort,
  type DevStackRecord,
  type DevStackService,
  describeDevStack,
  isOrphanedDevStack,
  isSameWorktree,
  readAllDevStackRecords,
  readDevStackRecords,
  removeDevStackRecord,
} from "./dev-automation/stack-registry";
import { type OwnedProcess, stopOwnedProcesses } from "./dev-services";

const logger = createOpenBotLogger("dev-stack", (line) => process.stderr.write(`${line}\n`));

const USAGE = "Usage: bun scripts/dev-stack.ts <status|stop|forget> [--all] [--pid=<supervisor pid>]";

export interface DevStackInvocation {
  // `forget` drops a record without signalling anything. It is the way out of
  // the one state `stop` refuses to resolve on its own: a recorded pid that is
  // alive but that this machine cannot date, which `stop` will not signal
  // because the pid may since have been recycled by an unrelated program.
  command: "status" | "stop" | "forget";
  all: boolean;
  pid: number | null;
}

export function parseDevStackInvocation(args: string[]): DevStackInvocation {
  const command = args.find((argument) => !argument.startsWith("--"));
  if (command !== "status" && command !== "stop" && command !== "forget") throw new Error(USAGE);
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

// Reading and killing get different defaults on purpose. `status` answers
// "what is on this machine", and the sibling stack holding the port this
// worktree wanted is the whole reason to ask - a report scoped to this
// worktree would leave it out and show nothing at all. `stop` and `forget`
// touch other people's processes, so they stay on this worktree until the
// developer names another one.
export function devStackScope(invocation: DevStackInvocation, projectRoot: string): DevStackScope {
  if (invocation.pid !== null) return { kind: "pid", pid: invocation.pid };
  if (invocation.all || invocation.command === "status") return { kind: "all" };
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

// Signal only what this machine can still prove is ours.
//
// `isProcessAlive` says a pid is taken, not by what: a supervisor killed with
// SIGKILL leaves its record behind, and the system reuses pids. Sending
// SIGTERM on that evidence alone is how a stop command kills a stranger's
// program. `verifyRecordedProcess` compares the process start time against the
// record and answers "gone" for a recycled pid - or "unverified" when the
// start time cannot be read at all, which is not permission to signal.
//
// A supervisor that is still alive tears its own children down, which is the
// clean path. One that is already gone left its detached children holding the
// ports, and those are signalled by group, because the group is what holds
// them.
async function stopDevStack(record: DevStackRecord): Promise<boolean> {
  let unresolved = false;
  const refuse = (pid: number, what: string): void => {
    logger.error(
      `Cannot confirm pid ${pid} is still ${what} of this stack, so it was not signalled. ` +
        "Stop it yourself, then drop the record with `bun run dev:forget`.",
    );
    unresolved = true;
  };

  const supervisor: RecordedProcessState = verifyRecordedProcess({
    pid: record.supervisorPid,
    startedAt: record.startedAt,
  });
  if (supervisor === "live") {
    // "process", not its group: the supervisor sits in whatever group the
    // shell or `bun run` that started it leads, so a group signal would go to
    // that job instead of to the runner.
    await stopOwnedProcesses([ownedProcess(record.supervisorPid)], "SIGTERM", { scope: "process", timeoutMs: 5_000 });
  } else if (supervisor === "unverified") {
    refuse(record.supervisorPid, "the runner");
  }

  const groups: OwnedProcess[] = [];
  for (const entry of record.processes) {
    const state = verifyRecordedProcess(entry);
    if (state === "live") {
      groups.push(ownedProcess(entry.pid));
    } else if (state === "unverified") {
      refuse(entry.pid, `the ${entry.name} process`);
    } else if (isProcessGroupAlive(entry.pid)) {
      // The leader is gone and its group is not. Something it started - the
      // Electron behind electron-vite - still holds the port, but the pid that
      // named the group belongs to nobody now, so signalling it would be
      // signalling a group this record can no longer claim.
      logger.error(
        `The ${entry.name} process group ${entry.pid} outlived its leader and cannot be attributed to this stack. ` +
          `Find what holds ${record.ports.map((port) => port.port).join(", ")} with lsof, and stop it yourself.`,
      );
      unresolved = true;
    }
  }
  if (groups.length > 0) {
    logger.info(`Stopping ${groups.length} process group(s) the supervisor left behind.`);
    await stopOwnedProcesses(groups, "SIGTERM", { scope: "group", timeoutMs: 5_000 });
  }

  // Last, and only when nothing was left unresolved: while this record exists,
  // its ports stay reserved and `dev:status` still names the pids. Dropping it
  // over something this command refused to touch would turn a visible problem
  // into an invisible one.
  if (unresolved) return false;
  forgetDevStack(record);
  return true;
}

// What an instance record on disk is, seen from a stack record about to be
// forgotten. A pid is not an identity - it is a name the kernel reuses - and
// an instance record is stored at `<service>-<pid>.json`, so the app that
// recycles a pid writes over the record of the app that had it. `another` is
// that case: the file names a pid this stack recorded, and belongs to somebody
// else now.
export type DevInstanceClaim = "ours" | "another" | "unverified";

// The record dates itself, which is what makes this exact: its `startedAt` is
// when *that* instance published, and `verifyRecordedProcess` holds it against
// the start time the kernel reports for the pid. So a live instance is never
// this dead stack's, whatever pid it holds, and no timestamp has to be carried
// from the supervisor through electron-vite into the Electron main process to
// find that out - those are two different events and would date differently.
// The worktree is checked as well, because it is the cheaper half of the same
// question and it answers on a machine that cannot date a pid at all.
export function claimOnDevInstance(
  instance: DevInstanceRecord,
  record: DevStackRecord,
  verify: (entry: { pid: number; startedAt: number }) => RecordedProcessState = verifyRecordedProcess,
): DevInstanceClaim {
  if (!record.processes.some((entry) => entry.pid === instance.pid)) return "another";
  if (!isSameWorktree(instance, record.projectRoot)) return "another";
  const state = verify(instance);
  if (state === "live") return "another";
  return state === "unverified" ? "unverified" : "ours";
}

// A stack record is a note about pids, so removing it removes nothing else.
function forgetDevStack(record: DevStackRecord): void {
  removeDevStackRecord(record);
  // A stack the supervisor never got to clean up leaves its instance records
  // behind too, and nothing else deletes them: reading only filters. So this
  // reads every record rather than the live ones, and drops the ones this
  // stack still has a claim on.
  for (const instance of readAllDevInstanceRecords()) {
    const claim = claimOnDevInstance(instance, record);
    if (claim === "ours") removeDevInstanceRecord(instance);
    if (claim === "unverified") {
      logger.error(
        `Cannot confirm pid ${instance.pid} is still the ${instance.service} instance of this stack, ` +
          "so its record was kept. `bun run dev:status` reports it, and the instance that owns it " +
          "publishes over it on its next start.",
      );
    }
  }
}

interface ReportableDevStackProcess {
  name: DevStackService;
  pid: number;
  startedAt: number;
  // "live" is this stack's process. "unverified" is a pid this machine cannot
  // date, which `stop` refuses to signal. "gone" with `groupLive` is a
  // survivor of a dead leader, still holding the port.
  state: RecordedProcessState;
  groupLive: boolean;
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
    processes: record.processes.map((entry) => ({
      ...entry,
      state: verifyRecordedProcess(entry),
      groupLive: isProcessGroupAlive(entry.pid),
    })),
  };
}

async function main(): Promise<void> {
  const invocation = parseDevStackInvocation(process.argv.slice(2));
  const projectRoot = resolve(process.cwd());
  // `forget` is the one command that acts on a record because it is dead, so
  // it is the one that reads past the liveness filter. Everything else asks
  // what is running.
  const records = invocation.command === "forget" ? readAllDevStackRecords() : readDevStackRecords();

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
      const elsewhere = invocation.command === "forget" ? "Recorded elsewhere" : "Live elsewhere";
      logger.info(
        `No dev stack belongs to this worktree. ${elsewhere}:\n${records.map((record) => `- ${describeDevStack(record)}`).join("\n")}`,
      );
      logger.info(`Name one of those with --pid=<supervisor pid>, or every stack with --all.`);
      return;
    }
    logger.info("No dev stack is running.");
    return;
  }
  const settled: DevStackRecord[] = [];
  for (const record of selected) {
    if (invocation.command === "forget") {
      logger.info(`Forgetting ${describeDevStack(record)}. Nothing was signalled.`);
      forgetDevStack(record);
      settled.push(record);
      continue;
    }
    logger.info(`Stopping ${describeDevStack(record)}`);
    if (await stopDevStack(record)) settled.push(record);
  }
  // A record this command refused to touch is the whole reason to fail: the
  // exit code is what a script driving `dev:stop` reads, and a silent success
  // there would let it start a stack on a port somebody still holds.
  if (settled.length < selected.length) process.exitCode = 1;
  const remaining = readDevInstanceRecords();
  if (remaining.length > 0) {
    logger.info(`Still published:\n${remaining.map((record) => `- ${describeDevInstance(record)}`).join("\n")}`);
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        [invocation.command === "forget" ? "forgotten" : "stopped"]: settled.map((record) => ({
          supervisorPid: record.supervisorPid,
          services: record.services,
        })),
        unresolved: selected
          .filter((record) => !settled.includes(record))
          .map((record) => ({ supervisorPid: record.supervisorPid, services: record.services })),
      },
      null,
      2,
    )}\n`,
  );
}

// Only when run as a command, like its siblings. Importing this file - a test
// covering the scope rules, an editor's language server - must never signal a
// process or delete a record as a side effect of the import.
const invokedFile = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedFile === fileURLToPath(import.meta.url)) {
  void main().catch((error) => {
    logger.error(error instanceof Error ? error.message : toLogValue(error));
    process.exitCode = 1;
  });
}
