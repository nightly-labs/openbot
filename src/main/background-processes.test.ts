import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { listBackgroundProcesses, stopBackgroundProcess } from "./background-processes";

const execFileMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({ execFile: execFileMock }));

const STARTED = "Fri Oct 30 14:42:59 2026";
const STARTED_AT = Date.parse(STARTED);
const ROOT_PID = 4242;
const UNMARKED_PID = 2_147_483_647;
const UID = process.getuid?.() ?? 0;
const AGENT = { id: "agent-1" } as const;
const OTHER_AGENT = { id: "agent-2" } as const;

interface CommandReply {
  stdout?: string;
  code?: number;
}

type CommandResponder = (command: string, args: readonly string[]) => CommandReply;

interface FixtureRow {
  pid: number;
  ppid: number;
  command: string;
}

let respond: CommandResponder = () => ({});
let workspace: string;
let otherWorkspace: string;

function processTable(rows: readonly FixtureRow[]): string {
  return rows.map((row) => `${row.pid} ${row.ppid} ${UID} ${STARTED} ${row.command}`).join("\n");
}

function processEnvironment(row: FixtureRow, marked: boolean): string {
  return ` ${row.pid} ${row.command}${marked ? " OPENBOT_AGENT_PROCESS=1" : ""}\n`;
}

function lsofCwd(cwd: string, pid: number = ROOT_PID): string {
  return `p${pid}\nn${cwd}\n`;
}

function lsofCwds(entries: readonly { pid: number; cwd: string }[]): string {
  return entries.map(({ pid, cwd }) => `p${pid}\nn${cwd}\n`).join("");
}

function replyForUnmarkedDarwin(row: FixtureRow, cwd: string): CommandResponder {
  return (command, args) => {
    if (command === "ps" && args.includes("-A")) return { stdout: processTable([row]) };
    if (command === "ps" && args.includes("-E")) return { stdout: processEnvironment(row, false) };
    if (command === "lsof" && args.includes("-d")) return { stdout: lsofCwd(cwd) };
    return { stdout: "" };
  };
}

function replyForMarkedDarwin(row: FixtureRow, cwd: string): CommandResponder {
  return (command, args) => {
    if (command === "ps" && args.includes("-A")) return { stdout: processTable([row]) };
    if (command === "ps" && args.includes("-E")) return { stdout: processEnvironment(row, true) };
    if (command === "lsof" && args.includes("-d")) return { stdout: lsofCwd(cwd) };
    return { stdout: "" };
  };
}

function spyOnKill(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(process, "kill").mockImplementation((_pid, signal) => {
    if (signal === 0) throw new Error("ESRCH");
    return true;
  });
}

const row: FixtureRow = {
  pid: ROOT_PID,
  ppid: 1,
  command: "/usr/bin/curl -sS --limit-rate 2k -o /tmp/openbot-dl-test.bin https://example.com/1MB.bin",
};

beforeAll(async () => {
  workspace = await realpath(await mkdtemp(join(tmpdir(), "openbot-background-process-")));
  otherWorkspace = await realpath(await mkdtemp(join(tmpdir(), "openbot-background-process-other-")));
});

afterAll(async () => {
  await rm(workspace, { recursive: true, force: true });
  await rm(otherWorkspace, { recursive: true, force: true });
});

beforeEach(() => {
  respond = () => ({});
  execFileMock.mockClear();
  execFileMock.mockImplementation(
    (
      command: string,
      args: readonly string[],
      _options: unknown,
      callback: (error: Error | null, stdout: string, stderr: string) => void,
    ) => {
      const reply = respond(command, args);
      if (reply.code === undefined) {
        callback(null, reply.stdout ?? "", "");
        return;
      }
      const error = new Error("command failed");
      Object.assign(error, { code: reply.code });
      callback(error, reply.stdout ?? "", "");
    },
  );
});

describe("left programs without the process marker", () => {
  it("lists an unmarked orphan on macOS as unverified, with only its executable name", async () => {
    respond = replyForUnmarkedDarwin(row, workspace);

    const items = await Effect.runPromise(listBackgroundProcesses("darwin", [{ ...AGENT, workspacePath: workspace }]));

    expect(items).toEqual([
      {
        id: `${ROOT_PID}:${STARTED_AT}`,
        pid: ROOT_PID,
        command: "curl",
        startedAt: STARTED_AT,
        ports: [],
        agentId: AGENT.id,
        verified: false,
      },
    ]);
  });

  it("does not list an unmarked orphan on macOS outside every agent workspace", async () => {
    respond = replyForUnmarkedDarwin(row, join(tmpdir(), "openbot-not-a-workspace"));

    const items = await Effect.runPromise(listBackgroundProcesses("darwin", [{ ...AGENT, workspacePath: workspace }]));

    expect(items).toEqual([]);
  });

  it("does not use the working directory fallback on another platform", async () => {
    respond = (command, args) => {
      if (command === "ps" && args.includes("-A")) {
        return { stdout: processTable([{ ...row, pid: UNMARKED_PID }]) };
      }
      if (command === "ps" && args.includes("-E")) return { stdout: processEnvironment(row, false) };
      if (command === "lsof" && args.includes("-d")) return { stdout: lsofCwd(workspace) };
      return { stdout: "" };
    };

    const items = await Effect.runPromise(listBackgroundProcesses("linux", [{ ...AGENT, workspacePath: workspace }]));

    expect(items).toEqual([]);
    expect(execFileMock.mock.calls.every(([command]) => command === "ps")).toBe(true);
  });

  it("lists a marked orphan as verified, with the full command, outside every workspace", async () => {
    respond = replyForMarkedDarwin(row, join(tmpdir(), "openbot-not-a-workspace"));

    const items = await Effect.runPromise(listBackgroundProcesses("darwin", [{ ...AGENT, workspacePath: workspace }]));

    expect(items).toHaveLength(1);
    expect(items?.[0]?.pid).toBe(ROOT_PID);
    expect(items?.[0]?.agentId).toBeNull();
    expect(items?.[0]?.verified).toBe(true);
    expect(items?.[0]?.command).toBe(row.command);
  });

  it("does not stop an unmarked orphan that the working directory showed", async () => {
    respond = replyForUnmarkedDarwin(row, workspace);
    const kill = spyOnKill();

    await Effect.runPromise(
      stopBackgroundProcess("darwin", { id: `${ROOT_PID}:${STARTED_AT}`, agentId: AGENT.id }, [
        { ...AGENT, workspacePath: workspace },
      ]),
    );

    expect(kill).not.toHaveBeenCalled();
  });

  it("does not stop an unmarked orphan outside every agent workspace", async () => {
    respond = replyForUnmarkedDarwin(row, join(tmpdir(), "openbot-not-a-workspace"));
    const kill = spyOnKill();

    await Effect.runPromise(
      stopBackgroundProcess("darwin", { id: `${ROOT_PID}:${STARTED_AT}`, agentId: AGENT.id }, [
        { ...AGENT, workspacePath: workspace },
      ]),
    );

    expect(kill).not.toHaveBeenCalled();
  });

  it("stops a marked orphan that belongs to the agent that asks", async () => {
    respond = replyForMarkedDarwin(row, workspace);
    const kill = spyOnKill();

    await Effect.runPromise(
      stopBackgroundProcess("darwin", { id: `${ROOT_PID}:${STARTED_AT}`, agentId: AGENT.id }, [
        { ...AGENT, workspacePath: workspace },
      ]),
    );

    expect(kill).toHaveBeenCalledWith(ROOT_PID, "SIGTERM");
  });

  it("refuses to stop a marked orphan for another agent, or for no agent", async () => {
    respond = replyForMarkedDarwin(row, workspace);
    const kill = spyOnKill();

    await Effect.runPromise(
      stopBackgroundProcess("darwin", { id: `${ROOT_PID}:${STARTED_AT}`, agentId: OTHER_AGENT.id }, [
        { ...AGENT, workspacePath: workspace },
      ]),
    );
    await Effect.runPromise(
      stopBackgroundProcess("darwin", { id: `${ROOT_PID}:${STARTED_AT}`, agentId: null }, [
        { ...AGENT, workspacePath: workspace },
      ]),
    );

    expect(kill).not.toHaveBeenCalled();
  });

  it("rechecks the start time before it sends SIGTERM", async () => {
    let tables = 0;
    respond = (command, args) => {
      if (command === "ps" && args.includes("-A")) {
        tables++;
        const started = tables === 1 ? STARTED : "Fri Oct 30 14:43:00 2026";
        return { stdout: `${ROOT_PID} 1 ${UID} ${started} ${row.command}` };
      }
      if (command === "ps" && args.includes("-E")) return { stdout: processEnvironment(row, true) };
      if (command === "lsof" && args.includes("-d")) return { stdout: lsofCwd(workspace) };
      return { stdout: "" };
    };
    const kill = spyOnKill();

    await Effect.runPromise(
      stopBackgroundProcess("darwin", { id: `${ROOT_PID}:${STARTED_AT}`, agentId: AGENT.id }, [
        { ...AGENT, workspacePath: workspace },
      ]),
    );

    expect(kill).not.toHaveBeenCalled();
  });

  it("includes the descendants of a marked orphan and stops the whole tree", async () => {
    const child: FixtureRow = {
      pid: ROOT_PID + 1,
      ppid: ROOT_PID,
      command: "/usr/bin/curl -sS --limit-rate 2k https://example.com/1MB.bin",
    };
    respond = (command, args) => {
      if (command === "ps" && args.includes("-A")) return { stdout: processTable([row, child]) };
      if (command === "ps" && args.includes("-E")) return { stdout: processEnvironment(row, true) };
      if (command === "lsof" && args.includes("-d")) return { stdout: lsofCwd(workspace) };
      if (command === "lsof" && args.includes("-iTCP")) return { stdout: `p${child.pid}\nn*:8080\n` };
      return { stdout: "" };
    };
    const kill = spyOnKill();

    const items = await Effect.runPromise(listBackgroundProcesses("darwin", [{ ...AGENT, workspacePath: workspace }]));

    expect(items).toHaveLength(1);
    expect(items?.[0]?.verified).toBe(true);
    expect(items?.[0]?.ports).toEqual([8080]);

    await Effect.runPromise(
      stopBackgroundProcess("darwin", { id: `${ROOT_PID}:${STARTED_AT}`, agentId: AGENT.id }, [
        { ...AGENT, workspacePath: workspace },
      ]),
    );

    expect(kill).toHaveBeenCalledWith(ROOT_PID, "SIGTERM");
    expect(kill).toHaveBeenCalledWith(child.pid, "SIGTERM");
  });

  it("lists only the processes of the agent that asks", async () => {
    const other: FixtureRow = { ...row, pid: ROOT_PID + 2 };
    respond = (command, args) => {
      if (command === "ps" && args.includes("-A")) return { stdout: processTable([row, other]) };
      if (command === "ps" && args.includes("-E")) {
        return { stdout: processEnvironment(row, true) + processEnvironment(other, true) };
      }
      if (command === "lsof" && args.includes("-d")) {
        return {
          stdout: lsofCwds([
            { pid: ROOT_PID, cwd: workspace },
            { pid: other.pid, cwd: otherWorkspace },
          ]),
        };
      }
      return { stdout: "" };
    };
    const agents = [
      { ...AGENT, workspacePath: workspace },
      { ...OTHER_AGENT, workspacePath: otherWorkspace },
    ];

    const first = await Effect.runPromise(listBackgroundProcesses("darwin", agents, AGENT.id));
    const second = await Effect.runPromise(listBackgroundProcesses("darwin", agents, OTHER_AGENT.id));

    expect(first?.map((item) => item.pid)).toEqual([ROOT_PID]);
    expect(second?.map((item) => item.pid)).toEqual([other.pid]);
  });

  it("reads the working directories of all left orphans in one lsof call", async () => {
    const other: FixtureRow = { ...row, pid: ROOT_PID + 2 };
    respond = (command, args) => {
      if (command === "ps" && args.includes("-A")) return { stdout: processTable([row, other]) };
      if (command === "ps" && args.includes("-E")) {
        return { stdout: processEnvironment(row, true) + processEnvironment(other, true) };
      }
      if (command === "lsof" && args.includes("-d")) {
        return {
          stdout: lsofCwds([
            { pid: ROOT_PID, cwd: workspace },
            { pid: other.pid, cwd: otherWorkspace },
          ]),
        };
      }
      return { stdout: "" };
    };

    const items = await Effect.runPromise(listBackgroundProcesses("darwin", [{ ...AGENT, workspacePath: workspace }]));

    const cwdCalls = execFileMock.mock.calls.filter(([command, args]) => {
      return command === "lsof" && Array.isArray(args) && args.includes("-d");
    });
    expect(cwdCalls.length).toBeGreaterThan(0);
    for (const [, args] of cwdCalls) expect(args).toContain(`${ROOT_PID},${other.pid}`);
    expect(items?.map((item) => item.pid).sort()).toEqual([ROOT_PID, other.pid].sort());
  });
});
