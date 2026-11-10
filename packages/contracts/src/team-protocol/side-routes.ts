// The optional side protocols that every Team API version shares: channels, MCP servers, storage and
// the admin routes in `optional-routes.ts`.
// Each has its own frozen codec, and a route that belongs to one of them never reaches the adapter of
// the negotiated protocol. Every transport, HTTP and WebRTC, client and host, asks here, so a new side
// protocol cannot be added to one of them and left out of another.
//
// The route sets compare `url.pathname` for equality and share no path, so the order of the checks
// below does not change which codec a route gets.
import { withAgentTaskUiBlocks } from "./agent-task-ui-blocks-v1";
import { isChannelAttentionRoute, withChannelAttention } from "./channel-attention-v1";
import { withChannelDraftIsolation, withChannelIsolation } from "./channel-isolation-v1";
import {
  channelPictureRoute,
  isChannelPictureRoute,
  withChannelDraftPicture,
  withChannelPicture,
} from "./channel-picture-v1";
import { CHANNEL_ROUTES, channelRequest, channelResponse, isChannelRoute } from "./channels-v1";
import { isChannelHistoryExtentRoute, withChannelHistoryExtent } from "./history-extent-v1";
import { isMcpSignInListRoute, mcpManyServersResponse, mcpManySignInsResponse } from "./mcp-many-servers-v1";
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
  /**
   * channel-attention-v1: a channel summary keeps its threads and preview author, and a channel page
   * keeps its UI blocks. A host passes the negotiated capability; a client passes `true`, as above.
   */
  channelAttention?: boolean;
  /** agent-task-ui-blocks-v1: a task conversation keeps its UI blocks. Passed as `channelAttention` is. */
  agentTaskUiBlocks?: boolean;
  /**
   * channel-isolation-v1: a channel keeps `isolated`, in a response and in the draft of a save. Passed
   * as `channelAttention` is, for a request as for a response.
   */
  channelIsolation?: boolean;
  /**
   * channel-picture-v1: a channel keeps `icon` and `imageUrl`, and the draft of a save keeps `icon`.
   * Passed as `channelIsolation` is.
   */
  channelPicture?: boolean;
  /**
   * mcp-many-servers-v1: a list of MCP servers or of their sign-ins holds up to 100 rows. Passed as
   * `channelAttention` is.
   */
  mcpManyServers?: boolean;
}

export interface TeamSideRouteCodec {
  request(path: string, value: unknown, options?: TeamSideRouteOptions): TeamProtocolV2Json;
  response(path: string, status: number, value: unknown, options?: TeamSideRouteOptions): TeamProtocolV2Json;
}

const CHANNEL_CODEC: TeamSideRouteCodec = {
  request: (path, value, options) => {
    const projected = channelRequest(path, value);
    const isolated = options?.channelIsolation ? withChannelDraftIsolation(path, projected, value) : projected;
    return options?.channelPicture ? withChannelDraftPicture(path, isolated, value) : isolated;
  },
  response: (path, status, value, options) => {
    const projected = channelResponse(path, status, value);
    const extended =
      options?.historyExtent && status < 400 && isChannelHistoryExtentRoute(path)
        ? withChannelHistoryExtent(projected, value)
        : projected;
    const isolated = options?.channelIsolation && status < 400 ? withChannelIsolation(path, extended, value) : extended;
    const pictured = options?.channelPicture && status < 400 ? withChannelPicture(path, isolated, value) : isolated;
    return options?.channelAttention && status < 400 && isChannelAttentionRoute(path)
      ? withChannelAttention(path, pictured, value)
      : pictured;
  },
};
/** The image route of channel-picture-v1. Its channel answer is the answer of a channel command. */
const CHANNEL_PICTURE_CODEC: TeamSideRouteCodec = {
  request: channelPictureRoute.request,
  response: (path, status, value, options) => {
    const projected = channelPictureRoute.response(status, value);
    if (status >= 400) return projected;
    const isolated = options?.channelIsolation
      ? withChannelIsolation(CHANNEL_ROUTES.command, projected, value)
      : projected;
    return options?.channelPicture ? withChannelPicture(path, isolated, value) : isolated;
  },
};
const MCP_CODEC: TeamSideRouteCodec = {
  request: mcpRequest,
  response: (path, status, value, options) =>
    options?.mcpManyServers ? mcpManyServersResponse(path, status, value) : mcpResponse(path, status, value),
};
const STORAGE_CODEC: TeamSideRouteCodec = { request: storageRequest, response: storageResponse };

/** The side-protocol codec that owns `path`, or `null` when the negotiated protocol's adapter does. */
export function teamSideRouteCodec(path: string): TeamSideRouteCodec | null {
  if (isChannelRoute(path)) return CHANNEL_CODEC;
  if (isChannelPictureRoute(path)) return CHANNEL_PICTURE_CODEC;
  if (isMcpRoute(path)) return MCP_CODEC;
  if (isStorageRoute(path)) return STORAGE_CODEC;
  const admin = optionalRouteCodec(path);
  return admin
    ? {
        request: (_path, value) => admin.request(value),
        response: (path, status, value, options) => {
          const projected =
            options?.mcpManyServers && status < 400 && isMcpSignInListRoute(path)
              ? mcpManySignInsResponse(value)
              : admin.response(status, value);
          return options?.agentTaskUiBlocks && status < 400 ? withAgentTaskUiBlocks(path, projected, value) : projected;
        },
      }
    : null;
}
