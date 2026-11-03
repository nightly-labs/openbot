// Frozen optional agent-instructions-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: an owner or admin of a
// server can read and save the instruction file at the root of an agent's workspace on the host
// (`AGENTS.md`, or `CLAUDE.md` in an older workspace). The read gives the file name, whether the file
// exists, and its text. A save sends the whole new text and the text that the edit started from
// (`expected`); the host refuses the save with 409 when the file text is different now, or when the
// text is too long. The agent reads the file in each session. A member cannot use either route;
// `requireAdmin` on the host is the only gate. The workspace path does not cross the wire. Widening
// any of it needs a second capability string.
import { adminRoute, boolean, fields, identifier, type OptionalRouteCodec, oneOf, string } from "./admin-wire";

export const AGENT_INSTRUCTIONS_CAPABILITY = "agent-instructions-v1";

export const AGENT_INSTRUCTIONS_ROUTES = {
  read: "/v1/admin/agents/instructions",
  save: "/v1/admin/agents/instructions/save",
} as const;

/** The read limit of the host, eight times the longest text that a save writes. */
const file = fields({ fileName: oneOf("AGENTS.md", "CLAUDE.md"), exists: boolean, text: string(256_000) });

export const AGENT_INSTRUCTIONS_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [AGENT_INSTRUCTIONS_ROUTES.read, adminRoute(fields({ agentId: identifier }), file)],
  [
    AGENT_INSTRUCTIONS_ROUTES.save,
    adminRoute(fields({ agentId: identifier, text: string(32_000), expected: string(256_000) }), file),
  ],
]);
