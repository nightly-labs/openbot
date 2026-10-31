// Frozen optional agent-thread-branches-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: a signed-in member who can
// send a message to an agent can branch a conversation of the agent. A branch is a new side thread, a
// task of `agent-tasks-v1`, with a copy of the agent's own chat (`taskId` null) or of one side thread
// through the turn of `messageId`, the last agent message of a finished turn. No turn starts. A host
// that grants this also grants `agent-tasks-v1`, whose task shape stays as it is: it never carries the
// branch link. The host does not ask for a role, as for a task start. A hidden agent, or an agent that
// the peer cannot see, is not found (404).
//
// `branch` answers the new task: the frozen `agent-tasks-v1` task, with `branch`, the link to its
// source. A retry with the same `requestId` answers the branch that the first call made, also for a
// retry from another device. The member who branched has read the copy through its last message. A
// source or message that the agent does not have is 404, a source with a running turn or an agent at
// its open-thread limit is 409; the error text says which.
//
// `list` answers the link of each branch among the tasks that the `agent-tasks-v1` list answers, at
// most 50. A link does not change, and it stays when its source is deleted. `agent-tasks-changed`
// carries no link: a client reads `list` again when the task list has a task that it does not know.
// Every route is a POST with its ids in the body. The host sends `agent-tasks-changed` after a branch.
// Bounds and meaning do not follow IPC changes; widening any of it needs a second capability string.
import type { AgentTaskBranch, AgentTasksSnapshot } from "../ipc-agent-tasks";
import { isAgentTaskBranch } from "../ipc-agent-tasks";
import { isIdentifier } from "../ipc-bounded-values";
import { isDynamicRecord } from "../runtime-values";
import {
  type AdminDecoder,
  adminRoute,
  fields,
  identifier,
  list,
  nullable,
  type OptionalRouteCodec,
} from "./admin-wire";
import { AGENT_TASKS_CODECS, AGENT_TASKS_ROUTES } from "./agent-tasks-v1";

export const AGENT_THREAD_BRANCHES_CAPABILITY = "agent-thread-branches-v1";
export const AGENT_THREAD_BRANCHES_ROUTES = {
  branch: "/v1/agent-threads/branch",
  list: "/v1/agent-threads/branches",
} as const;

/** The most links that one `list` answer carries: the size of the `agent-tasks-v1` task list. */
export const AGENT_THREAD_BRANCHES_LIMIT = 50;

const exact =
  (names: string[], decode: AdminDecoder): AdminDecoder =>
  (input) => {
    if (!isDynamicRecord(input) || Object.keys(input).some((key) => !names.includes(key)))
      throw new Error("Invalid agent thread branch request.");
    return decode(input);
  };
const link = fields({
  sourceTaskId: nullable(identifier),
  sourceMessageId: identifier,
  throughMessageId: identifier,
});
const taskLink = fields({
  taskId: identifier,
  sourceTaskId: nullable(identifier),
  sourceMessageId: identifier,
  throughMessageId: identifier,
});
const branch = exact(
  ["agentId", "taskId", "messageId", "requestId"],
  fields({ agentId: identifier, taskId: nullable(identifier), messageId: identifier, requestId: identifier }),
);
const agent = exact(["agentId"], fields({ agentId: identifier }));

/** The frozen `agent-tasks-v1` task of a start, with the link of the branch. */
function branchAnswer(): OptionalRouteCodec["response"] {
  const start = AGENT_TASKS_CODECS.get(AGENT_TASKS_ROUTES.start);
  if (!start) throw new Error("No agent-tasks-v1 codec for the task start.");
  return (status, value) => {
    const task = start.response(status, value);
    if (status >= 400) return task;
    if (!isDynamicRecord(task) || !isDynamicRecord(value)) throw new Error("Invalid agent thread branch.");
    return { ...task, branch: link(value.branch) };
  };
}

export const AGENT_THREAD_BRANCHES_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [AGENT_THREAD_BRANCHES_ROUTES.branch, { request: branch, response: branchAnswer() }],
  [
    AGENT_THREAD_BRANCHES_ROUTES.list,
    adminRoute(agent, fields({ branches: list(taskLink, AGENT_THREAD_BRANCHES_LIMIT) })),
  ],
]);

/** The link of one branch, as `list` answers it. */
export interface AgentThreadBranchLink extends AgentTaskBranch {
  taskId: string;
}

export function isAgentThreadBranchLinks(value: unknown): value is { branches: AgentThreadBranchLink[] } {
  return (
    isDynamicRecord(value) &&
    Array.isArray(value.branches) &&
    value.branches.every((entry) => isDynamicRecord(entry) && isIdentifier(entry.taskId) && isAgentTaskBranch(entry))
  );
}

/** `snapshot` with the link of each task: the one that `links` names, or null for a task that is not a branch. */
export function withAgentThreadBranches(
  snapshot: AgentTasksSnapshot,
  links: readonly AgentThreadBranchLink[],
): AgentTasksSnapshot {
  const byTask = new Map(links.map(({ taskId, ...link }) => [taskId, link]));
  return { ...snapshot, tasks: snapshot.tasks.map((task) => ({ ...task, branch: byTask.get(task.id) ?? null })) };
}
