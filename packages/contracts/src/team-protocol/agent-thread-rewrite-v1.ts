// Optional wire contract for editing a finished user message in the same agent thread.
// A member may rewrite only their own message. The host keeps the earlier history private.
import { isDynamicRecord } from "../runtime-values";
import { type AdminDecoder, fields, identifier, nullable, type OptionalRouteCodec, string } from "./admin-wire";
import { AGENT_TASKS_CODECS, AGENT_TASKS_ROUTES } from "./agent-tasks-v1";

export const AGENT_THREAD_REWRITE_CAPABILITY = "agent-thread-rewrite-v1";
export const AGENT_THREAD_REWRITE_ROUTES = { rewrite: "/v1/agent-threads/rewrite" } as const;

const rewrite: AdminDecoder = (input) => {
  if (
    !isDynamicRecord(input) ||
    Object.keys(input).some((key) => !["agentId", "taskId", "messageId", "text", "requestId"].includes(key))
  )
    throw new Error("Invalid agent thread rewrite request.");
  return fields({
    agentId: identifier,
    taskId: nullable(identifier),
    messageId: identifier,
    text: string(100_000),
    requestId: identifier,
  })(input);
};
const send = AGENT_TASKS_CODECS.get(AGENT_TASKS_ROUTES.send);
if (!send) throw new Error("Agent task send codec is missing.");

export const AGENT_THREAD_REWRITE_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [AGENT_THREAD_REWRITE_ROUTES.rewrite, { request: rewrite, response: send.response }],
]);
