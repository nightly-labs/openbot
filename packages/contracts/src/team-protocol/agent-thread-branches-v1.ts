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
  string,
} from "./admin-wire";
import { AGENT_TASKS_CODECS, AGENT_TASKS_ROUTES } from "./agent-tasks-v1";

export const AGENT_THREAD_BRANCHES_CAPABILITY = "agent-thread-branches-v1";
export const AGENT_THREAD_BRANCHES_ROUTES = {
  branch: "/v1/agent-threads/branch",
  list: "/v1/agent-threads/branches",
} as const;

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
  sourceTitle: nullable(string(120)),
  sourceMessageId: identifier,
  throughMessageId: identifier,
});
const taskLink = fields({
  taskId: identifier,
  sourceTaskId: nullable(identifier),
  sourceTitle: nullable(string(120)),
  sourceMessageId: identifier,
  throughMessageId: identifier,
});
const branch = exact(
  ["agentId", "taskId", "messageId", "requestId"],
  fields({ agentId: identifier, taskId: nullable(identifier), messageId: identifier, requestId: identifier }),
);
const agent = exact(["agentId"], fields({ agentId: identifier }));

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

export function withAgentThreadBranches(
  snapshot: AgentTasksSnapshot,
  links: readonly AgentThreadBranchLink[],
): AgentTasksSnapshot {
  const byTask = new Map(links.map(({ taskId, ...link }) => [taskId, link]));
  return { ...snapshot, tasks: snapshot.tasks.map((task) => ({ ...task, branch: byTask.get(task.id) ?? null })) };
}
