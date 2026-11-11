import {
  canAdministerServer,
  parseClearStorageInput,
  parseDeleteStoredFileInput,
  parseGetStorageUsageInput,
  STORAGE_CAPABILITY,
} from "@openbot/contracts/ipc";
import { isString } from "@openbot/contracts/runtime-values";
import {
  STORAGE_CHANNEL_CAPABILITY,
  STORAGE_CHANNEL_ROUTES,
} from "@openbot/contracts/team-protocol/storage-channel-v1";
import { STORAGE_DISK_CAPABILITY, STORAGE_DISK_ROUTES } from "@openbot/contracts/team-protocol/storage-disk-v1";
import { STORAGE_ROUTES } from "@openbot/contracts/team-protocol/storage-v1";
import { sourceText } from "@openbot/i18n/source";
import type { ChannelService } from "../../backend/channel-service";
import { runCauseEffect } from "../../backend/effect-boundary";
import { StorageNotFoundError } from "../../backend/storage-usage";
import type { TeamApiStorage } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin } from "./request-helpers";
import { hiddenAuthor, requireVisibleChannel } from "./route-channels";

/**
 * The disk use of the machine that runs this host, read from a joined server.
 *
 * Every member can read it: the answer carries sizes, chat titles and the names of files sent in
 * chats, never a path. Deleting a file and clearing caches or logs change the host, so only an
 * owner or an admin can. Both were decided deliberately and are frozen by `storage-v1`; changing
 * either needs a second capability string.
 */
export async function routeStorage(
  context: TeamApiRequestContext,
  storage: TeamApiStorage | undefined,
  channels: Pick<ChannelService, "store"> | undefined,
  /** The agents hidden from this member. As on the channel routes, they hide a channel only from a member. */
  hiddenAgentIds: ReadonlySet<string>,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  if (method === "POST" && url.pathname === STORAGE_CHANNEL_ROUTES.files) {
    if (!storage || !channels || !capabilities.has(STORAGE_CHANNEL_CAPABILITY))
      throw new HttpError(400, sourceText("error.team.storageUnsupported"));
    // `readJson` has already run the body through the storage-channel-v1 codec. Every member who can
    // see the channel can read its files, as that contract says.
    const { channelId, force } = await readJson(request);
    if (!isString(channelId)) throw new HttpError(400, sourceText("error.team.storageUnsupported"));
    const body = parseGetStorageUsageInput({ scope: "channel", channelId, force });
    requireVisibleChannel(channels, channelId, canAdministerServer(member.role) ? new Set() : hiddenAgentIds);
    try {
      const usage = await runCauseEffect(storage.usage(body));
      // As on the channel read route, a message of an agent hidden from this peer is not shown, and its
      // files are not shown either.
      const hiddenMessages = new Set(
        hiddenAgentIds.size === 0
          ? []
          : channels.store
              .messages(channelId)
              .filter((message) => hiddenAuthor(message, hiddenAgentIds))
              .map((message) => message.id),
      );
      const files = usage.files.filter(
        (file) =>
          !(file.messageId && hiddenMessages.has(file.messageId)) &&
          !(file.agentId && hiddenAgentIds.has(file.agentId)),
      );
      return json(200, { channelId, scannedAt: usage.scannedAt, files, truncated: usage.truncated });
    } catch (error) {
      if (error instanceof StorageNotFoundError) throw new HttpError(404, error.message);
      throw error;
    }
  }
  if (method === "POST" && url.pathname === STORAGE_DISK_ROUTES.disk) {
    if (!storage || !capabilities.has(STORAGE_DISK_CAPABILITY))
      throw new HttpError(400, sourceText("error.team.storageUnsupported"));
    // `readJson` checks that the body is empty. Every member can read it, as `storage-disk-v1` says.
    await readJson(request);
    return json(200, await runCauseEffect(storage.disk()));
  }
  const usage = method === "POST" && url.pathname === STORAGE_ROUTES.usage;
  const deleteFile = method === "POST" && url.pathname === STORAGE_ROUTES.deleteFile;
  const clear = method === "POST" && url.pathname === STORAGE_ROUTES.clear;
  if (!usage && !deleteFile && !clear) return "unmatched";
  if (!storage || !capabilities.has(STORAGE_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.storageUnsupported"));
  if (!usage) requireAdmin(member);
  // `readJson` has already run the body through the storage wire codec.
  const body = await readJson(request);
  try {
    if (usage) return json(200, await runCauseEffect(storage.usage(parseGetStorageUsageInput(body))));
    if (deleteFile) await runCauseEffect(storage.deleteFile(parseDeleteStoredFileInput(body).fileId));
    else await runCauseEffect(storage.clear(parseClearStorageInput(body).category));
  } catch (error) {
    if (error instanceof StorageNotFoundError) throw new HttpError(404, error.message);
    throw error;
  }
  return json(200, {});
}
