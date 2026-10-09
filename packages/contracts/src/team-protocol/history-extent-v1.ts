import { isDynamicRecord, isNumber, isString } from "../runtime-values";
import { CHANNEL_ROUTES } from "./channels-v1";
import type { TeamProtocolV2Json } from "./v2";

/**
 * Frozen optional history-extent-v1 contract: the unloaded length of a history page, which the chat's
 * day rail draws. It adds `olderCount` (a non-negative safe integer) and `oldestAt` (a string of at
 * most 64 characters) beside the frozen keys of:
 *
 * - `pageInfo` of `GET /v1/agents/:agentId/conversation-page` and `GET /v1/direct/conversations/:id/page`;
 * - the page object of `POST /v1/channels/read`.
 *
 * The host adds them only on a request that advertises the capability, so the wire of every released
 * client stays as it was. A host without the capability never sends them, so a client accepts them
 * whenever they are present. A present malformed value fails closed. Widening any of it needs a second
 * capability string.
 */
export const TEAM_HISTORY_EXTENT_CAPABILITY = "history-extent-v1";

const OLDEST_AT_LIMIT = 64;

/** The agent and direct conversation page routes whose `pageInfo` carries the extent. */
export function isHistoryExtentRoute(method: string, path: string): boolean {
  if (method !== "GET") return false;
  const pathname = new URL(path, "http://openbot.invalid").pathname;
  return (
    /^\/v1\/agents\/[^/]+\/conversation-page$/u.test(pathname) ||
    /^\/v1\/direct\/conversations\/[^/]+\/page$/u.test(pathname)
  );
}

/** The channel route whose page carries the extent at its top level. */
export function isChannelHistoryExtentRoute(path: string): boolean {
  return new URL(path, "http://openbot.invalid").pathname === CHANNEL_ROUTES.read;
}

function historyExtent(source: unknown): { olderCount?: number; oldestAt?: string } {
  if (!isDynamicRecord(source)) return {};
  const { olderCount, oldestAt } = source;
  if (olderCount !== undefined && !(isNumber(olderCount) && Number.isSafeInteger(olderCount) && olderCount >= 0))
    throw new Error("Invalid history olderCount.");
  if (oldestAt !== undefined && !(isString(oldestAt) && oldestAt.length <= OLDEST_AT_LIMIT))
    throw new Error("Invalid history oldestAt.");
  return {
    ...(olderCount === undefined ? {} : { olderCount }),
    ...(oldestAt === undefined ? {} : { oldestAt }),
  };
}

/** `projected` with the extent of `source.pageInfo` added to its `pageInfo`. */
export function withPageHistoryExtent(projected: TeamProtocolV2Json, source: unknown): TeamProtocolV2Json {
  if (!isDynamicRecord(projected) || !isDynamicRecord(projected.pageInfo) || !isDynamicRecord(source)) return projected;
  const extent = historyExtent(source.pageInfo);
  if (Object.keys(extent).length === 0) return projected;
  return { ...projected, pageInfo: { ...projected.pageInfo, ...extent } };
}

/** `projected` with the extent at the top level of `source` added to it. */
export function withChannelHistoryExtent(projected: TeamProtocolV2Json, source: unknown): TeamProtocolV2Json {
  if (!isDynamicRecord(projected)) return projected;
  const extent = historyExtent(source);
  if (Object.keys(extent).length === 0) return projected;
  return { ...projected, ...extent };
}
