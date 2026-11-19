import { adminRoute, boolean, fields, identifier, type OptionalRouteCodec, oneOf, string } from "./admin-wire";

export const AGENT_INSTRUCTIONS_CAPABILITY = "agent-instructions-v1";

export const AGENT_INSTRUCTIONS_ROUTES = {
  read: "/v1/admin/agents/instructions",
  save: "/v1/admin/agents/instructions/save",
} as const;

const file = fields({ fileName: oneOf("AGENTS.md", "CLAUDE.md"), exists: boolean, text: string(256_000) });

export const AGENT_INSTRUCTIONS_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [AGENT_INSTRUCTIONS_ROUTES.read, adminRoute(fields({ agentId: identifier }), file)],
  [
    AGENT_INSTRUCTIONS_ROUTES.save,
    adminRoute(fields({ agentId: identifier, text: string(32_000), expected: string(256_000) }), file),
  ],
]);
