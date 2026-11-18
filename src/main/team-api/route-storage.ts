import {
  canAdministerServer,
  parseClearStorageInput,
  parseDeleteStoredFileInput,
  parseGetStorageUsageInput,
  STORAGE_CAPABILITY,
  type StorageUsage,
} from "@openbot/contracts/ipc";
import { isString } from "@openbot/contracts/runtime-values";
import {
  STORAGE_CHANNEL_CAPABILITY,
  STORAGE_CHANNEL_ROUTES,
} from "@openbot/contracts/team-protocol/storage-channel-v1";
import { STORAGE_DISK_CAPABILITY, STORAGE_DISK_ROUTES } from "@openbot/contracts/team-protocol/storage-disk-v1";
import {
  STORAGE_USER_FILES_CAPABILITY,
  STORAGE_USER_FILES_ROUTES,
} from "@openbot/contracts/team-protocol/storage-user-files-v1";
import { STORAGE_ROUTES } from "@openbot/contracts/team-protocol/storage-v1";
import { sourceText } from "@openbot/i18n/source";
import type { ChannelService } from "../../backend/channel-service";
import { runCauseEffect } from "../../backend/effect-boundary";
import { StorageNotFoundError } from "../../backend/storage-usage";
import type { TeamApiLibraryFolders, TeamApiStorage } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin, requireVisibleBodyAgent } from "./request-helpers";
import { hiddenAuthor, requireVisibleChannel } from "./route-channels";

/**
 * The disk use of the machine that runs this host, read from a joined server.
 *
 * Every member can read it: the answer carries sizes, chat titles and the names of files sent in
 * chats, never a path. A member reads the chats and files only of the agents that they can see
 * (`visibleStorage`); the category sizes count the whole host. Deleting a file and clearing caches or
 * logs change the host, so only an owner or an admin can. Both were decided deliberately and are
 * frozen by `storage-v1`; changing either needs a second capability string.
 */
export async function routeStorage(
  context: TeamApiRequestContext,
  storage: TeamApiStorage | undefined,
  channels: Pick<ChannelService, "store"> | undefined,
  /** The agents hidden from this member. As on the channel routes, they hide a channel only from a member. */
  hiddenAgentIds: ReadonlySet<string>,
  /** The agents that the host has. A member does not get the files of a deleted agent. */
  agentIds: () => ReadonlySet<string>,
  /** The Library folders of this host: a deleted file leaves its folder. */
  libraryFolders?: Pick<TeamApiLibraryFolders, "removeFiles">,
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
  if (method === "POST" && url.pathname === STORAGE_USER_FILES_ROUTES.disk) {
    if (!storage || !capabilities.has(STORAGE_USER_FILES_CAPABILITY))
      throw new HttpError(400, sourceText("error.team.storageUnsupported"));
    // `readJson` checks that the body is empty. Every member can read it, as `storage-user-files-v1` says.
    await readJson(request);
    return json(200, await runCauseEffect(storage.diskUse()));
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
    if (usage) {
      const input = parseGetStorageUsageInput(body);
      requireVisibleBodyAgent(body, hiddenAgentIds);
      const living = canAdministerServer(member.role) ? null : agentIds();
      return json(200, visibleStorage(await runCauseEffect(storage.usage(input)), hiddenAgentIds, living));
    }
    if (deleteFile) {
      const { fileId } = parseDeleteStoredFileInput(body);
      await runCauseEffect(storage.deleteFile(fileId));
      if (libraryFolders) await runCauseEffect(libraryFolders.removeFiles([fileId]));
    }
    // Caches and logs hold no stored file, so the Library folders do not change.
    else await runCauseEffect(storage.clear(parseClearStorageInput(body).category));
  } catch (error) {
    if (error instanceof StorageNotFoundError) throw new HttpError(404, error.message);
    throw error;
  }
  return json(200, {});
}

/**
 * The storage that a peer with hidden agents reads: no chat and no file of a hidden agent. A file id
 * is enough to download the file, so a file that the host cannot place with an agent is left out too:
 * it can be a file of a hidden agent. The chat of a hidden agent answers as a chat with no files.
 *
 * `livingAgentIds` is null for an owner or an admin. A member also gets no file of an agent that the
 * host no longer has: the roles of a deleted agent are gone, so the host cannot tell whether the
 * member could see it.
 */
function visibleStorage(
  usage: StorageUsage,
  hiddenAgentIds: ReadonlySet<string>,
  livingAgentIds: ReadonlySet<string> | null,
): StorageUsage {
  if (hiddenAgentIds.size === 0 && livingAgentIds === null) return usage;
  const visible = (agentId: string | null) =>
    agentId !== null && !hiddenAgentIds.has(agentId) && (livingAgentIds === null || livingAgentIds.has(agentId));
  return {
    ...usage,
    agents: usage.agents.filter((row) => visible(row.agentId)),
    conversations: usage.conversations.filter((row) => visible(row.agentId)),
    files: usage.files.filter((file) => visible(file.agentId)),
  };
}
