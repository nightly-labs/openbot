import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AGENT_SHELL_REGISTRY_VARIABLE,
  agentShellEnvironment,
  configureAgentShell,
} from "../backend/agent/agent-shell";
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
  pgid?: number;
  command: string;
}

let respond: CommandResponder = () => ({});
let workspace: string;
let otherWorkspace: string;
let additionalFolder: string;
let sharedFolder: string;
let shellBase: string;
let shellRegistry: string;

function processTable(rows: readonly FixtureRow[]): string {
  return rows.map((row) => `${row.pid} ${row.ppid} ${row.pgid ?? row.pid} ${UID} ${STARTED} ${row.command}`).join("\n");
}

function processEnvironment(row: FixtureRow, marked: boolean, agentId?: string): string {
  return ` ${row.pid} ${row.command}${marked ? " OPENBOT_AGENT_PROCESS=1" : ""}${
    agentId ? ` OPENBOT_AGENT_ID=${agentId}` : ""
  }\n`;
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

function replyForMarkedDarwin(row: FixtureRow, cwd: string, agentId?: string): CommandResponder {
  return (command, args) => {
    if (command === "ps" && args.includes("-A")) return { stdout: processTable([row]) };
    if (command === "ps" && args.includes("-E")) return { stdout: processEnvironment(row, true, agentId) };
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
  additionalFolder = await realpath(await mkdtemp(join(tmpdir(), "openbot-background-process-additional-")));
  sharedFolder = await realpath(await mkdtemp(join(tmpdir(), "openbot-background-process-shared-")));
  shellBase = await realpath(await mkdtemp(join(tmpdir(), "openbot-agent-shell-")));
  await configureAgentShell(shellBase);
  shellRegistry = agentShellEnvironment()[AGENT_SHELL_REGISTRY_VARIABLE] ?? "";
});

afterAll(async () => {
  await rm(workspace, { recursive: true, force: true });
  await rm(otherWorkspace, { recursive: true, force: true });
  await rm(additionalFolder, { recursive: true, force: true });
  await rm(sharedFolder, { recursive: true, force: true });
  await rm(shellBase, { recursive: true, force: true });
});

beforeEach(async () => {
  respond = () => ({});
  await writeFile(shellRegistry, "");
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
        stoppable: false,
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
    expect(items?.[0]?.stoppable).toBe(false);
    expect(items?.[0]?.command).toBe(row.command);
  });

  it("uses the agent id from the environment after the process changes folder", async () => {
    respond = replyForMarkedDarwin(row, otherWorkspace, AGENT.id);
    const agents = [
      { ...AGENT, workspacePath: workspace },
      { ...OTHER_AGENT, workspacePath: otherWorkspace },
    ];

    const items = await Effect.runPromise(listBackgroundProcesses("darwin", agents, AGENT.id));

    expect(items).toHaveLength(1);
    expect(items?.[0]?.agentId).toBe(AGENT.id);
    expect(items?.[0]?.verified).toBe(true);
    expect(items?.[0]?.stoppable).toBe(true);
    expect(items?.[0]?.command).toBe(row.command);
  });

  it("attributes an unmarked process in an additional folder, but not in the shared folder", async () => {
    const additional: FixtureRow = { ...row, pid: ROOT_PID + 3 };
    const shared: FixtureRow = { ...row, pid: ROOT_PID + 4 };
    respond = (command, args) => {
      if (command === "ps" && args.includes("-A")) return { stdout: processTable([additional, shared]) };
      if (command === "ps" && args.includes("-E")) {
        return { stdout: processEnvironment(additional, false) + processEnvironment(shared, false) };
      }
      if (command === "lsof" && args.includes("-d")) {
        return {
          stdout: lsofCwds([
            { pid: additional.pid, cwd: additionalFolder },
            { pid: shared.pid, cwd: sharedFolder },
          ]),
        };
      }
      return { stdout: "" };
    };
    const agents = [
      {
        ...AGENT,
        workspacePath: workspace,
        folders: [workspace, additionalFolder],
      },
    ];

    const items = await Effect.runPromise(listBackgroundProcesses("darwin", agents, AGENT.id));

    expect(items?.map((item) => item.pid)).toEqual([additional.pid]);
    expect(items?.[0]?.agentId).toBe(AGENT.id);
    expect(items?.[0]?.verified).toBe(false);
    expect(items?.[0]?.stoppable).toBe(false);
  });

  it("does not give a shared folder to the first of two agents", async () => {
    const marked: FixtureRow = { ...row, pid: ROOT_PID + 5 };
    respond = (command, args) => {
      if (command === "ps" && args.includes("-A")) return { stdout: processTable([marked]) };
      if (command === "ps" && args.includes("-E")) return { stdout: processEnvironment(marked, true) };
      if (command === "lsof" && args.includes("-d")) return { stdout: lsofCwd(sharedFolder, marked.pid) };
      return { stdout: "" };
    };
    const agents = [
      { ...AGENT, workspacePath: workspace, folders: [sharedFolder] },
      { ...OTHER_AGENT, workspacePath: otherWorkspace, folders: [sharedFolder] },
    ];

    const items = await Effect.runPromise(listBackgroundProcesses("darwin", agents));

    expect(items).toHaveLength(1);
    expect(items?.[0]?.agentId).toBeNull();
    expect(items?.[0]?.verified).toBe(true);
    expect(items?.[0]?.stoppable).toBe(false);
  });

  it("does not treat a marker in the command line as the environment", async () => {
    const argument: FixtureRow = {
      ...row,
      command: "/bin/sh -c 'OPENBOT_AGENT_PROCESS=1 OPENBOT_AGENT_ID=agent-1 sleep 10'",
    };
    respond = (command, args) => {
      if (command === "ps" && args.includes("-A")) return { stdout: processTable([argument]) };
      if (command === "ps" && args.includes("-E")) return { stdout: processEnvironment(argument, false) };
      if (command === "lsof" && args.includes("-d"))
        return { stdout: lsofCwd(join(tmpdir(), "openbot-not-a-workspace")) };
      return { stdout: "" };
    };

    const items = await Effect.runPromise(listBackgroundProcesses("darwin", [{ ...AGENT, workspacePath: workspace }]));

    expect(items).toEqual([]);
  });

  it("does not stop an unmarked orphan that the working directory showed", async () => {
    respond = replyForUnmarkedDarwin(row, workspace);
    const kill = spyOnKill();

    const result = await Effect.runPromise(
      stopBackgroundProcess("darwin", { id: `${ROOT_PID}:${STARTED_AT}`, agentId: AGENT.id }, [
        { ...AGENT, workspacePath: workspace },
      ]),
    );

    expect(result).toEqual({ stopped: false, reason: "not-stoppable" });
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

  it("does not stop a marked orphan without an agent id, even in that agent's folder", async () => {
    respond = replyForMarkedDarwin(row, workspace);
    const kill = spyOnKill();

    const result = await Effect.runPromise(
      stopBackgroundProcess("darwin", { id: `${ROOT_PID}:${STARTED_AT}`, agentId: AGENT.id }, [
        { ...AGENT, workspacePath: workspace },
      ]),
    );

    expect(result).toEqual({ stopped: false, reason: "not-stoppable" });
    expect(kill).not.toHaveBeenCalled();
  });

  it("does not stop a marked orphan without an agent id from another agent's folder", async () => {
    respond = replyForMarkedDarwin(row, otherWorkspace);
    const kill = spyOnKill();

    const result = await Effect.runPromise(
      stopBackgroundProcess("darwin", { id: `${ROOT_PID}:${STARTED_AT}`, agentId: OTHER_AGENT.id }, [
        { ...AGENT, workspacePath: workspace },
        { ...OTHER_AGENT, workspacePath: otherWorkspace },
      ]),
    );

    expect(result).toEqual({ stopped: false, reason: "not-stoppable" });
    expect(kill).not.toHaveBeenCalled();
  });

  it("refuses to stop a process of another agent when the environment names one", async () => {
    respond = replyForMarkedDarwin(row, otherWorkspace, AGENT.id);
    const kill = spyOnKill();
    const agents = [
      { ...AGENT, workspacePath: workspace },
      { ...OTHER_AGENT, workspacePath: otherWorkspace },
    ];

    const result = await Effect.runPromise(
      stopBackgroundProcess("darwin", { id: `${ROOT_PID}:${STARTED_AT}`, agentId: OTHER_AGENT.id }, agents),
    );

    expect(result).toEqual({ stopped: false, reason: "wrong-agent" });
    expect(kill).not.toHaveBeenCalled();
  });

  it("stops a marked orphan that belongs to the agent that asks", async () => {
    respond = replyForMarkedDarwin(row, workspace, AGENT.id);
    const kill = spyOnKill();

    const result = await Effect.runPromise(
      stopBackgroundProcess("darwin", { id: `${ROOT_PID}:${STARTED_AT}`, agentId: AGENT.id }, [
        { ...AGENT, workspacePath: workspace },
      ]),
    );

    expect(result).toEqual({ stopped: true });
    expect(kill).toHaveBeenCalledWith(ROOT_PID, "SIGTERM");
  });

  it("uses the shell registry when macOS hides the environment", async () => {
    const apple: FixtureRow = { ...row, pid: 4343, pgid: 5555, command: "/bin/sleep 30" };
    respond = (command, args) => {
      if (command === "ps" && args.includes("-A")) return { stdout: processTable([apple]) };
      if (command === "ps" && args.includes("-E")) return { stdout: processEnvironment(apple, false) };
      return { stdout: "" };
    };
    await writeFile(shellRegistry, `5555 ${Math.floor(STARTED_AT / 1000)} ${AGENT.id}\n`);
    const kill = spyOnKill();

    const items = await Effect.runPromise(
      listBackgroundProcesses("darwin", [{ ...AGENT, workspacePath: workspace }], AGENT.id),
    );

    expect(items).toHaveLength(1);
    expect(items?.[0]).toMatchObject({
      agentId: AGENT.id,
      verified: true,
      stoppable: true,
      command: apple.command,
    });

    const result = await Effect.runPromise(
      stopBackgroundProcess("darwin", { id: `${apple.pid}:${STARTED_AT}`, agentId: AGENT.id }, [
        { ...AGENT, workspacePath: workspace },
      ]),
    );

    expect(result).toEqual({ stopped: true });
    expect(kill).toHaveBeenCalledWith(apple.pid, "SIGTERM");
  });

  it("does not trust a shell registry entry after its process group leader was reused", async () => {
    const apple: FixtureRow = { ...row, pid: 4343, pgid: 5555, command: "/bin/sleep 30" };
    const leader: FixtureRow = { pid: 5555, ppid: 1, command: "/bin/sh" };
    respond = (command, args) => {
      if (command === "ps" && args.includes("-A")) return { stdout: processTable([apple, leader]) };
      if (command === "ps" && args.includes("-E")) return { stdout: processEnvironment(apple, false) };
      return { stdout: "" };
    };
    await writeFile(shellRegistry, `5555 ${Math.floor(STARTED_AT / 1000) - 60} ${AGENT.id}\n`);

    const items = await Effect.runPromise(
      listBackgroundProcesses("darwin", [{ ...AGENT, workspacePath: workspace }], AGENT.id),
    );

    expect(items).toEqual([]);
  });

  it("does not stop a shell registry process for another agent", async () => {
    const apple: FixtureRow = { ...row, pid: 4343, pgid: 5555, command: "/bin/zsh -c sleep 30" };
    respond = (command, args) => {
      if (command === "ps" && args.includes("-A")) return { stdout: processTable([apple]) };
      if (command === "ps" && args.includes("-E")) return { stdout: processEnvironment(apple, false) };
      return { stdout: "" };
    };
    await writeFile(shellRegistry, `5555 ${Math.floor(STARTED_AT / 1000)} ${AGENT.id}\n`);
    const kill = spyOnKill();

    const result = await Effect.runPromise(
      stopBackgroundProcess("darwin", { id: `${apple.pid}:${STARTED_AT}`, agentId: OTHER_AGENT.id }, [
        { ...AGENT, workspacePath: workspace },
      ]),
    );

    expect(result).toEqual({ stopped: false, reason: "wrong-agent" });
    expect(kill).not.toHaveBeenCalled();
  });

  it("returns false when the process is no longer there", async () => {
    respond = (command, args) => {
      if (command === "ps" && args.includes("-A")) return { stdout: "" };
      return { stdout: "" };
    };
    const kill = spyOnKill();

    const result = await Effect.runPromise(
      stopBackgroundProcess("darwin", { id: `${ROOT_PID}:${STARTED_AT}`, agentId: AGENT.id }, [
        { ...AGENT, workspacePath: workspace },
      ]),
    );

    expect(result).toEqual({ stopped: false, reason: "not-found" });
    expect(kill).not.toHaveBeenCalled();
  });

  it("rechecks the start time before it sends SIGTERM", async () => {
    let tables = 0;
    respond = (command, args) => {
      if (command === "ps" && args.includes("-A")) {
        tables++;
        const started = tables === 1 ? STARTED : "Fri Oct 30 14:43:00 2026";
        return { stdout: `${ROOT_PID} 1 ${ROOT_PID} ${UID} ${started} ${row.command}` };
      }
      if (command === "ps" && args.includes("-E")) return { stdout: processEnvironment(row, true, AGENT.id) };
      return { stdout: "" };
    };
    const kill = spyOnKill();

    const result = await Effect.runPromise(
      stopBackgroundProcess("darwin", { id: `${ROOT_PID}:${STARTED_AT}`, agentId: AGENT.id }, [
        { ...AGENT, workspacePath: workspace },
      ]),
    );

    expect(result).toEqual({ stopped: false, reason: "not-found" });
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
      if (command === "ps" && args.includes("-E")) return { stdout: processEnvironment(row, true, AGENT.id) };
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
        return { stdout: processEnvironment(row, true, AGENT.id) + processEnvironment(other, true, OTHER_AGENT.id) };
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

  it("reads the working directory only for a process without an agent", async () => {
    const named: FixtureRow = { ...row, pid: ROOT_PID, command: "/usr/bin/curl -sS https://example.com/1MB.bin" };
    const unnamed: FixtureRow = { ...row, pid: ROOT_PID + 2 };
    respond = (command, args) => {
      if (command === "ps" && args.includes("-A")) return { stdout: processTable([named, unnamed]) };
      if (command === "ps" && args.includes("-E")) {
        return { stdout: processEnvironment(named, true, AGENT.id) + processEnvironment(unnamed, false) };
      }
      if (command === "lsof" && args.includes("-d")) {
        return { stdout: lsofCwds([{ pid: unnamed.pid, cwd: workspace }]) };
      }
      return { stdout: "" };
    };

    const items = await Effect.runPromise(listBackgroundProcesses("darwin", [{ ...AGENT, workspacePath: workspace }]));

    const cwdCalls = execFileMock.mock.calls.filter(([command, args]) => {
      return command === "lsof" && Array.isArray(args) && args.includes("-d");
    });
    expect(cwdCalls.length).toBeGreaterThan(0);
    for (const [, args] of cwdCalls) expect(args).toContain(String(unnamed.pid));
    for (const [, args] of cwdCalls) expect(args).not.toContain(String(named.pid));
    expect(items?.map((item) => item.pid).sort()).toEqual([named.pid, unnamed.pid].sort());
  });

  it("caps the ports of one row", async () => {
    respond = (command, args) => {
      if (command === "ps" && args.includes("-A")) return { stdout: processTable([row]) };
      if (command === "ps" && args.includes("-E")) return { stdout: processEnvironment(row, true, AGENT.id) };
      if (command === "lsof" && args.includes("-iTCP")) {
        return {
          stdout: `p${ROOT_PID}\n${Array.from({ length: 40 }, (_, index) => `n*:${8000 + index}\n`).join("")}`,
        };
      }
      return { stdout: "" };
    };

    const items = await Effect.runPromise(listBackgroundProcesses("darwin", [{ ...AGENT, workspacePath: workspace }]));

    expect(items?.[0]?.ports).toHaveLength(32);
  });

  it("does not report a stop when SIGKILL leaves the process running", async () => {
    respond = replyForMarkedDarwin(row, workspace, AGENT.id);
    const kill = vi.spyOn(process, "kill").mockImplementation((_pid, signal) => {
      if (signal === "SIGKILL") return true;
      return true;
    });

    const result = await Effect.runPromise(
      stopBackgroundProcess("darwin", { id: `${ROOT_PID}:${STARTED_AT}`, agentId: AGENT.id }, [
        { ...AGENT, workspacePath: workspace },
      ]),
    );

    expect(result).toEqual({ stopped: false, reason: "still-running" });
    expect(kill).toHaveBeenCalledWith(ROOT_PID, "SIGKILL");
  }, 10_000);

  it("rejects when the process table cannot be read", async () => {
    respond = () => ({ code: 1 });

    await expect(
      Effect.runPromise(listBackgroundProcesses("darwin", [{ ...AGENT, workspacePath: workspace }])),
    ).rejects.toThrow();
  });
});
