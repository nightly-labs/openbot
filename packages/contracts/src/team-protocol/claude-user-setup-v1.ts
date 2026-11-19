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

export function decodeClaudeUserSetupResponse(value: unknown): ClaudeUserSetupSetting {
  if (!isDynamicRecord(value) || !isBoolean(value.enabled)) throw new Error("Invalid Claude setup setting.");
  return { enabled: value.enabled };
}
