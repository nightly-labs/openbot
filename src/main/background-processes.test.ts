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

function processTable(rows: readonly FixtureRow[]): string {
  return rows.map((row) => `${row.pid} ${row.ppid} ${UID} ${STARTED} ${row.command}`).join("\n");
}

function processEnvironment(row: FixtureRow, marked: boolean): string {
  return ` ${row.pid} ${row.command}${marked ? " OPENBOT_AGENT_PROCESS=1" : ""}\n`;
}

function lsofCwd(cwd: string): string {
  return `p${ROOT_PID}\nn${cwd}\n`;
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

const row: FixtureRow = {
  pid: ROOT_PID,
  ppid: 1,
  command: "/usr/bin/curl -sS --limit-rate 2k -o /tmp/openbot-dl-test.bin https://example.com/1MB.bin",
};

beforeAll(async () => {
  workspace = await realpath(await mkdtemp(join(tmpdir(), "openbot-background-process-")));
});

afterAll(async () => {
  await rm(workspace, { recursive: true, force: true });
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
  it("lists an unmarked orphan on macOS when its working directory is an agent workspace", async () => {
    respond = replyForUnmarkedDarwin(row, workspace);

    const items = await Effect.runPromise(listBackgroundProcesses("darwin", [{ ...AGENT, workspacePath: workspace }]));

    expect(items).toEqual([
      {
        id: `${ROOT_PID}:${STARTED_AT}`,
        pid: ROOT_PID,
        command: row.command,
        startedAt: STARTED_AT,
        ports: [],
        agentId: AGENT.id,
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

  it("still lists a marked orphan on macOS outside every agent workspace", async () => {
    respond = (command, args) => {
      if (command === "ps" && args.includes("-A")) return { stdout: processTable([row]) };
      if (command === "ps" && args.includes("-E")) return { stdout: processEnvironment(row, true) };
      if (command === "lsof" && args.includes("-d")) {
        return { stdout: lsofCwd(join(tmpdir(), "openbot-not-a-workspace")) };
      }
      return { stdout: "" };
    };

    const items = await Effect.runPromise(listBackgroundProcesses("darwin", [{ ...AGENT, workspacePath: workspace }]));

    expect(items).toHaveLength(1);
    expect(items?.[0]?.pid).toBe(ROOT_PID);
    expect(items?.[0]?.agentId).toBeNull();
  });

  it("stops the unmarked orphan that the working directory fallback found", async () => {
    respond = replyForUnmarkedDarwin(row, workspace);
    const kill = vi.spyOn(process, "kill").mockImplementation((_pid, signal) => {
      if (signal === 0) throw new Error("ESRCH");
      return true;
    });

    await Effect.runPromise(
      stopBackgroundProcess("darwin", `${ROOT_PID}:${STARTED_AT}`, [{ ...AGENT, workspacePath: workspace }]),
    );

    expect(kill).toHaveBeenCalledWith(ROOT_PID, "SIGTERM");
  });

  it("does not stop an unmarked orphan outside every agent workspace", async () => {
    respond = replyForUnmarkedDarwin(row, join(tmpdir(), "openbot-not-a-workspace"));
    const kill = vi.spyOn(process, "kill").mockImplementation((_pid, signal) => {
      if (signal === 0) throw new Error("ESRCH");
      return true;
    });

    await Effect.runPromise(
      stopBackgroundProcess("darwin", `${ROOT_PID}:${STARTED_AT}`, [{ ...AGENT, workspacePath: workspace }]),
    );

    expect(kill).not.toHaveBeenCalled();
  });

  it("includes the descendants of an unmarked orphan and stops the whole tree", async () => {
    const child: FixtureRow = {
      pid: ROOT_PID + 1,
      ppid: ROOT_PID,
      command: "/usr/bin/curl -sS --limit-rate 2k https://example.com/1MB.bin",
    };
    respond = (command, args) => {
      if (command === "ps" && args.includes("-A")) return { stdout: processTable([row, child]) };
      if (command === "ps" && args.includes("-E")) return { stdout: processEnvironment(row, false) };
      if (command === "lsof" && args.includes("-d")) return { stdout: lsofCwd(workspace) };
      if (command === "lsof" && args.includes("-iTCP")) return { stdout: `p${child.pid}\nn*:8080\n` };
      return { stdout: "" };
    };
    const kill = vi.spyOn(process, "kill").mockImplementation((_pid, signal) => {
      if (signal === 0) throw new Error("ESRCH");
      return true;
    });

    const items = await Effect.runPromise(listBackgroundProcesses("darwin", [{ ...AGENT, workspacePath: workspace }]));

    expect(items).toHaveLength(1);
    expect(items?.[0]?.ports).toEqual([8080]);

    await Effect.runPromise(
      stopBackgroundProcess("darwin", `${ROOT_PID}:${STARTED_AT}`, [{ ...AGENT, workspacePath: workspace }]),
    );

    expect(kill).toHaveBeenCalledWith(ROOT_PID, "SIGTERM");
    expect(kill).toHaveBeenCalledWith(child.pid, "SIGTERM");
  });

  it("reads the working directories of all unmarked orphans in one lsof call", async () => {
    const other: FixtureRow = { ...row, pid: ROOT_PID + 2 };
    respond = (command, args) => {
      if (command === "ps" && args.includes("-A")) return { stdout: processTable([row, other]) };
      if (command === "ps" && args.includes("-E")) return { stdout: processEnvironment(row, false) };
      if (command === "lsof" && args.includes("-d")) {
        return {
          stdout: lsofCwds([
            { pid: ROOT_PID, cwd: workspace },
            { pid: other.pid, cwd: workspace },
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
