// Frozen optional claude-user-setup-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: an owner or admin of a
// server can read and set "Use my Claude Code setup" of the host. On, the Claude agents of that server
// load the Claude Code setup of the host's user (`~/.claude` and `~/.agents/skills` on the host). Off,
// each turn sends a shorter prompt. The routes carry only the switch, never a file of that setup. The
// change applies to the Claude processes that start after it. A member cannot use either route;
// `requireAdmin` on the host is the only gate. Widening any of it needs a second capability string.
import type { ClaudeUserSetupSetting } from "../ipc-claude-user-setup";
import { isBoolean, isDynamicRecord } from "../runtime-values";
import { adminRoute, boolean, empty, fields, type OptionalRouteCodec } from "./admin-wire";

export const CLAUDE_USER_SETUP_CAPABILITY = "claude-user-setup-v1";

export const CLAUDE_USER_SETUP_ROUTES = {
  settings: "/v1/admin/host/claude-user-setup",
  update: "/v1/admin/host/claude-user-setup/update",
} as const;

const snapshot = fields({ enabled: boolean });

export const CLAUDE_USER_SETUP_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [CLAUDE_USER_SETUP_ROUTES.settings, adminRoute(empty, snapshot)],
  [CLAUDE_USER_SETUP_ROUTES.update, adminRoute(snapshot, snapshot)],
]);

/**
 * The setting that a host answers, as the client type. It is not the preload decoder: the two check
 * different senders.
 */
export function decodeClaudeUserSetupResponse(value: unknown): ClaudeUserSetupSetting {
  if (!isDynamicRecord(value) || !isBoolean(value.enabled)) throw new Error("Invalid Claude setup setting.");
  return { enabled: value.enabled };
}
