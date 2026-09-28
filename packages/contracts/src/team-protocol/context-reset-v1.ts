// Frozen optional context-reset-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: any member of a server can
// start a new chat with one agent of the host that the member can see. The host writes a
// `context-reset` marker into the agent's own thread and ends the provider sessions of that thread,
// so the next turn does not see the messages before the marker. The messages stay, and the agent's
// profile, memories, workspace, browser, and channel threads do not change. Only the agent id
// crosses the wire, and the response is empty. The host refuses the reset while the agent has a
// turn or a queued message. Widening any of it needs a second capability string.
import { adminRoute, empty, fields, identifier, type OptionalRouteCodec } from "./admin-wire";

export const CONTEXT_RESET_CAPABILITY = "context-reset-v1";

export const CONTEXT_RESET_ROUTES = {
  clear: "/v1/agent-context/clear",
} as const;

export const CONTEXT_RESET_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [CONTEXT_RESET_ROUTES.clear, adminRoute(fields({ agentId: identifier }), empty)],
]);

/** The host refuses a new chat while the agent works. Its text is a sentence for the member. */
export class ContextResetBusyError extends Error {}
