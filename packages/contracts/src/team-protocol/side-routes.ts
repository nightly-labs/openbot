import { withAgentTaskUiBlocks } from "./agent-task-ui-blocks-v1";
import { ATTACHMENT_PREVIEW_CODEC, isAttachmentPreviewRoute } from "./attachment-preview-v1";
import { isChannelAttentionRoute, withChannelAttention } from "./channel-attention-v1";
import { withChannelBrowser, withChannelDraftBrowser } from "./channel-browser-v1";
import { withChannelDraftIsolation, withChannelIsolation } from "./channel-isolation-v1";
import {
  channelPictureRoute,
  isChannelPictureRoute,
  withChannelDraftPicture,
  withChannelPicture,
} from "./channel-picture-v1";
import { withChannelSeenSubtasks } from "./channel-seen-subtasks-v1";
import { withChannelTaskWaits } from "./channel-task-waits-v1";
import { CHANNEL_ROUTES, channelRequest, channelResponse, isChannelRoute } from "./channels-v1";
import { isChannelHistoryExtentRoute, withChannelHistoryExtent } from "./history-extent-v1";
import { isMcpSignInListRoute, mcpManyServersResponse, mcpManySignInsResponse } from "./mcp-many-servers-v1";
import { isMcpRoute, mcpRequest, mcpResponse } from "./mcp-v1";
import { optionalRouteCodec } from "./optional-routes";
import { providerManyAccountsRequest, providerManyAccountsResponse } from "./provider-many-accounts-v1";
import { isRoutineResultsRoute, routineResultsWhatsAppResponse } from "./routine-results-whatsapp-v1";
import { isStorageRoute, storageRequest, storageResponse } from "./storage-v1";
import { withStorageWorkflowFiles } from "./storage-workflow-files-v1";
import type { TeamProtocolV2Json } from "./webrtc-framing";

export interface TeamSideRouteOptions {
  historyExtent?: boolean;
  channelAttention?: boolean;
  agentTaskUiBlocks?: boolean;
  channelIsolation?: boolean;
  channelPicture?: boolean;
  channelBrowser?: boolean;
  channelSeenSubtasks?: boolean;
  channelTaskWaits?: boolean;
  mcpManyServers?: boolean;
  providerManyAccounts?: boolean;
  routineResultsWhatsApp?: boolean;
  storageWorkflowFiles?: boolean;
}

export interface TeamSideRouteCodec {
  request(path: string, value: unknown, options?: TeamSideRouteOptions): TeamProtocolV2Json;
  response(path: string, status: number, value: unknown, options?: TeamSideRouteOptions): TeamProtocolV2Json;
}

const CHANNEL_CODEC: TeamSideRouteCodec = {
  request: (path, value, options) => {
    const projected = channelRequest(path, value);
    const isolated = options?.channelIsolation ? withChannelDraftIsolation(path, projected, value) : projected;
    const pictured = options?.channelPicture ? withChannelDraftPicture(path, isolated, value) : isolated;
    return options?.channelBrowser ? withChannelDraftBrowser(path, pictured, value) : pictured;
  },
  response: (path, status, value, options) => {
    const projected = channelResponse(path, status, value);
    const extended =
      options?.historyExtent && status < 400 && isChannelHistoryExtentRoute(path)
        ? withChannelHistoryExtent(projected, value)
        : projected;
    const isolated = options?.channelIsolation && status < 400 ? withChannelIsolation(path, extended, value) : extended;
    const pictured = options?.channelPicture && status < 400 ? withChannelPicture(path, isolated, value) : isolated;
    const browser = options?.channelBrowser && status < 400 ? withChannelBrowser(path, pictured, value) : pictured;
    const seen = options?.channelSeenSubtasks && status < 400 ? withChannelSeenSubtasks(path, browser, value) : browser;
    const waits = options?.channelTaskWaits && status < 400 ? withChannelTaskWaits(path, seen, value) : seen;
    return options?.channelAttention && status < 400 && isChannelAttentionRoute(path)
      ? withChannelAttention(path, waits, value)
      : waits;
  },
};
const CHANNEL_PICTURE_CODEC: TeamSideRouteCodec = {
  request: channelPictureRoute.request,
  response: (path, status, value, options) => {
    const projected = channelPictureRoute.response(status, value);
    if (status >= 400) return projected;
    const isolated = options?.channelIsolation
      ? withChannelIsolation(CHANNEL_ROUTES.command, projected, value)
      : projected;
    const pictured = options?.channelPicture ? withChannelPicture(path, isolated, value) : isolated;
    return options?.channelBrowser ? withChannelBrowser(CHANNEL_ROUTES.command, pictured, value) : pictured;
  },
};
const MCP_CODEC: TeamSideRouteCodec = {
  request: mcpRequest,
  response: (path, status, value, options) =>
    options?.mcpManyServers ? mcpManyServersResponse(path, status, value) : mcpResponse(path, status, value),
};
const STORAGE_CODEC: TeamSideRouteCodec = {
  request: storageRequest,
  response: (path, status, value, options) => {
    const projected = storageResponse(path, status, value);
    return options?.storageWorkflowFiles && status < 400 ? withStorageWorkflowFiles(path, projected, value) : projected;
  },
};
const ATTACHMENT_PREVIEW_SIDE_CODEC: TeamSideRouteCodec = {
  request: (_path, value) => ATTACHMENT_PREVIEW_CODEC.request(value),
  response: (_path, status, value) => ATTACHMENT_PREVIEW_CODEC.response(status, value),
};

export function teamSideRouteCodec(path: string): TeamSideRouteCodec | null {
  if (isChannelRoute(path)) return CHANNEL_CODEC;
  if (isChannelPictureRoute(path)) return CHANNEL_PICTURE_CODEC;
  if (isMcpRoute(path)) return MCP_CODEC;
  if (isStorageRoute(path)) return STORAGE_CODEC;
  if (isAttachmentPreviewRoute(path)) return ATTACHMENT_PREVIEW_SIDE_CODEC;
  const admin = optionalRouteCodec(path);
  return admin
    ? {
        request: (path, value, options) => {
          const manyAccounts = options?.providerManyAccounts ? providerManyAccountsRequest(path) : null;
          return manyAccounts ? manyAccounts(value) : admin.request(value);
        },
        response: (path, status, value, options) => {
          const manyAccounts =
            options?.providerManyAccounts && status < 400 ? providerManyAccountsResponse(path) : null;
          const projected = manyAccounts
            ? manyAccounts(value)
            : options?.mcpManyServers && status < 400 && isMcpSignInListRoute(path)
              ? mcpManySignInsResponse(value)
              : options?.routineResultsWhatsApp && status < 400 && isRoutineResultsRoute(path)
                ? routineResultsWhatsAppResponse(path, value)
                : admin.response(status, value);
          return options?.agentTaskUiBlocks && status < 400 ? withAgentTaskUiBlocks(path, projected, value) : projected;
        },
      }
    : null;
}
