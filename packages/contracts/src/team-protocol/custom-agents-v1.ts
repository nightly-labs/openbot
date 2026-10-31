// Frozen optional custom-agents-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: an owner or admin of a
// server can list, add, replace and remove the host's custom ACP agents, as the local Settings do.
// The host starts the command of each agent on its own computer, as it does for a stdio MCP server
// that an admin adds with `mcp-v1` and for an agent from `acp-registry-v1`. A member cannot use any
// route; `requireAdmin` on the host is the only gate. The trial start (`check`) and the usage answers
// stay on the host's own computer.
//
// Environment values are write-only: a value travels only in a save body, towards the host, and a
// response names the variables only. A save with `value: null` keeps the value that the host holds
// for that name. Widening any of it needs a second capability string.
import { adminRoute, fields, identifier, list, nullable, type OptionalRouteCodec, oneOf, string } from "./admin-wire";

export const CUSTOM_AGENTS_CAPABILITY = "custom-agents-v1";

export const CUSTOM_AGENTS_ROUTES = {
  list: "/v1/admin/custom-agents/list",
  save: "/v1/admin/custom-agents/save",
  delete: "/v1/admin/custom-agents/delete",
} as const;

const AGENTS = 16;
const command = string(1024);
const args = list(string(1024), 32);
const usagePrompt = nullable(string(256));
const summary = fields({
  id: identifier,
  name: string(80),
  command,
  args,
  envNames: list(string(128), 16),
  usagePrompt,
  resolvedCommand: nullable(command),
});
const result = fields({
  agents: list(summary, AGENTS),
  restart: oneOf("restarted", "skipped-busy", "not-running"),
});

export const CUSTOM_AGENTS_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [CUSTOM_AGENTS_ROUTES.list, adminRoute(fields({}), list(summary, AGENTS))],
  [
    CUSTOM_AGENTS_ROUTES.save,
    adminRoute(
      fields({
        id: identifier,
        name: string(80),
        command,
        args,
        env: list(fields({ name: string(128), value: nullable(string(4096)) }), 16),
        usagePrompt,
      }),
      result,
    ),
  ],
  [CUSTOM_AGENTS_ROUTES.delete, adminRoute(fields({ id: identifier }), result)],
]);
