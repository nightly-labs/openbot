import type { ClaudeCompactWindowSetting } from "../ipc-claude-compact-window";
import { isDynamicRecord } from "../runtime-values";
import { type AdminDecoder, adminRoute, empty, fields, nullable, type OptionalRouteCodec } from "./admin-wire";

export const CLAUDE_COMPACT_WINDOW_CAPABILITY = "claude-compact-window-v1";

export const CLAUDE_COMPACT_WINDOW_ROUTES = {
  settings: "/v1/admin/host/claude-compact-window",
  update: "/v1/admin/host/claude-compact-window/update",
} as const;

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

export function decodeClaudeCompactWindowResponse(value: unknown): ClaudeCompactWindowSetting {
  if (!isDynamicRecord(value) || (value.tokens !== null && !isWireTokens(value.tokens)))
    throw new Error("Invalid Claude compaction size.");
  return { tokens: value.tokens };
}
