import { parseBrowseChannelFoldersInput, parseChannelFolderInput } from "@openbot/contracts/ipc";
import type { DynamicRecord } from "@openbot/contracts/runtime-values";
import {
  CHANNEL_FOLDERS_CAPABILITY,
  CHANNEL_FOLDERS_ROUTES,
} from "@openbot/contracts/team-protocol/channel-folders-v1";
import { sourceText } from "@openbot/i18n/source";
import type { TeamApiAdmin } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin } from "./request-helpers";

type Folders = NonNullable<TeamApiAdmin["channelFolders"]>;

function parsed<T>(parse: (value: unknown) => T, body: DynamicRecord): T {
  try {
    return parse(body);
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : "Invalid channel folder input.");
  }
}

export async function routeChannelFolders(
  context: TeamApiRequestContext,
  admin: TeamApiAdmin | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request } = context;
  if (method !== "POST" || !Object.values(CHANNEL_FOLDERS_ROUTES).some((path) => path === url.pathname))
    return "unmatched";
  const folders = admin?.channelFolders;
  if (!folders || !capabilities.has(CHANNEL_FOLDERS_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.channelFoldersUnsupported"));
  requireAdmin(member);
  const body = await readJson(request);
  const channelId = typeof body.channelId === "string" ? body.channelId : "";
  if (!folders.hasChannel(channelId)) throw new HttpError(404, sourceText("error.backend.channelNotFound"));
  return answer(context, folders, channelId, body);
}

async function answer(
  { url, json }: TeamApiRequestContext,
  folders: Folders,
  channelId: string,
  body: DynamicRecord,
): Promise<RouteOutcome> {
  switch (url.pathname) {
    case CHANNEL_FOLDERS_ROUTES.read:
      return json(200, await folders.list(channelId));
    case CHANNEL_FOLDERS_ROUTES.add: {
      const input = parsed(parseChannelFolderInput, body);
      return json(200, await folders.add(input.channelId, input.path));
    }
    case CHANNEL_FOLDERS_ROUTES.remove: {
      const input = parsed(parseChannelFolderInput, body);
      return json(200, await folders.remove(input.channelId, input.path));
    }
    default: {
      const input = parsed(parseBrowseChannelFoldersInput, body);
      const listed = await folders.browse(input.path);
      if (!listed) throw new HttpError(404, sourceText("error.team.folderUnavailable"));
      return json(200, listed);
    }
  }
}
