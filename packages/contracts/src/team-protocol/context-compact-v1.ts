// Frozen optional context-compact-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: a member of a server who can
// send messages to an agent of the host can ask the host to compact the context of that agent's own
// chat (`compact`), or of one open side task of the agent (`compactTask`), now. The host asks the
// provider to compact the session, as "Compact now" on the host does; the messages stay. Only the
// agent id, and the task id for a task, cross the wire, and the response is empty. The host refuses
// with 409 while the chat or task has a turn or a queued message, or when its provider cannot compact
// it. The progress and result arrive in the `compaction` of `context-usage-v1`. Widening any of it
// needs a second capability string.
import { adminRoute, empty, fields, identifier, type OptionalRouteCodec } from "./admin-wire";

export const CONTEXT_COMPACT_CAPABILITY = "context-compact-v1";

export const CONTEXT_COMPACT_ROUTES = {
  compact: "/v1/agent-context/compact",
  compactTask: "/v1/agent-context/compact-task",
} as const;

export const CONTEXT_COMPACT_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [CONTEXT_COMPACT_ROUTES.compact, adminRoute(fields({ agentId: identifier }), empty)],
  [CONTEXT_COMPACT_ROUTES.compactTask, adminRoute(fields({ agentId: identifier, taskId: identifier }), empty)],
]);

/** The host cannot compact the context now. Its text is a sentence for the member. */
export class ContextCompactRefusedError extends Error {}
