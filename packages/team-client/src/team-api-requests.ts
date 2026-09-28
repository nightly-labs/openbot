// Team API requests that the web client and the mobile app send in the same way.
//
// Each client has its own transport and its own error text for most responses, so only the requests
// whose path, body and decoding are the same in both are here. A request that differs in one of them
// stays at its call site.

import {
  type AttachmentSummary,
  BROWSER_SECRET_RESPONSE_PATH,
  decodeChannel,
  decodeChannelMemories,
  decodeChannelMemory,
  decodeChannelPage,
  decodeChannelRoutine,
  decodeChannelRoutineRun,
  decodeChannelRoutineRuns,
  decodeChannelRoutines,
  decodeChannelSummaries,
  isAttachmentSummary,
  type OpenBotDesktopApi,
  type RespondToBrowserSecretInput,
  type RespondToBrowserTakeoverInput,
} from "@openbot/contracts/ipc";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { CHANNEL_ROUTES } from "@openbot/contracts/team-protocol/channels-v1";
import { decodeTeamProtocolV2Json, type TeamProtocolV2Json } from "@openbot/contracts/team-protocol/v2";
import type { RemoteFileUpload } from "./file-upload";

/** One request to the selected host. It rejects when the host fails or `decode` rejects the body. */
export type TeamApiRequest = <T>(
  method: string,
  path: string,
  decode: (value: unknown) => T,
  body?: TeamProtocolV2Json,
  upload?: RemoteFileUpload,
) => Promise<T>;

function ignoreResponse(): void {}

function decodeAttachment(value: unknown): AttachmentSummary {
  if (!isAttachmentSummary(value)) throw new Error("The host returned an invalid attachment.");
  return value;
}

/** Sends a file as an attachment draft. The host keeps it until a message uses it or it is discarded. */
export function uploadAttachmentDraft(request: TeamApiRequest, upload: RemoteFileUpload): Promise<AttachmentSummary> {
  const query = new URLSearchParams({ name: upload.name, mime: upload.mimeType });
  return request("POST", `${TEAM_API_ROUTES.attachments}?${query}`, decodeAttachment, undefined, upload);
}

export function discardAttachmentDraft(request: TeamApiRequest, attachmentId: string): Promise<void> {
  return request("DELETE", TEAM_API_ROUTES.attachment(attachmentId), ignoreResponse);
}

export function interruptAgentTurn(request: TeamApiRequest, agentId: string, turnId: string): Promise<void> {
  return request("POST", TEAM_API_ROUTES.agent.interrupt(agentId), ignoreResponse, { turnId });
}

export function deleteAgent(request: TeamApiRequest, agentId: string): Promise<void> {
  return request("DELETE", TEAM_API_ROUTES.agent.one(agentId), ignoreResponse);
}

export function respondToBrowserTakeover(request: TeamApiRequest, input: RespondToBrowserTakeoverInput): Promise<void> {
  return request("POST", TEAM_API_ROUTES.respond.browserTakeover, ignoreResponse, { ...input });
}

export function respondToBrowserSecret(request: TeamApiRequest, input: RespondToBrowserSecretInput): Promise<void> {
  return request("POST", BROWSER_SECRET_RESPONSE_PATH, ignoreResponse, { ...input });
}

/** The channel calls of the desktop IPC surface, which a remote desktop sends to the host the same way. */
export type TeamChannelsApi = Pick<
  OpenBotDesktopApi["agent"],
  | "listChannels"
  | "readChannel"
  | "channelCommand"
  | "listChannelMemories"
  | "createChannelMemory"
  | "updateChannelMemory"
  | "deleteChannelMemory"
  | "clearChannelMemories"
  | "listChannelRoutines"
  | "createChannelRoutine"
  | "updateChannelRoutine"
  | "deleteChannelRoutine"
  | "testChannelRoutine"
  | "listChannelRoutineRuns"
>;

/** Every channel route is a POST with the channel in the body, except the list. */
export function teamChannelsApi(request: TeamApiRequest): TeamChannelsApi {
  const post = <T>(path: string, decode: (value: unknown) => T, body: unknown) =>
    request("POST", path, decode, decodeTeamProtocolV2Json(body));
  return {
    listChannels: () => request("GET", CHANNEL_ROUTES.list, decodeChannelSummaries),
    readChannel: (input) => post(CHANNEL_ROUTES.read, decodeChannelPage, input),
    channelCommand: (command) => post(CHANNEL_ROUTES.command, decodeChannel, command),
    listChannelMemories: (channelId) => post(CHANNEL_ROUTES.memories, decodeChannelMemories, { channelId }),
    createChannelMemory: (input) => post(CHANNEL_ROUTES.memoryCreate, decodeChannelMemory, input),
    updateChannelMemory: (input) => post(CHANNEL_ROUTES.memoryUpdate, decodeChannelMemory, input),
    deleteChannelMemory: (input) => post(CHANNEL_ROUTES.memoryDelete, ignoreResponse, input),
    clearChannelMemories: (channelId) => post(CHANNEL_ROUTES.memoryClear, ignoreResponse, { channelId }),
    listChannelRoutines: (channelId) => post(CHANNEL_ROUTES.routines, decodeChannelRoutines, { channelId }),
    createChannelRoutine: (input) => post(CHANNEL_ROUTES.routineCreate, decodeChannelRoutine, input),
    updateChannelRoutine: (input) => post(CHANNEL_ROUTES.routineUpdate, decodeChannelRoutine, input),
    deleteChannelRoutine: (input) => post(CHANNEL_ROUTES.routineDelete, ignoreResponse, input),
    testChannelRoutine: (input) => post(CHANNEL_ROUTES.routineTest, decodeChannelRoutineRun, input),
    listChannelRoutineRuns: (input) => post(CHANNEL_ROUTES.routineRuns, decodeChannelRoutineRuns, input),
  };
}
