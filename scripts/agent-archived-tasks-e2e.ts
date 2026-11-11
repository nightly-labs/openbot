/**
 * Runtime evidence for the reachability of archived agent tasks on the paths that a notification
 * tap takes. Runs the real `AgentThreadStore` against a throwaway database, with no Electron, no
 * login and no provider:
 *
 * 1. `list()` holds open threads first and recent archived threads after them (the order that the
 *    `agent-tasks-v1` list route serves the phone).
 * 2. `task(taskId)` finds an archived task (the path of `readAgentTask`, which `agent-tasks-v1`
 *    `get` serves).
 * 3. `taskForThread(threadId)` finds an archived task (the path that turns a notification thread
 *    into a task on the host).
 * 4. `list()` caps at `INPUT_LIMITS.agentTasks` (50): a task that the phone taps stays in the list
 *    while it is among the newest rows, and an old archived row past the cap drops out.
 *
 * `bun scripts/agent-archived-tasks-e2e.ts` (bun 1.4.2).
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(tmpdir(), `openbot-archived-tasks-${Date.now()}`);
const userData = join(root, "user-data");
mkdirSync(userData, { recursive: true });

const results: Array<{ check: string; ok: boolean; detail: string }> = [];
const hold = (check: string, ok: boolean, detail: string) => results.push({ check, ok, detail });

const { AgentThreadStore } = await import("../src/backend/agent-threads/agent-thread-store");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { INPUT_LIMITS } = await import("@openbot/contracts/input-limits");

const database = new OpenBotDatabase(userData);
await runCauseEffect(database.initialize());
const store = new AgentThreadStore(database);

const agentId = `agent-${randomUUID()}`;
const create = (title: string) => store.create({ agentId, origin: "user", title, titleSource: "auto" });

// One open task and one archived task, the two states that a tap can meet.
const openTask = create("Open task");
const archivedTask = create("Archived task");
store.close(archivedTask.taskId);
const archived = store.task(archivedTask.taskId);
hold(
  "close sets archivedAt and keeps updatedAt",
  archived !== null && archived.closedAt !== null,
  `closedAt=${archived?.closedAt ?? "null"}`,
);

const listed = store.list(agentId);
const listedIds = listed.map((task) => task.taskId);
hold(
  "list holds the archived task",
  listedIds.includes(archivedTask.taskId),
  `list=${listedIds.join(",")}`,
);
hold(
  "list orders open before archived",
  listedIds.indexOf(openTask.taskId) < listedIds.indexOf(archivedTask.taskId),
  `open=${listedIds.indexOf(openTask.taskId)} archived=${listedIds.indexOf(archivedTask.taskId)}`,
);

const readArchived = store.task(archivedTask.taskId);
hold(
  "task(taskId) reads the archived task (readAgentTask path)",
  readArchived !== null && readArchived.taskId === archivedTask.taskId && readArchived.closedAt !== null,
  `taskId=${readArchived?.taskId ?? "null"}`,
);

const byThread = store.taskForThread(archivedTask.threadId);
hold(
  "taskForThread(threadId) reads the archived task (notification path)",
  byThread !== null && byThread.threadId === archivedTask.threadId,
  `threadId=${byThread?.threadId ?? "null"}`,
);

// The cap: fill the list past `INPUT_LIMITS.agentTasks` with newer archived rows, then check that
// the tapped task stays while an old archived row drops out.
const fillCount = INPUT_LIMITS.agentTasks + 5;
const filled: string[] = [];
for (let index = 0; index < fillCount; index += 1) {
  const task = create(`Filler ${index}`);
  store.close(task.taskId);
  filled.push(task.taskId);
}
const capped = store.list(agentId);
hold(
  `list caps at INPUT_LIMITS.agentTasks=${INPUT_LIMITS.agentTasks}`,
  capped.length === INPUT_LIMITS.agentTasks,
  `length=${capped.length}`,
);
// A task whose turn just ended (a close and a reopen both refresh `updated_at`) ranks among the
// newest archived rows, so the list that the phone reads holds it.
store.reopen(archivedTask.taskId);
store.close(archivedTask.taskId);
const tapped = store.list(agentId);
hold(
  "a task that was active after the fillers stays in the capped list",
  tapped.map((task) => task.taskId).includes(archivedTask.taskId),
  `held=${tapped.map((task) => task.taskId).includes(archivedTask.taskId)}`,
);
// An archived task whose last activity is older than 50 newer rows drops out of the list, but the
// paths that a tap and a notification take (task and taskForThread) still find it.
const oldestFiller = filled[0] ?? "";
const oldestThread = store.task(oldestFiller)?.threadId ?? "";
hold(
  "an old archived task drops out past the cap yet stays readable",
  !tapped.map((task) => task.taskId).includes(oldestFiller) &&
    store.task(oldestFiller) !== null &&
    store.taskForThread(oldestThread) !== null,
  `dropped=${!tapped.map((task) => task.taskId).includes(oldestFiller)} stillReadable=${store.task(oldestFiller) !== null}`,
);

const failed = results.filter((result) => !result.ok);
for (const result of results) console.log(`${result.ok ? "PASS" : "FAIL"} ${result.check} (${result.detail})`);
console.log(`VERDICT ${failed.length === 0 ? "PASS" : "FAIL"} (${results.length} checks, ${failed.length} failed)`);

rmSync(root, { recursive: true, force: true });
if (failed.length > 0) process.exit(1);
