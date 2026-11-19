import { adminRoute, count, fields, identifier, list, nullable, type OptionalRouteCodec } from "./admin-wire";

export const AGENT_THREAD_READS_CAPABILITY = "agent-thread-reads-v1";
export const AGENT_THREAD_READS_ROUTES = {
  list: "/v1/agent-threads/reads",
  mark: "/v1/agent-threads/read",
} as const;

export const AGENT_THREAD_READS_LIMIT = 1000;

const readState = fields({
  taskId: identifier,
  unreadCount: count,
  firstUnreadMessageId: nullable(identifier),
  throughMessageId: nullable(identifier),
});

export const AGENT_THREAD_READS_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [
    AGENT_THREAD_READS_ROUTES.list,
    adminRoute(fields({ agentId: identifier }), fields({ reads: list(readState, AGENT_THREAD_READS_LIMIT) })),
  ],
  [
    AGENT_THREAD_READS_ROUTES.mark,
    adminRoute(fields({ agentId: identifier, taskId: identifier, throughMessageId: identifier }), readState),
  ],
]);
