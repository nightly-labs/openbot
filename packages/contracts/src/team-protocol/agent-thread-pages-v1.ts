import { isDynamicRecord } from "../runtime-values";
import { type AdminDecoder, adminRoute, boolean, fields, identifier, type OptionalRouteCodec } from "./admin-wire";
import { AGENT_TASKS_CODECS, AGENT_TASKS_ROUTES } from "./agent-tasks-v1";

export const AGENT_THREAD_PAGES_CAPABILITY = "agent-thread-pages-v1";
export const AGENT_THREAD_PAGES_ROUTES = {
  readOlder: "/v1/agent-threads/read-older",
} as const;
export const AGENT_THREAD_PAGE_LIMIT = 100;

const NAMES = ["agentId", "taskId", "beforeMessageId", "limit"];
const limit: AdminDecoder = (input) => {
  if (typeof input !== "number" || !Number.isInteger(input) || input < 0 || input > AGENT_THREAD_PAGE_LIMIT)
    throw new Error("Invalid agent thread page limit.");
  return input;
};
const decodeFields = fields({ agentId: identifier, taskId: identifier, beforeMessageId: identifier, limit });
const readOlder: AdminDecoder = (input) => {
  if (!isDynamicRecord(input) || Object.keys(input).some((key) => !NAMES.includes(key)))
    throw new Error("Invalid agent thread page request.");
  return decodeFields(input);
};

const read = AGENT_TASKS_CODECS.get(AGENT_TASKS_ROUTES.read)?.response;
if (!read) throw new Error(`No agent-tasks-v1 codec for ${AGENT_TASKS_ROUTES.read}.`);
const conversation: AdminDecoder = (input) => read(200, input);

export const AGENT_THREAD_PAGES_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [AGENT_THREAD_PAGES_ROUTES.readOlder, adminRoute(readOlder, fields({ conversation, hasOlder: boolean }))],
]);
