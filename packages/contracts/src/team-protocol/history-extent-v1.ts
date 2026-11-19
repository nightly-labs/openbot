import { isDynamicRecord, isNumber, isString } from "../runtime-values";
import { CHANNEL_ROUTES } from "./channels-v1";
import type { TeamProtocolV2Json } from "./webrtc-framing";

export const TEAM_HISTORY_EXTENT_CAPABILITY = "history-extent-v1";

const OLDEST_AT_LIMIT = 64;

export function isHistoryExtentRoute(method: string, path: string): boolean {
  if (method !== "GET") return false;
  const pathname = new URL(path, "http://openbot.invalid").pathname;
  return (
    /^\/v1\/agents\/[^/]+\/conversation-page$/u.test(pathname) ||
    /^\/v1\/direct\/conversations\/[^/]+\/page$/u.test(pathname)
  );
}

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

export function withPageHistoryExtent(projected: TeamProtocolV2Json, source: unknown): TeamProtocolV2Json {
  if (!isDynamicRecord(projected) || !isDynamicRecord(projected.pageInfo) || !isDynamicRecord(source)) return projected;
  const extent = historyExtent(source.pageInfo);
  if (Object.keys(extent).length === 0) return projected;
  return { ...projected, pageInfo: { ...projected.pageInfo, ...extent } };
}

export function withChannelHistoryExtent(projected: TeamProtocolV2Json, source: unknown): TeamProtocolV2Json {
  if (!isDynamicRecord(projected)) return projected;
  const extent = historyExtent(source);
  if (Object.keys(extent).length === 0) return projected;
  return { ...projected, ...extent };
}
