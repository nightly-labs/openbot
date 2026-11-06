import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BackgroundTasks, lastLogLine } from "./background-tasks";

const roots: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "openbot-background-tasks-"));
  roots.push(root);
  return root;
}

async function waitFor(check: () => Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("timed out waiting for the background task");
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("lastLogLine", () => {
  it("keeps the last line without colours or cursor moves", () => {
    expect(lastLogLine("\u001b[32mfirst\u001b[0m\nsecond\r\u001b[2K  third  \n\n")).toBe("third");
  });

  it("folds whitespace and cuts a line that is too long", () => {
    const line = lastLogLine(`${"x".repeat(400)}  y`);
    expect(line.length).toBe(160);
    expect(line.includes("  ")).toBe(false);
  });

  it("has nothing to show for an empty log", () => {
    expect(lastLogLine("\n\n")).toBe("");
  });
});

describe.skipIf(process.platform === "win32")("background tasks", () => {
  it("records the exit code and the last line of a finished program", async () => {
    const root = await makeRoot();
    const tasks = new BackgroundTasks(root);
    const started = await tasks.start({
      agentId: "agent-1",
      workspace: root,
      command: "echo one; echo two; exit 3",
      title: "Two lines",
    });
    expect(started.status).toBe("running");
    expect(started.pid).toBeGreaterThan(0);

    await waitFor(async () => (await tasks.list("agent-1"))[0]?.status === "finished");
    const [finished] = await tasks.list("agent-1");
    expect(finished?.exitCode).toBe(3);
    expect(finished?.lastLine).toBe("two");
    expect(finished?.title).toBe("Two lines");
    expect(finished?.endedAt).toBeGreaterThan(0);
  });

  it("reads the tail of a running program", async () => {
    const root = await makeRoot();
    const tasks = new BackgroundTasks(root);
    const task = await tasks.start({ agentId: "agent-2", workspace: root, command: "printf abcdefghij" });
    await waitFor(async () => (await tasks.tail(task.id, 64)) === "abcdefghij");
    const tail = await tasks.tail(task.id, 4);
    expect(tail).toBe("ghij");
    expect(await tasks.tail("not-a-task", 4)).toBeNull();
  });

  it("shows the last line of a program that is still running", async () => {
    const root = await makeRoot();
    const tasks = new BackgroundTasks(root);
    const task = await tasks.start({
      agentId: "agent-2b",
      workspace: root,
      command: "echo first; sleep 30",
    });
    await waitFor(async () => (await tasks.list("agent-2b"))[0]?.lastLine === "first");
    const [running] = await tasks.list("agent-2b");
    expect(running?.status).toBe("running");
    expect(running?.lastLine).toBe("first");
    await tasks.stop(task.id);
  });

  it("stops the program and its children", async () => {
    const root = await makeRoot();
    const tasks = new BackgroundTasks(root);
    const task = await tasks.start({ agentId: "agent-3", workspace: root, command: "sleep 30 & wait" });
    await waitFor(async () => (await tasks.list("agent-3"))[0]?.pid === task.pid);

    await tasks.stop(task.id);
    const [stopped] = await tasks.list("agent-3");
    expect(stopped?.status).toBe("stopped");
    expect(stopped?.endedAt).toBeGreaterThan(0);
  });

  it("lists what it stored after a restart and closes a program that ended meanwhile", async () => {
    const root = await makeRoot();
    const first = new BackgroundTasks(root);
    const task = await first.start({ agentId: "agent-4", workspace: root, command: "echo kept" });
    await waitFor(async () => (await first.list("agent-4"))[0]?.status === "finished");

    const second = new BackgroundTasks(root);
    const [restored] = await second.list("agent-4");
    expect(restored?.id).toBe(task.id);
    expect(restored?.status).toBe("finished");
    expect(restored?.exitCode).toBe(0);
    expect(restored?.lastLine).toBe("kept");
  });

  it("keeps the tasks of one agent apart from another agent's", async () => {
    const root = await makeRoot();
    const tasks = new BackgroundTasks(root);
    await tasks.start({ agentId: "agent-5", workspace: root, command: "echo five" });
    await waitFor(async () => (await tasks.list("agent-5")).length === 1);
    expect(await tasks.list("agent-6")).toEqual([]);
  });
});
