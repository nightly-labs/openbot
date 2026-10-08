// The optional side protocols that every Team API version shares: channels, MCP servers, storage and
// the admin routes in `optional-routes.ts`.
// Each has its own frozen codec, and a route that belongs to one of them never reaches the adapter of
// the negotiated protocol. Every transport, HTTP and WebRTC, client and host, asks here, so a new side
// protocol cannot be added to one of them and left out of another.
//
// The route sets compare `url.pathname` for equality and share no path, so the order of the checks
// below does not change which codec a route gets.
import { channelRequest, channelResponse, isChannelRoute } from "./channels-v1";
import { isChannelHistoryExtentRoute, withChannelHistoryExtent } from "./history-extent-v1";
import { isMcpRoute, mcpRequest, mcpResponse } from "./mcp-v1";
import { optionalRouteCodec } from "./optional-routes";
import { isStorageRoute, storageRequest, storageResponse } from "./storage-v1";
import type { TeamProtocolV2Json } from "./v2";

export interface TeamSideRouteOptions {
  /**
   * history-extent-v1: a channel page keeps its unloaded length. A host passes the negotiated
   * capability; a client passes `true`, because a host sends the extent only when it was negotiated.
   */
  historyExtent?: boolean;
}

export interface TeamSideRouteCodec {
  request(path: string, value: unknown): TeamProtocolV2Json;
  response(path: string, status: number, value: unknown, options?: TeamSideRouteOptions): TeamProtocolV2Json;
}

const CHANNEL_CODEC: TeamSideRouteCodec = {
  request: channelRequest,
  response: (path, status, value, options) => {
    const projected = channelResponse(path, status, value);
    return options?.historyExtent && status < 400 && isChannelHistoryExtentRoute(path)
      ? withChannelHistoryExtent(projected, value)
      : projected;
  },
};
const MCP_CODEC: TeamSideRouteCodec = { request: mcpRequest, response: mcpResponse };
const STORAGE_CODEC: TeamSideRouteCodec = { request: storageRequest, response: storageResponse };

/** The side-protocol codec that owns `path`, or `null` when the negotiated protocol's adapter does. */
export function teamSideRouteCodec(path: string): TeamSideRouteCodec | null {
  if (isChannelRoute(path)) return CHANNEL_CODEC;
  if (isMcpRoute(path)) return MCP_CODEC;
  if (isStorageRoute(path)) return STORAGE_CODEC;
  const admin = optionalRouteCodec(path);
  return admin
    ? {
        request: (_path, value) => admin.request(value),
        response: (_path, status, value) => admin.response(status, value),
      }
    : null;
}
