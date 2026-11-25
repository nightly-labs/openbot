import {
  canAdministerServer,
  parseClearStorageInput,
  parseDeleteStoredFileInput,
  parseGetStorageUsageInput,
  STORAGE_CAPABILITY,
  type StorageUsage,
  type StoredFileRow,
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

export async function routeStorage(
  context: TeamApiRequestContext,
  storage: TeamApiStorage | undefined,
  channels: Pick<ChannelService, "store"> | undefined,
  hiddenAgentIds: ReadonlySet<string>,
  agentIds: () => ReadonlySet<string>,
  workflowIds: () => Promise<ReadonlySet<string>>,
  libraryFolders?: Pick<TeamApiLibraryFolders, "removeFiles">,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  if (method === "POST" && url.pathname === STORAGE_CHANNEL_ROUTES.files) {
    if (!storage || !channels || !capabilities.has(STORAGE_CHANNEL_CAPABILITY))
      throw new HttpError(400, sourceText("error.team.storageUnsupported"));
    const { channelId, force } = await readJson(request);
    if (!isString(channelId)) throw new HttpError(400, sourceText("error.team.storageUnsupported"));
    const body = parseGetStorageUsageInput({ scope: "channel", channelId, force });
    requireVisibleChannel(channels, channelId, canAdministerServer(member.role) ? new Set() : hiddenAgentIds);
    try {
      const usage = await runCauseEffect(storage.usage(body));
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
    await readJson(request);
    return json(200, await runCauseEffect(storage.disk()));
  }
  if (method === "POST" && url.pathname === STORAGE_USER_FILES_ROUTES.disk) {
    if (!storage || !capabilities.has(STORAGE_USER_FILES_CAPABILITY))
      throw new HttpError(400, sourceText("error.team.storageUnsupported"));
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
  const body = await readJson(request);
  try {
    if (usage) {
      const input = parseGetStorageUsageInput(body);
      requireVisibleBodyAgent(body, hiddenAgentIds);
      const living = canAdministerServer(member.role) ? null : agentIds();
      const visible = agentVisibility(hiddenAgentIds, living);
      const shownWorkflows = visible ? await workflowIds() : null;
      const listed = await runCauseEffect(
        storage.usage(
          input,
          visible && shownWorkflows
            ? (file) => visibleFile(file, visible(file.agentId), shownWorkflows).length > 0
            : undefined,
        ),
      );
      const readWorkflows = shownWorkflows ? () => Promise.resolve(shownWorkflows) : workflowIds;
      return json(200, await visibleStorage(listed, hiddenAgentIds, living, readWorkflows));
    }
    if (deleteFile) {
      const { fileId } = parseDeleteStoredFileInput(body);
      await runCauseEffect(storage.deleteFile(fileId));
      if (libraryFolders) await runCauseEffect(libraryFolders.removeFiles([fileId]));
    } else await runCauseEffect(storage.clear(parseClearStorageInput(body).category));
  } catch (error) {
    if (error instanceof StorageNotFoundError) throw new HttpError(404, error.message);
    throw error;
  }
  return json(200, {});
}

function agentVisibility(
  hiddenAgentIds: ReadonlySet<string>,
  livingAgentIds: ReadonlySet<string> | null,
): ((agentId: string | null) => boolean) | null {
  if (hiddenAgentIds.size === 0 && livingAgentIds === null) return null;
  return (agentId) =>
    agentId !== null && !hiddenAgentIds.has(agentId) && (livingAgentIds === null || livingAgentIds.has(agentId));
}

async function visibleStorage(
  usage: StorageUsage,
  hiddenAgentIds: ReadonlySet<string>,
  livingAgentIds: ReadonlySet<string> | null,
  workflowIds: () => Promise<ReadonlySet<string>>,
): Promise<StorageUsage> {
  const agentVisible = agentVisibility(hiddenAgentIds, livingAgentIds);
  const tagged = usage.files.some((file) => file.workflow !== undefined);
  if (!agentVisible && !tagged) return usage;
  const shownWorkflows = tagged ? await workflowIds() : new Set<string>();
  const visible = (agentId: string | null) => !agentVisible || agentVisible(agentId);
  return {
    ...usage,
    agents: usage.agents.filter((row) => visible(row.agentId)),
    conversations: usage.conversations.filter((row) => visible(row.agentId)),
    files: usage.files.flatMap((file) => visibleFile(file, visible(file.agentId), shownWorkflows)),
  };
}

function visibleFile(file: StoredFileRow, agentVisible: boolean, shownWorkflows: ReadonlySet<string>): StoredFileRow[] {
  const { workflow, ...untagged } = file;
  if (workflow && shownWorkflows.has(workflow.id) && (file.agentId === null || agentVisible)) return [file];
  return agentVisible ? [untagged] : [];
}
