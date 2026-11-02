// Runs an agent's own chat and two side threads at the same time in this worktree's running dev app,
// through the preload bridge, agent service and a real provider, and checks that the threads do not
// change each other's work. It changes the data of the profile: it clears the context of the
// agent's own chat, and adds memories, routines and workspace files, which it removes at the end.
// Start the app with
// `bun run dev` (never `--shared`), and pass an agent whose provider is signed in and runs turns at
// the same time: `bun scripts/agent-threads-isolation-e2e.ts --allow-mutations --agent=<agent id>`.
//
// 1. Each of the three threads saves its own memory, creates its own routine and writes its own file
//    in the shared workspace, at the same time. All three memories, routines and files are kept; each
//    routine card shows in the thread that created it; no conversation holds another thread's word.
// 2. "Clear context" of the agent's own chat works while a side thread runs a turn.
// 3. A delete of a side thread that races a send to it leaves no message in the agent's own chat.
// The script does not cover a compaction of one side thread: only the agent's own chat has a manual
// compact command. It counts the processes below the app before and after the delete, and does not
// assert the count: a provider can serve all threads from one process.
// Writes .openbot-build/agent-threads-isolation-e2e/report.json.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { agentProviderDescriptor, isAgentProvider } from "@openbot/contracts/agent-providers";
import type { AgentTask, ConversationMessage, ConversationSnapshot } from "@openbot/contracts/ipc";
import { argument, connectChannelE2e, LONG_PROMPT, waitFor, writeReport } from "./channel-e2e-support";

const agentArgument = argument("agent");
assert.ok(agentArgument, "Pass --agent=<agent id> of an agent whose provider is signed in.");
const agentId: string = agentArgument;
const run = crypto.randomUUID().slice(0, 6);

interface Lane {
  label: "main" | "side-a" | "side-b";
  word: string;
  routineName: string;
  memory: string;
  file: string;
  taskId: string | null;
}

interface Report {
  agentId: string;
  provider?: string;
  lanes: Array<{
    label: string;
    taskId: string | null;
    memorySaved: boolean;
    routineCreated: boolean;
    routineCardHere: boolean;
    routineCardElsewhere: string[];
    fileWritten: boolean;
    foreignWords: string[];
  }>;
  clearContextWhileSideRuns?: { sideState: string; cleared: boolean; error: string };
  racingDelete?: {
    deleted: boolean;
    sendResult: string;
    mainHasRaceText: boolean;
    processesBefore: number;
    processesAfter: number;
  };
  notCovered: string[];
  passed: boolean;
}

const report: Report = {
  agentId,
  lanes: [],
  notCovered: ["Compaction of one side thread: only the agent's own chat has a manual compact command."],
  passed: false,
};
const session = await connectChannelE2e("agent-threads-isolation-e2e");
const { page, instance } = session;

const lane = (label: Lane["label"]): Lane => {
  const word = `${label.replace("-", "")}${run}`;
  return {
    label,
    word,
    routineName: `Isolation ${label} ${run}`,
    memory: `The isolation code word of ${label} is ${word}.`,
    file: `openbot-isolation-${label}-${run}.txt`,
    taskId: null,
  };
};
const lanes = [lane("main"), lane("side-a"), lane("side-b")];
const createdRoutineIds: string[] = [];
const createdMemoryIds: string[] = [];
const startedTaskIds: string[] = [];

const prompt = (entry: Lane) =>
  [
    `Do these three steps with your tools, in order, and do not ask questions.`,
    `1. Save this exact text as a new memory with the remember tool: "${entry.memory}"`,
    `2. Create a routine with the create_routine tool. Name: "${entry.routineName}". It runs once a day at 09:00 and asks you to reply with the word ${entry.word}. Leave it paused if you can.`,
    `3. In your working directory, write a file named ${entry.file} that contains only ${entry.word}.`,
    `Then reply with the single word ${entry.word}.`,
  ].join("\n");

const bridge = {
  agent: () =>
    page.evaluate(async (id) => {
      const found = (await window.openbot.agent.listAgents()).find((candidate) => candidate.id === id);
      if (!found) throw new Error(`Unknown agent: ${id}`);
      return { name: found.name, provider: found.provider, workspacePath: found.workspacePath };
    }, agentId),
  tasks: () => page.evaluate((id) => window.openbot.agent.listTasks(id).then((snapshot) => snapshot.tasks), agentId),
  main: (): Promise<ConversationSnapshot> => page.evaluate((id) => window.openbot.agent.readConversation(id), agentId),
  side: (taskId: string): Promise<ConversationSnapshot> =>
    page.evaluate((input) => window.openbot.agent.readTask(input), { agentId, taskId }),
  memories: () => page.evaluate((id) => window.openbot.agent.listMemories(id), agentId),
  routines: () => page.evaluate((id) => window.openbot.agent.listRoutines(id), agentId),
};

const conversationOf = (entry: Lane) => (entry.taskId ? bridge.side(entry.taskId) : bridge.main());
const textOf = (message: ConversationMessage) => message.text;
const replied = (snapshot: ConversationSnapshot, word: string) =>
  snapshot.activeTurnId === null &&
  snapshot.messages.some((message) => message.author === "assistant" && textOf(message).includes(word));

/** The processes below the app's main process. */
function processCount() {
  const rows = execFileSync("ps", ["-A", "-o", "pid=,ppid="], { encoding: "utf8" })
    .trim()
    .split("\n")
    .map((row) => row.trim().split(/\s+/).map(Number));
  const children = new Map<number, number[]>();
  for (const [pid = 0, ppid = 0] of rows) children.set(ppid, [...(children.get(ppid) ?? []), pid]);
  let count = 0;
  const queue = [...(children.get(instance.pid) ?? [])];
  for (let pid = queue.shift(); pid !== undefined; pid = queue.shift()) {
    count += 1;
    queue.push(...(children.get(pid) ?? []));
  }
  return count;
}

let workspacePath = "";
try {
  const agent = await bridge.agent();
  workspacePath = agent.workspacePath;
  report.provider = agent.provider;
  assert.ok(isAgentProvider(agent.provider), `The agent ${agentId} has a provider that this build does not know.`);
  assert.ok(
    agentProviderDescriptor(agent.provider).concurrentTurns,
    `${agent.provider} runs one turn at a time. Choose an agent on another provider.`,
  );
  const [main, sideA, sideB] = lanes;
  assert.ok(main && sideA && sideB);

  // 1. The three threads work at the same time.
  const started = await page.evaluate(
    ({ id, mainText, aText, bText }) =>
      Promise.all([
        window.openbot.agent.sendMessage({ agentId: id, text: mainText, clientMessageId: crypto.randomUUID() }),
        window.openbot.agent.startTask({ agentId: id, text: aText, clientMessageId: crypto.randomUUID() }),
        window.openbot.agent.startTask({ agentId: id, text: bText, clientMessageId: crypto.randomUUID() }),
      ]).then(([, a, b]) => [a.id, b.id]),
    { id: agentId, mainText: prompt(main), aText: prompt(sideA), bText: prompt(sideB) },
  );
  [sideA.taskId = null, sideB.taskId = null] = started;
  startedTaskIds.push(...started);
  for (const entry of lanes) {
    await waitFor(
      page,
      `${entry.label} replies`,
      () => conversationOf(entry),
      (snapshot) => replied(snapshot, entry.word),
    );
  }

  const memories = await bridge.memories();
  for (const memory of memories) {
    if (lanes.some((entry) => memory.text.includes(entry.word))) createdMemoryIds.push(memory.id);
  }
  const routines = await bridge.routines();
  for (const routine of routines) {
    if (lanes.some((entry) => entry.routineName === routine.name)) createdRoutineIds.push(routine.id);
  }
  const conversations = new Map<Lane, ConversationSnapshot>();
  for (const entry of lanes) conversations.set(entry, await conversationOf(entry));
  for (const entry of lanes) {
    const routine = routines.find((candidate) => candidate.name === entry.routineName);
    const cardIn = (snapshot: ConversationSnapshot | undefined) =>
      routine !== undefined &&
      (snapshot?.messages.some((message) => message.itemType?.includes(routine.id) === true) ?? false);
    const others = lanes.filter((other) => other !== entry);
    report.lanes.push({
      label: entry.label,
      taskId: entry.taskId,
      memorySaved: memories.some((memory) => memory.text.includes(entry.word)),
      routineCreated: routine !== undefined,
      routineCardHere: cardIn(conversations.get(entry)),
      routineCardElsewhere: others.filter((other) => cardIn(conversations.get(other))).map((other) => other.label),
      fileWritten:
        existsSync(join(workspacePath, entry.file)) &&
        readFileSync(join(workspacePath, entry.file), "utf8").includes(entry.word),
      // A word of another thread in this conversation means that a message or a card went here.
      foreignWords: others
        .filter((other) => conversations.get(entry)?.messages.some((message) => textOf(message).includes(other.word)))
        .map((other) => other.label),
    });
  }
  for (const result of report.lanes) {
    assert.ok(result.memorySaved, `${result.label}: its memory is saved.`);
    assert.ok(result.routineCreated, `${result.label}: its routine exists.`);
    assert.ok(result.routineCardHere, `${result.label}: its routine card shows in its own thread.`);
    assert.deepEqual(result.routineCardElsewhere, [], `${result.label}: its routine card shows in no other thread.`);
    assert.ok(result.fileWritten, `${result.label}: its file is in the workspace.`);
    assert.deepEqual(result.foreignWords, [], `${result.label}: its conversation holds no word of another thread.`);
  }

  // 2. "Clear context" of the agent's own chat does not wait for a side thread.
  const runningId = sideA.taskId;
  assert.ok(runningId);
  await page.evaluate((input) => window.openbot.agent.sendMessage({ ...input, clientMessageId: crypto.randomUUID() }), {
    agentId,
    taskId: runningId,
    text: LONG_PROMPT,
  });
  const running = await waitFor(page, "side A runs", bridge.tasks, (tasks) =>
    tasks.some((task) => task.id === runningId && task.state === "running"),
  );
  const clearError = await page.evaluate(
    (id) =>
      window.openbot.agent.clearContext(id).then(
        () => "",
        (error: unknown) => (error instanceof Error ? error.message : String(error)),
      ),
    agentId,
  );
  report.clearContextWhileSideRuns = {
    sideState: running.find((task) => task.id === runningId)?.state ?? "missing",
    cleared: clearError === "",
    error: clearError,
  };
  assert.ok(report.clearContextWhileSideRuns.cleared, `Clear context works while a side thread runs: ${clearError}`);
  await page.evaluate((input) => window.openbot.agent.stopTask(input), { agentId, taskId: runningId });
  await waitFor(page, "side A stops", bridge.tasks, (tasks) =>
    tasks.some((task) => task.id === runningId && task.state !== "running"),
  );

  // 3. A delete that races a send: the send goes to the thread or is refused, never to the own chat.
  const raceId = sideB.taskId;
  assert.ok(raceId);
  const raceText = `Race ${run}: reply with the word late.`;
  const processesBefore = processCount();
  const race = await page.evaluate(
    ({ id, taskId, text }) =>
      Promise.allSettled([
        window.openbot.agent.deleteTask({ agentId: id, taskId }),
        window.openbot.agent.sendMessage({ agentId: id, taskId, text, clientMessageId: crypto.randomUUID() }),
      ]).then(([deleted, sent]) => ({
        deleted: deleted.status === "fulfilled" ? "" : String(deleted.reason),
        sent: sent.status === "fulfilled" ? "sent" : String(sent.reason),
      })),
    { id: agentId, taskId: raceId, text: raceText },
  );
  // A send that won the race starts a turn, which refuses the delete. Stop it and delete again.
  if (race.deleted !== "") {
    await page.evaluate((input) => window.openbot.agent.stopTask(input), { agentId, taskId: raceId });
    await waitFor(page, "side B stops", bridge.tasks, (tasks) =>
      tasks.every((task) => task.id !== raceId || task.state !== "running"),
    );
    await page.evaluate((input) => window.openbot.agent.deleteTask(input), { agentId, taskId: raceId });
  }
  const afterDelete = await waitFor(page, "side B is gone", bridge.tasks, (tasks: AgentTask[]) =>
    tasks.every((task) => task.id !== raceId),
  );
  const mainAfter = await bridge.main();
  report.racingDelete = {
    deleted: afterDelete.every((task) => task.id !== raceId),
    sendResult: race.sent,
    mainHasRaceText: mainAfter.messages.some((message) => textOf(message).includes(raceText)),
    processesBefore,
    processesAfter: processCount(),
  };
  assert.ok(!report.racingDelete.mainHasRaceText, "The racing send did not go to the agent's own chat.");
  report.passed = true;
} finally {
  for (const routineId of createdRoutineIds) {
    await page
      .evaluate((input) => window.openbot.agent.deleteRoutine(input), { agentId, routineId })
      .catch(() => undefined);
  }
  for (const memoryId of createdMemoryIds) {
    await page
      .evaluate((input) => window.openbot.agent.deleteMemory(input), { agentId, memoryId })
      .catch(() => undefined);
  }
  for (const taskId of startedTaskIds) {
    await page.evaluate((input) => window.openbot.agent.stopTask(input), { agentId, taskId }).catch(() => undefined);
    await page.evaluate((input) => window.openbot.agent.deleteTask(input), { agentId, taskId }).catch(() => undefined);
  }
  if (workspacePath) for (const entry of lanes) rmSync(join(workspacePath, entry.file), { force: true });
  writeReport("agent-threads-isolation-e2e", report);
  await session.close();
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.passed) process.exitCode = 1;
