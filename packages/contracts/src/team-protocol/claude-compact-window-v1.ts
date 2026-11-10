// Frozen optional claude-compact-window-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: an owner or admin of a
// server can read and set the size at which Claude Code compacts the chats of that server's agents.
// `tokens` is a whole number from 100,000 to 1,000,000, or null for Claude Code's own size for each
// model. Automatic compaction stays on; a model with a smaller context window compacts at its own
// limit. The host applies it to the Claude processes that start after the change. A member cannot
// use either route; `requireAdmin` on the host is the only gate. Widening any of it needs a second
// capability string.
import type { ClaudeCompactWindowSetting } from "../ipc-claude-compact-window";
import { isDynamicRecord } from "../runtime-values";
import { type AdminDecoder, adminRoute, empty, fields, nullable, type OptionalRouteCodec } from "./admin-wire";

export const CLAUDE_COMPACT_WINDOW_CAPABILITY = "claude-compact-window-v1";

export const CLAUDE_COMPACT_WINDOW_ROUTES = {
  settings: "/v1/admin/host/claude-compact-window",
  update: "/v1/admin/host/claude-compact-window/update",
} as const;

/** The frozen bounds of the wire. Claude Code accepts no size outside them. */
function isWireTokens(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 100_000 && value <= 1_000_000;
}

const tokens: AdminDecoder = (value) => {
  if (!isWireTokens(value)) throw new Error("Invalid Claude compaction size.");
  return value;
};

const snapshot = fields({ tokens: nullable(tokens) });

export const CLAUDE_COMPACT_WINDOW_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [CLAUDE_COMPACT_WINDOW_ROUTES.settings, adminRoute(empty, snapshot)],
  [CLAUDE_COMPACT_WINDOW_ROUTES.update, adminRoute(snapshot, snapshot)],
]);

/**
 * The setting that a host answers, as the client type. It is not the preload decoder: the two check
 * different senders.
 */
export function decodeClaudeCompactWindowResponse(value: unknown): ClaudeCompactWindowSetting {
  if (!isDynamicRecord(value) || (value.tokens !== null && !isWireTokens(value.tokens)))
    throw new Error("Invalid Claude compaction size.");
  return { tokens: value.tokens };
}
