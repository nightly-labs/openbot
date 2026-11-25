import { isDynamicRecord } from "../runtime-values";
import {
  type AdminDecoder,
  adminRoute,
  boolean,
  fields,
  identifier,
  list,
  nullable,
  type OptionalRouteCodec,
  string,
} from "./admin-wire";
import { AGENT_TASKS_CODECS, AGENT_TASKS_ROUTES } from "./agent-tasks-v1";

export const AGENT_ARCHIVED_THREADS_CAPABILITY = "agent-archived-threads-v1";
export const AGENT_ARCHIVED_THREADS_ROUTES = {
  list: "/v1/agent-threads/list-archived",
} as const;
export const AGENT_ARCHIVED_THREADS_PAGE_LIMIT = 50;

const KEYS = ["agentId", "before"];
const requestFields = fields({
  agentId: identifier,
  before: nullable(fields({ updatedAt: string(160), threadId: identifier })),
});
const request: AdminDecoder = (input) => {
  if (!isDynamicRecord(input) || Object.keys(input).some((key) => !KEYS.includes(key)))
    throw new Error("Invalid archived thread list request.");
  return requestFields(input);
};

const start = AGENT_TASKS_CODECS.get(AGENT_TASKS_ROUTES.start)?.response;
if (!start) throw new Error(`No agent-tasks-v1 codec for ${AGENT_TASKS_ROUTES.start}.`);
const archivedTask: AdminDecoder = (input) => {
  const task = start(200, input);
  if (!isDynamicRecord(task) || task.state !== "closed") throw new Error("Invalid archived thread.");
  return task;
};

export const AGENT_ARCHIVED_THREADS_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [
    AGENT_ARCHIVED_THREADS_ROUTES.list,
    adminRoute(request, fields({ tasks: list(archivedTask, AGENT_ARCHIVED_THREADS_PAGE_LIMIT), hasMore: boolean })),
  ],
]);
