// Frozen optional agent-thread-reads-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: a signed-in member who can
// send a message to an agent can read and move their own read mark of each open side thread of the
// agent. A side thread is a task of `agent-tasks-v1`, named by its task id. A read mark belongs to
// the member, not to a device, so all devices of the member share it; another member never sees it.
// The agent's own chat keeps its `conversation/read` routes and is not a task here. `list` answers
// the open side threads of the agent, at most 1000, each with the count of agent messages after the
// mark, the first of them, and the mark. `mark` moves the mark of one side thread to a message of
// that thread and answers the new state; a mark never moves back, and a message the thread does not
// hold leaves it where it is. A hidden agent, or an agent that the peer cannot see, is not found
// (404). Every route is a POST with its ids in the body. The host sends no event when a mark moves:
// a client reads `list` again when the thread list changes or when it shows the agent. Bounds and
// meaning do not follow IPC changes; widening any of it needs a second capability string.
import { adminRoute, count, fields, identifier, list, nullable, type OptionalRouteCodec } from "./admin-wire";

export const AGENT_THREAD_READS_CAPABILITY = "agent-thread-reads-v1";
export const AGENT_THREAD_READS_ROUTES = {
  list: "/v1/agent-threads/reads",
  mark: "/v1/agent-threads/read",
} as const;

/** The most side threads that one `list` answer carries. */
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
