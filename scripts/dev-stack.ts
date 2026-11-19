import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createOpenBotLogger, redactText, toLogValue } from "@openbot/logging";
import {
  type DevInstanceRecord,
  describeDevInstance,
  devInstanceRegistryDirectory,
  readAllDevInstanceRecords,
  readDevInstanceRecords,
  removeDevInstanceRecord,
} from "./dev-automation/instance-registry";
import {
  isProcessAlive,
  isProcessGroupAlive,
  type RecordedProcessState,
  verifyRecordedProcess,
} from "./dev-automation/registry-files";
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

const USAGE = "Usage: bun scripts/dev-stack.ts <status|stop|forget|restart-client> [--all] [--pid=<supervisor pid>]";

export interface DevStackInvocation {
  command: "status" | "stop" | "forget" | "restart-client";
  all: boolean;
  pid: number | null;
}

export function parseDevStackInvocation(args: string[]): DevStackInvocation {
  const command = args.find((argument) => !argument.startsWith("--"));
  if (command !== "status" && command !== "stop" && command !== "forget" && command !== "restart-client")
    throw new Error(USAGE);
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
  if (invocation.pid !== null) return { kind: "pid", pid: invocation.pid };
  if (invocation.all || invocation.command === "status") return { kind: "all" };
  return { kind: "worktree", projectRoot };
}

export function selectDevStacks(records: DevStackRecord[], scope: DevStackScope): DevStackRecord[] {
  if (scope.kind === "all") return records;
  if (scope.kind === "pid") return records.filter((record) => record.supervisorPid === scope.pid);
  return records.filter((record) => isSameWorktree(record, scope.projectRoot));
}

function ownedProcess(pid: number): OwnedProcess {
  return { pid, exitCode: null };
}

function restartTestClient(selected: DevStackRecord[]): void {
  const withClient = selected.filter((record) => record.services.includes("test-client"));
  const [record] = withClient;
  if (!record || withClient.length > 1) {
    logger.error(
      withClient.length > 1
        ? "More than one stack runs a test client. Name one with --pid=<supervisor pid>."
        : "No dev stack of this worktree runs a test client. Start one with `bun run dev:test-client`.",
    );
    process.exitCode = 1;
    return;
  }
  if (process.platform === "win32") {
    logger.error("Restarting only the test client needs SIGUSR2, which Windows does not have.");
    process.exitCode = 1;
    return;
  }
  if (verifyRecordedProcess({ pid: record.supervisorPid, startedAt: record.startedAt }) !== "live") {
    logger.error(`Cannot confirm pid ${record.supervisorPid} is the runner of this stack, so it was not signalled.`);
    process.exitCode = 1;
    return;
  }
  process.kill(record.supervisorPid, "SIGUSR2");
  logger.info(`Asked ${describeDevStack(record)} to restart its test client.`);
}

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
  const stopSupervisor = (): Promise<void> =>
    stopOwnedProcesses([ownedProcess(record.supervisorPid)], "SIGTERM", { scope: "process", timeoutMs: 5_000 });
  const windows = process.platform === "win32";
  if (supervisor === "live" && !windows) await stopSupervisor();
  else if (supervisor === "unverified") refuse(record.supervisorPid, "the runner");

  const groups: OwnedProcess[] = [];
  for (const entry of record.processes) {
    const state = verifyRecordedProcess(entry);
    if (state === "live") {
      groups.push(ownedProcess(entry.pid));
    } else if (state === "unverified") {
      refuse(entry.pid, `the ${entry.name} process`);
    } else if (isProcessGroupAlive(entry.pid)) {
      logger.error(
        `The ${entry.name} process group ${entry.pid} outlived its leader and cannot be attributed to this stack. ` +
          `Find what holds ${record.ports.map((port) => port.port).join(", ")} with ${process.platform === "win32" ? "netstat -ano" : "lsof"}, and stop it yourself.`,
      );
      unresolved = true;
    }
  }
  if (groups.length > 0) {
    logger.info(`Stopping ${groups.length} process group(s) the supervisor left behind.`);
    await stopOwnedProcesses(groups, "SIGTERM", { scope: "group", timeoutMs: 5_000 });
  }
  if (supervisor === "live" && windows) {
    const deadline = Date.now() + 5_000;
    while (isProcessAlive(record.supervisorPid) && Date.now() < deadline) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    }
    if (isProcessAlive(record.supervisorPid)) await stopSupervisor();
  }

  if (unresolved) return false;
  forgetDevStack(record);
  return true;
}

export type DevInstanceClaim = "ours" | "another" | "unverified";

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

function forgetDevStack(record: DevStackRecord): void {
  removeDevStackRecord(record);
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
  const records = invocation.command === "forget" ? readAllDevStackRecords() : readDevStackRecords();

  if (invocation.command === "status") {
    const document = {
      registryDirectory: redactText(devInstanceRegistryDirectory()),
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
  if (invocation.command === "restart-client") {
    restartTestClient(selected);
    return;
  }
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

const invokedFile = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedFile === fileURLToPath(import.meta.url)) {
  void main().catch((error) => {
    logger.error(error instanceof Error ? error.message : toLogValue(error));
    process.exitCode = 1;
  });
}
