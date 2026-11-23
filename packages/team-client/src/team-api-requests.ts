import { sha256 } from "@noble/hashes/sha2.js";
import type { FeedbackPhone } from "@openbot/contracts/feedback";
import {
  type AgentApproval,
  type AgentImportPreview,
  type AgentMemory,
  type AgentMemorySelectionState,
  type AgentTask,
  type AgentTaskInput,
  type AgentTaskPage,
  type AgentTaskReadState,
  type AgentTasksSnapshot,
  type AgentTaskWindow,
  type ApplyAgentImportInput,
  type ApplyInstanceTransferInput,
  type ArchivedAgentTasksPage,
  type AttachmentSummary,
  BROWSER_SECRET_RESPONSE_PATH,
  type BranchAgentTaskInput,
  type CancelQueuedMessageInput,
  type ConversationSnapshot,
  decodeChannel,
  decodeChannelMemories,
  decodeChannelMemory,
  decodeChannelPage,
  decodeChannelRoutine,
  decodeChannelRoutineRun,
  decodeChannelRoutineRuns,
  decodeChannelRoutines,
  decodeChannelSummaries,
  decodeInstalledSkills,
  decodeRemoteAgentImportPreview,
  decodeRemoteAgentImportResult,
  decodeRemoteInstanceTransferPreview,
  decodeRemoteInstanceTransferResult,
  decodeRemoteInstanceTransferSummary,
  type ExportInstanceInput,
  INSTANCE_TRANSFER_LIMITS,
  type InstalledSkill,
  type InstanceTransferPreview,
  type InstanceTransferSummary,
  isAgentMemory,
  isAgentMemorySelectionState,
  isAgentTask,
  isAgentTaskPage,
  isAgentTaskReadState,
  isAgentTasksSnapshot,
  isAgentTaskWindow,
  isArchivedAgentTasksPage,
  isAttachmentSummary,
  isConversationSnapshot,
  isQueuedMessageReceipt,
  isRoutine,
  isRoutinePausedByRun,
  isRoutineRun,
  type ListArchivedAgentTasksInput,
  type LocalBrowserSecretResponse,
  type MarkAgentTaskReadInput,
  type OpenBotDesktopApi,
  type PinnedMessagesSnapshot,
  type QueuedMessageReceipt,
  type ReadAgentTaskAroundInput,
  type ReadAgentTaskPageInput,
  type RemoteAgentImportResult,
  type RemoteInstanceTransferResult,
  type RenameAgentTaskInput,
  type ReorderQueueInput,
  type RespondToApprovalInput,
  type RespondToBrowserTakeoverInput,
  type Routine,
  type RoutineRunPlace,
  remoteBrowserSecretResponse,
  type SetAgentMemoryInclusionInput,
  type SetMessagePinnedInput,
  type StartAgentTaskInput,
  type SteerQueuedMessageInput,
  type UpdateQueuedMessageInput,
} from "@openbot/contracts/ipc";
import { guardedDecoder, guardedListDecoder } from "@openbot/contracts/ipc-decoding";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { AGENT_ARCHIVED_THREADS_ROUTES } from "@openbot/contracts/team-protocol/agent-archived-threads-v1";
import { AGENT_IMPORT_ROUTES, AGENT_IMPORT_UPLOAD_BYTES } from "@openbot/contracts/team-protocol/agent-import-v1";
import {
  AGENT_IMPORT_V2_CHUNK_BYTES,
  AGENT_IMPORT_V2_ROUTES,
  agentImportV2ChunkPath,
} from "@openbot/contracts/team-protocol/agent-import-v2";
import {
  AGENT_MEMORIES_PAGE_ROUTE,
  AGENT_MEMORIES_PAGE_SIZE,
  AGENT_MEMORY_INCLUSION_ROUTE,
  AGENT_MEMORY_SELECTION_PAGE_ROUTE,
} from "@openbot/contracts/team-protocol/agent-memories-v1";
import { AGENT_QUEUE_TASK_ROUTES } from "@openbot/contracts/team-protocol/agent-queue-task-v1";
import { AGENT_TASKS_ROUTES } from "@openbot/contracts/team-protocol/agent-tasks-v1";
import {
  AGENT_THREAD_BRANCHES_ROUTES,
  type AgentThreadBranchLink,
  isAgentThreadBranchLinks,
} from "@openbot/contracts/team-protocol/agent-thread-branches-v1";
import { AGENT_THREAD_FILES_ROUTES } from "@openbot/contracts/team-protocol/agent-thread-files-v1";
import { AGENT_THREAD_PAGES_ROUTES } from "@openbot/contracts/team-protocol/agent-thread-pages-v1";
import { AGENT_THREAD_READS_ROUTES } from "@openbot/contracts/team-protocol/agent-thread-reads-v1";
import { AGENT_THREAD_REPLIES_ROUTES } from "@openbot/contracts/team-protocol/agent-thread-replies-v1";
import { AGENT_THREADS_ROUTES } from "@openbot/contracts/team-protocol/agent-threads-v1";
import { BROWSER_SECRET_VAULT_ROUTES } from "@openbot/contracts/team-protocol/browser-secret-vault-v1";
import { CHANNEL_ROUTES } from "@openbot/contracts/team-protocol/channels-v1";
import { CONTEXT_RESET_ROUTES } from "@openbot/contracts/team-protocol/context-reset-v1";
import {
  INSTANCE_TRANSFER_CHUNK_BYTES,
  INSTANCE_TRANSFER_CHUNKS_ROUTES,
} from "@openbot/contracts/team-protocol/instance-transfer-chunks-v1";
import { INSTANCE_TRANSFER_FULL_COPY_ROUTES } from "@openbot/contracts/team-protocol/instance-transfer-full-copy-v1";
import {
  INSTANCE_TRANSFER_REMOTE_BYTES,
  INSTANCE_TRANSFER_ROUTES,
} from "@openbot/contracts/team-protocol/instance-transfer-v1";
import {
  decodeLiveVoiceSessionResponse,
  LIVE_VOICE_ROUTES,
  type LiveVoiceSessionResponse,
  type LiveVoiceStartRequest,
} from "@openbot/contracts/team-protocol/live-voice-v1";
import { decodeMessagePinsResponse, MESSAGE_PINS_ROUTES } from "@openbot/contracts/team-protocol/message-pins-v1";
import {
  decodePendingApprovalResponse,
  PENDING_APPROVAL_ROUTES,
} from "@openbot/contracts/team-protocol/pending-approval-v1";
import { PHONE_FEEDBACK_ROUTES } from "@openbot/contracts/team-protocol/phone-feedback-v1";
import {
  decodeRoutinePauseReasons,
  ROUTINE_PAUSE_REASONS_ROUTES,
  type RoutinePauseReasonEntry,
} from "@openbot/contracts/team-protocol/routine-pause-reasons-v1";
import {
  decodeRoutineRunPlace,
  decodeRoutineRunPlaces,
  ROUTINE_RUN_PLACE_ROUTES,
  type RoutineRunPlaceEntry,
} from "@openbot/contracts/team-protocol/routine-run-place-v1";
import { decodeTeamProtocolV2Json, type TeamProtocolV2Json } from "@openbot/contracts/team-protocol/v2";
import { Effect, Schema } from "effect";
import { base64ToBytes, bytesToBase64 } from "./base64";
import type { RemoteFileUpload } from "./file-upload";
import { copyTransfer } from "./instance-transfer-copy";
import {
  createOnceAgentRoutine,
  createOnceChannelRoutine,
  isOnceSchedule,
  listOnceAgentRoutines,
  listOnceChannelRoutines,
  type RoutinesOncePost,
  requireReleasedScheduleOn,
  updateAgentRoutineOnce,
  updateChannelRoutineOnce,
} from "./routines-once";

export class TeamRequestError extends Schema.TaggedError<TeamRequestError>()("TeamRequestError", {
  cause: Schema.Defect(),
}) {}

export type TeamApiRequest = <T>(
  method: string,
  path: string,
  decode: (value: unknown) => T,
  body?: TeamProtocolV2Json,
  upload?: RemoteFileUpload,
) => Promise<T>;

const teamCall = <A>(operation: () => Promise<A>) =>
  Effect.tryPromise({
    try: operation,
    catch: (cause) => new TeamRequestError({ cause }),
  });

function ignoreResponse(): void {}

function decodeAttachment(value: unknown): AttachmentSummary {
  if (!isAttachmentSummary(value)) throw new Error("The host returned an invalid attachment.");
  return value;
}

export const uploadAttachmentDraft = Effect.fn("TeamClient.uploadAttachmentDraft")(function* (
  request: TeamApiRequest,
  upload: RemoteFileUpload,
): Effect.fn.Return<AttachmentSummary, TeamRequestError> {
  const query = new URLSearchParams({ name: upload.name, mime: upload.mimeType });
  return yield* teamCall(() =>
    request("POST", `${TEAM_API_ROUTES.attachments}?${query}`, decodeAttachment, undefined, upload),
  );
});

export const discardAttachmentDraft = Effect.fn("TeamClient.discardAttachmentDraft")(function* (
  request: TeamApiRequest,
  attachmentId: string,
): Effect.fn.Return<void, TeamRequestError> {
  return yield* teamCall(() => request("DELETE", TEAM_API_ROUTES.attachment(attachmentId), ignoreResponse));
});

export const interruptAgentTurn = Effect.fn("TeamClient.interruptAgentTurn")(function* (
  request: TeamApiRequest,
  agentId: string,
  turnId: string,
): Effect.fn.Return<void, TeamRequestError> {
  return yield* teamCall(() => request("POST", TEAM_API_ROUTES.agent.interrupt(agentId), ignoreResponse, { turnId }));
});

export const cancelQueuedMessage = Effect.fn("TeamClient.cancelQueuedMessage")(function* (
  request: TeamApiRequest,
  { agentId, deliveryId }: CancelQueuedMessageInput,
): Effect.fn.Return<void, TeamRequestError> {
  return yield* teamCall(() =>
    request("POST", TEAM_API_ROUTES.agent.queueCancel(agentId), ignoreResponse, { deliveryId }),
  );
});

export const steerQueuedMessage = Effect.fn("TeamClient.steerQueuedMessage")(function* (
  request: TeamApiRequest,
  { agentId, deliveryId, expectedTurnId }: SteerQueuedMessageInput,
): Effect.fn.Return<void, TeamRequestError> {
  return yield* teamCall(() =>
    request("POST", TEAM_API_ROUTES.agent.queueSteer(agentId), ignoreResponse, { deliveryId, expectedTurnId }),
  );
});

export const updateQueuedMessage = Effect.fn("TeamClient.updateQueuedMessage")(function* (
  request: TeamApiRequest,
  { agentId, ...update }: UpdateQueuedMessageInput,
): Effect.fn.Return<void, TeamRequestError> {
  return yield* teamCall(() => request("POST", TEAM_API_ROUTES.agent.queueUpdate(agentId), ignoreResponse, update));
});

export const reorderQueue = Effect.fn("TeamClient.reorderQueue")(function* (
  request: TeamApiRequest,
  { agentId, deliveryIds }: ReorderQueueInput,
): Effect.fn.Return<void, TeamRequestError> {
  return yield* teamCall(() =>
    request("POST", TEAM_API_ROUTES.agent.queueReorder(agentId), ignoreResponse, { deliveryIds }),
  );
});

export const clearAgentContext = Effect.fn("TeamClient.clearAgentContext")(function* (
  request: TeamApiRequest,
  agentId: string,
): Effect.fn.Return<void, TeamRequestError> {
  return yield* teamCall(() => request("POST", CONTEXT_RESET_ROUTES.clear, ignoreResponse, { agentId }));
});

export const startLiveVoice = Effect.fn("TeamClient.startLiveVoice")(function* (
  request: TeamApiRequest,
  input: LiveVoiceStartRequest,
): Effect.fn.Return<LiveVoiceSessionResponse, TeamRequestError> {
  return yield* teamCall(() => request("POST", LIVE_VOICE_ROUTES.start, decodeLiveVoiceSessionResponse, { ...input }));
});

export const stopLiveVoice = Effect.fn("TeamClient.stopLiveVoice")(function* (
  request: TeamApiRequest,
  sessionId: string,
): Effect.fn.Return<void, TeamRequestError> {
  return yield* teamCall(() => request("POST", LIVE_VOICE_ROUTES.stop, ignoreResponse, { sessionId }));
});

const decodeAgentTasks = guardedDecoder(isAgentTasksSnapshot, "agent tasks response");
const decodeAgentTask = guardedDecoder(isAgentTask, "agent task response");
const decodeTaskConversation = guardedDecoder(isConversationSnapshot, "task conversation response");
const decodeTaskPage = guardedDecoder(isAgentTaskPage, "thread page response");
const decodeTaskWindow = guardedDecoder(isAgentTaskWindow, "thread part response");
const decodeTaskReceipt = guardedDecoder(isQueuedMessageReceipt, "task message receipt");
const decodeArchivedTasks = guardedDecoder(isArchivedAgentTasksPage, "archived threads response");

export const listAgentTasks = Effect.fn("TeamClient.listAgentTasks")(function* (
  request: TeamApiRequest,
  agentId: string,
): Effect.fn.Return<AgentTasksSnapshot, TeamRequestError> {
  return yield* teamCall(() => request("POST", AGENT_TASKS_ROUTES.list, decodeAgentTasks, { agentId }));
});

export const listArchivedAgentTasks = Effect.fn("TeamClient.listArchivedAgentTasks")(function* (
  request: TeamApiRequest,
  { agentId, before }: ListArchivedAgentTasksInput,
): Effect.fn.Return<ArchivedAgentTasksPage, TeamRequestError> {
  return yield* teamCall(() =>
    request("POST", AGENT_ARCHIVED_THREADS_ROUTES.list, decodeArchivedTasks, {
      agentId,
      before: before ? { updatedAt: before.updatedAt, threadId: before.threadId } : null,
    }),
  );
});

export const readAgentTask = Effect.fn("TeamClient.readAgentTask")(function* (
  request: TeamApiRequest,
  { agentId, taskId }: AgentTaskInput,
): Effect.fn.Return<ConversationSnapshot, TeamRequestError> {
  return yield* teamCall(() => request("POST", AGENT_TASKS_ROUTES.read, decodeTaskConversation, { agentId, taskId }));
});

export const readAgentThreadPage = Effect.fn("TeamClient.readAgentThreadPage")(function* (
  request: TeamApiRequest,
  { agentId, taskId, beforeMessageId, limit }: ReadAgentTaskPageInput,
): Effect.fn.Return<AgentTaskPage, TeamRequestError> {
  return yield* teamCall(() =>
    request("POST", AGENT_THREAD_PAGES_ROUTES.readOlder, decodeTaskPage, { agentId, taskId, beforeMessageId, limit }),
  );
});

export const readAgentThreadAround = Effect.fn("TeamClient.readAgentThreadAround")(function* (
  request: TeamApiRequest,
  { agentId, taskId, messageId, limit }: ReadAgentTaskAroundInput,
): Effect.fn.Return<AgentTaskWindow, TeamRequestError> {
  return yield* teamCall(() =>
    request("POST", MESSAGE_PINS_ROUTES.readThread, decodeTaskWindow, { agentId, taskId, messageId, limit }),
  );
});

export const listMessagePins = Effect.fn("TeamClient.listMessagePins")(function* (
  request: TeamApiRequest,
  agentId: string,
): Effect.fn.Return<PinnedMessagesSnapshot, TeamRequestError> {
  return yield* teamCall(() => request("POST", MESSAGE_PINS_ROUTES.list, decodeMessagePinsResponse, { agentId }));
});

export const setMessagePinned = Effect.fn("TeamClient.setMessagePinned")(function* (
  request: TeamApiRequest,
  { agentId, taskId, messageId, pinned }: SetMessagePinnedInput,
): Effect.fn.Return<PinnedMessagesSnapshot, TeamRequestError> {
  return yield* teamCall(() =>
    request("POST", MESSAGE_PINS_ROUTES.set, decodeMessagePinsResponse, {
      agentId,
      taskId: taskId ?? null,
      messageId,
      pinned,
    }),
  );
});

export const startAgentTask = Effect.fn("TeamClient.startAgentTask")(function* (
  request: TeamApiRequest,
  { agentId, text, attachmentDraftIds, clientMessageId }: StartAgentTaskInput,
): Effect.fn.Return<AgentTask, TeamRequestError> {
  return yield* teamCall(() =>
    attachmentDraftIds?.length
      ? request("POST", AGENT_THREAD_FILES_ROUTES.start, decodeAgentTask, {
          agentId,
          text,
          attachmentDraftIds,
          ...(clientMessageId === undefined ? {} : { clientMessageId }),
        })
      : request("POST", AGENT_TASKS_ROUTES.start, decodeAgentTask, {
          agentId,
          text,
          ...(clientMessageId === undefined ? {} : { clientMessageId }),
        }),
  );
});

export const runQueuedMessageAsAgentTask = Effect.fn("TeamClient.runQueuedMessageAsAgentTask")(function* (
  request: TeamApiRequest,
  { agentId, deliveryId }: { agentId: string; deliveryId: string },
): Effect.fn.Return<AgentTask, TeamRequestError> {
  return yield* teamCall(() => request("POST", AGENT_QUEUE_TASK_ROUTES.run, decodeAgentTask, { agentId, deliveryId }));
});

export const sendAgentTaskMessage = Effect.fn("TeamClient.sendAgentTaskMessage")(function* (
  request: TeamApiRequest,
  {
    agentId,
    taskId,
    text,
    attachmentDraftIds,
    replyToMessageId,
    clientMessageId,
  }: AgentTaskInput & {
    text: string;
    attachmentDraftIds?: string[];
    replyToMessageId?: string;
    clientMessageId?: string;
  },
): Effect.fn.Return<QueuedMessageReceipt, TeamRequestError> {
  return yield* teamCall(() =>
    replyToMessageId
      ? request("POST", AGENT_THREAD_REPLIES_ROUTES.send, decodeTaskReceipt, {
          agentId,
          taskId,
          text,
          attachmentDraftIds: attachmentDraftIds ?? [],
          replyToMessageId,
          ...(clientMessageId === undefined ? {} : { clientMessageId }),
        })
      : attachmentDraftIds?.length
        ? request("POST", AGENT_THREAD_FILES_ROUTES.send, decodeTaskReceipt, {
            agentId,
            taskId,
            text,
            attachmentDraftIds,
            ...(clientMessageId === undefined ? {} : { clientMessageId }),
          })
        : request("POST", AGENT_TASKS_ROUTES.send, decodeTaskReceipt, {
            agentId,
            taskId,
            text,
            ...(clientMessageId === undefined ? {} : { clientMessageId }),
          }),
  );
});

export const agentTaskControl = Effect.fn("TeamClient.agentTaskControl")(function* (
  request: TeamApiRequest,
  action: "stop" | "close" | "reopen",
  { agentId, taskId }: AgentTaskInput,
): Effect.fn.Return<void, TeamRequestError> {
  return yield* teamCall(() => request("POST", AGENT_TASKS_ROUTES[action], ignoreResponse, { agentId, taskId }));
});

export const renameAgentThread = Effect.fn("TeamClient.renameAgentThread")(function* (
  request: TeamApiRequest,
  { agentId, taskId, title }: RenameAgentTaskInput,
): Effect.fn.Return<void, TeamRequestError> {
  return yield* teamCall(() =>
    request("POST", AGENT_THREADS_ROUTES.rename, ignoreResponse, { agentId, taskId, title }),
  );
});

export const deleteAgentThread = Effect.fn("TeamClient.deleteAgentThread")(function* (
  request: TeamApiRequest,
  { agentId, taskId }: AgentTaskInput,
): Effect.fn.Return<void, TeamRequestError> {
  return yield* teamCall(() => request("POST", AGENT_THREADS_ROUTES.delete, ignoreResponse, { agentId, taskId }));
});

const decodeThreadReadState = guardedDecoder(isAgentTaskReadState, "thread read state");
const decodeThreadReads = guardedDecoder(
  (value: unknown): value is { reads: AgentTaskReadState[] } =>
    isDynamicRecord(value) && Array.isArray(value.reads) && value.reads.every(isAgentTaskReadState),
  "thread read states",
);

export const listAgentThreadReads = Effect.fn("TeamClient.listAgentThreadReads")(function* (
  request: TeamApiRequest,
  agentId: string,
): Effect.fn.Return<AgentTaskReadState[], TeamRequestError> {
  const answer = yield* teamCall(() => request("POST", AGENT_THREAD_READS_ROUTES.list, decodeThreadReads, { agentId }));
  return answer.reads;
});

export const markAgentThreadRead = Effect.fn("TeamClient.markAgentThreadRead")(function* (
  request: TeamApiRequest,
  { agentId, taskId, throughMessageId }: MarkAgentTaskReadInput,
): Effect.fn.Return<AgentTaskReadState, TeamRequestError> {
  return yield* teamCall(() =>
    request("POST", AGENT_THREAD_READS_ROUTES.mark, decodeThreadReadState, { agentId, taskId, throughMessageId }),
  );
});

const decodeThreadBranches = guardedDecoder(isAgentThreadBranchLinks, "thread branches");

export const branchAgentThread = Effect.fn("TeamClient.branchAgentThread")(function* (
  request: TeamApiRequest,
  { agentId, taskId, messageId, requestId }: BranchAgentTaskInput,
): Effect.fn.Return<AgentTask, TeamRequestError> {
  return yield* teamCall(() =>
    request("POST", AGENT_THREAD_BRANCHES_ROUTES.branch, decodeAgentTask, { agentId, taskId, messageId, requestId }),
  );
});

export const listAgentThreadBranches = Effect.fn("TeamClient.listAgentThreadBranches")(function* (
  request: TeamApiRequest,
  agentId: string,
): Effect.fn.Return<AgentThreadBranchLink[], TeamRequestError> {
  const answer = yield* teamCall(() =>
    request("POST", AGENT_THREAD_BRANCHES_ROUTES.list, decodeThreadBranches, { agentId }),
  );
  return answer.branches;
});

export const stageAgentImport = Effect.fn("TeamClient.stageAgentImport")(function* (
  request: TeamApiRequest,
  upload: RemoteFileUpload,
): Effect.fn.Return<AgentImportPreview, TeamRequestError> {
  return yield* teamCall(() =>
    request("POST", AGENT_IMPORT_ROUTES.stage, decodeRemoteAgentImportPreview, undefined, {
      ...upload,
      maxBytes: AGENT_IMPORT_UPLOAD_BYTES,
    }),
  );
});

function decodeUploadId(value: unknown): string {
  if (!isDynamicRecord(value) || !isString(value.uploadId)) throw new Error("The host returned an invalid upload.");
  return value.uploadId;
}

export interface AgentExportParts {
  name: string;
  size: number;
  readPart: (offset: number, length: number) => Promise<string>;
}

export const stageAgentImportInParts = Effect.fn("TeamClient.stageAgentImportInParts")(function* (
  request: TeamApiRequest,
  file: AgentExportParts,
): Effect.fn.Return<AgentImportPreview, TeamRequestError> {
  const uploadId = yield* teamCall(() =>
    request("POST", AGENT_IMPORT_V2_ROUTES.open, decodeUploadId, { size: file.size }),
  );
  for (let offset = 0; offset < file.size; ) {
    const length = Math.min(AGENT_IMPORT_V2_CHUNK_BYTES, file.size - offset);
    const base64 = yield* teamCall(() => file.readPart(offset, length));
    const upload = { name: file.name, mimeType: "application/zip", base64, maxBytes: AGENT_IMPORT_V2_CHUNK_BYTES };
    yield* teamCall(() => request("POST", agentImportV2ChunkPath(uploadId, offset), ignoreResponse, undefined, upload));
    offset += length;
  }
  return yield* teamCall(() =>
    request("POST", AGENT_IMPORT_V2_ROUTES.stage, decodeRemoteAgentImportPreview, { uploadId }),
  );
});

export const applyAgentImport = Effect.fn("TeamClient.applyAgentImport")(function* (
  request: TeamApiRequest,
  input: ApplyAgentImportInput,
  timezone: string,
): Effect.fn.Return<RemoteAgentImportResult, TeamRequestError> {
  return yield* teamCall(() =>
    request("POST", AGENT_IMPORT_ROUTES.apply, decodeRemoteAgentImportResult, { ...input, timezone }),
  );
});

export const discardAgentImport = Effect.fn("TeamClient.discardAgentImport")(function* (
  request: TeamApiRequest,
  token: string,
): Effect.fn.Return<void, TeamRequestError> {
  return yield* teamCall(() => request("POST", AGENT_IMPORT_ROUTES.discard, ignoreResponse, { token }));
});

export const loadInstanceTransferSummary = Effect.fn("TeamClient.loadInstanceTransferSummary")(function* (
  request: TeamApiRequest,
): Effect.fn.Return<InstanceTransferSummary, TeamRequestError> {
  return yield* teamCall(() =>
    request("POST", INSTANCE_TRANSFER_ROUTES.summary, decodeRemoteInstanceTransferSummary, {}),
  );
});

const decodeTransferFile = guardedDecoder(
  (value: unknown): value is RemoteFileUpload =>
    isDynamicRecord(value) && isString(value.name) && isString(value.mimeType) && isString(value.base64),
  "transfer file",
);

export const downloadInstanceTransfer = Effect.fn("TeamClient.downloadInstanceTransfer")(function* (
  request: TeamApiRequest,
  input: ExportInstanceInput,
): Effect.fn.Return<RemoteFileUpload, TeamRequestError> {
  return yield* teamCall(() =>
    request("POST", INSTANCE_TRANSFER_ROUTES.export, decodeTransferFile, {
      agentIds: input.agentIds,
      includeFiles: input.includeFiles,
      includeSettings: input.includeSettings,
    }),
  );
});

export function copiedTransferUpload(upload: RemoteFileUpload): RemoteFileUpload | null {
  const { base64 } = upload;
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  const read = (offset: number, length: number) => {
    const first = Math.floor(offset / 3);
    const bytes = base64ToBytes(base64.slice(first * 4, Math.ceil((offset + length) / 3) * 4));
    return bytes.subarray(offset - first * 3, offset - first * 3 + length);
  };
  const copy = copyTransfer({ size: Math.floor((base64.length * 3) / 4) - padding, read });
  if (!copy) return null;
  const kept = Math.floor(copy.offset / 3);
  const rest = read(kept * 3, copy.offset - kept * 3);
  const changed = new Uint8Array(rest.length + copy.tail.length);
  changed.set(rest);
  changed.set(copy.tail, rest.length);
  return { ...upload, base64: base64.slice(0, kept * 4) + bytesToBase64(changed) };
}

export interface InstanceTransferExportState {
  exportId: string;
  size: number;
  sha256: string;
  chunkBytes: number;
  chunks: string[];
  warnings: string[];
}

const SHA256 = /^[0-9a-f]{64}$/u;

const isPartBytes = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= INSTANCE_TRANSFER_REMOTE_BYTES;

export function fullCopyExportBody(input: ExportInstanceInput) {
  const includeHistory = input.includeHistory === true;
  return {
    agentIds: input.agentIds,
    includeFiles: input.includeFiles,
    includeSettings: input.includeSettings,
    includeHistory,
    includeChannelMessages: input.includeChannelMessages ?? includeHistory,
    includeServerPreferences: input.includeServerPreferences === true,
  };
}

export function decodeInstanceTransferExportState(value: unknown): InstanceTransferExportState {
  if (
    !isDynamicRecord(value) ||
    !isString(value.exportId) ||
    typeof value.size !== "number" ||
    !Number.isSafeInteger(value.size) ||
    value.size <= 0 ||
    value.size > INSTANCE_TRANSFER_LIMITS.archiveBytes ||
    !isString(value.sha256) ||
    !SHA256.test(value.sha256) ||
    !isPartBytes(value.chunkBytes) ||
    !Array.isArray(value.chunks) ||
    value.chunks.length !== Math.ceil(value.size / value.chunkBytes) ||
    !value.chunks.every((chunk) => isString(chunk) && SHA256.test(chunk)) ||
    !Array.isArray(value.warnings) ||
    !value.warnings.every(isString)
  )
    throw new Error("The host returned an invalid transfer export.");
  return {
    exportId: value.exportId,
    size: value.size,
    sha256: value.sha256,
    chunkBytes: value.chunkBytes,
    chunks: value.chunks,
    warnings: value.warnings,
  };
}

export const beginInstanceTransferFullCopy = Effect.fn("TeamClient.beginInstanceTransferFullCopy")(function* (
  request: TeamApiRequest,
  input: ExportInstanceInput,
): Effect.fn.Return<InstanceTransferExportState, TeamRequestError> {
  return yield* teamCall(() =>
    request("POST", INSTANCE_TRANSFER_FULL_COPY_ROUTES.exportBegin, decodeInstanceTransferExportState, {
      ...fullCopyExportBody(input),
    }),
  );
});

export const readInstanceTransferExportPart = Effect.fn("TeamClient.readInstanceTransferExportPart")(function* (
  request: TeamApiRequest,
  part: { exportId: string; index: number },
): Effect.fn.Return<RemoteFileUpload, TeamRequestError> {
  return yield* teamCall(() => request("POST", INSTANCE_TRANSFER_CHUNKS_ROUTES.exportChunk, decodeTransferFile, part));
});

export const finishInstanceTransferExport = Effect.fn("TeamClient.finishInstanceTransferExport")(function* (
  request: TeamApiRequest,
  exportId: string,
): Effect.fn.Return<void, TeamRequestError> {
  yield* teamCall(() => request("POST", INSTANCE_TRANSFER_CHUNKS_ROUTES.exportDone, ignoreResponse, { exportId }));
});

export interface TransferFileParts {
  name: string;
  size: number;
  readBytes(offset: number, length: number): Promise<Uint8Array>;
}

const decodeUploadState = (value: unknown): { uploadId: string; chunkBytes: number; received: number[] } => {
  if (
    !isDynamicRecord(value) ||
    !isString(value.uploadId) ||
    !isPartBytes(value.chunkBytes) ||
    !Array.isArray(value.received) ||
    !value.received.every((index) => typeof index === "number" && Number.isSafeInteger(index) && index >= 0)
  )
    throw new Error("The host returned an invalid transfer upload.");
  return { uploadId: value.uploadId, chunkBytes: value.chunkBytes, received: value.received };
};

const hex = (bytes: Uint8Array) => [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");

export function sha256Hex(bytes: Uint8Array): string {
  return hex(sha256(bytes));
}

export const stageInstanceTransferInParts = Effect.fn("TeamClient.stageInstanceTransferInParts")(function* (
  request: TeamApiRequest,
  file: TransferFileParts,
  onProgress?: (sent: number, total: number) => void,
): Effect.fn.Return<InstanceTransferPreview, TeamRequestError> {
  const whole = sha256.create();
  for (let offset = 0; offset < file.size; offset += INSTANCE_TRANSFER_CHUNK_BYTES)
    whole.update(
      yield* teamCall(() => file.readBytes(offset, Math.min(INSTANCE_TRANSFER_CHUNK_BYTES, file.size - offset))),
    );
  const upload = yield* teamCall(() =>
    request("POST", INSTANCE_TRANSFER_CHUNKS_ROUTES.uploadBegin, decodeUploadState, {
      size: file.size,
      sha256: hex(whole.digest()),
    }),
  );
  const received = new Set(upload.received);
  const partLength = (index: number) => Math.min(upload.chunkBytes, file.size - index * upload.chunkBytes);
  let sent = 0;
  for (const index of received) if (index * upload.chunkBytes < file.size) sent += partLength(index);
  onProgress?.(sent, file.size);
  for (let index = 0; index * upload.chunkBytes < file.size; index++) {
    if (received.has(index)) continue;
    const offset = index * upload.chunkBytes;
    const bytes = yield* teamCall(() => file.readBytes(offset, partLength(index)));
    const query = new URLSearchParams({ uploadId: upload.uploadId, index: String(index), sha256: sha256Hex(bytes) });
    yield* teamCall(() =>
      request("POST", `${INSTANCE_TRANSFER_CHUNKS_ROUTES.uploadChunk}?${query}`, ignoreResponse, undefined, {
        name: file.name,
        mimeType: "application/octet-stream",
        base64: bytesToBase64(bytes),
        maxBytes: upload.chunkBytes,
      }),
    );
    sent += bytes.length;
    onProgress?.(sent, file.size);
  }
  return yield* teamCall(() =>
    request("POST", INSTANCE_TRANSFER_CHUNKS_ROUTES.uploadFinish, decodeRemoteInstanceTransferPreview, {
      uploadId: upload.uploadId,
    }),
  );
});

export const stageInstanceTransfer = Effect.fn("TeamClient.stageInstanceTransfer")(function* (
  request: TeamApiRequest,
  upload: RemoteFileUpload,
): Effect.fn.Return<InstanceTransferPreview, TeamRequestError> {
  return yield* teamCall(() =>
    request("POST", INSTANCE_TRANSFER_ROUTES.stage, decodeRemoteInstanceTransferPreview, undefined, {
      ...upload,
      maxBytes: INSTANCE_TRANSFER_REMOTE_BYTES,
    }),
  );
});

export const applyInstanceTransferFullCopy = Effect.fn("TeamClient.applyInstanceTransferFullCopy")(function* (
  request: TeamApiRequest,
  input: ApplyInstanceTransferInput,
  timezone: string,
): Effect.fn.Return<RemoteInstanceTransferResult, TeamRequestError> {
  return yield* teamCall(() =>
    request("POST", INSTANCE_TRANSFER_FULL_COPY_ROUTES.apply, decodeRemoteInstanceTransferResult, {
      token: input.token,
      keys: input.keys,
      includeSettings: input.includeSettings,
      includeServerPreferences: input.includeServerPreferences === true,
      timezone,
    }),
  );
});

export const applyInstanceTransfer = Effect.fn("TeamClient.applyInstanceTransfer")(function* (
  request: TeamApiRequest,
  input: ApplyInstanceTransferInput,
  timezone: string,
): Effect.fn.Return<RemoteInstanceTransferResult, TeamRequestError> {
  return yield* teamCall(() =>
    request("POST", INSTANCE_TRANSFER_ROUTES.apply, decodeRemoteInstanceTransferResult, {
      token: input.token,
      keys: input.keys,
      includeSettings: input.includeSettings,
      timezone,
    }),
  );
});

export const discardInstanceTransfer = Effect.fn("TeamClient.discardInstanceTransfer")(function* (
  request: TeamApiRequest,
  token: string,
): Effect.fn.Return<void, TeamRequestError> {
  return yield* teamCall(() => request("POST", INSTANCE_TRANSFER_ROUTES.discard, ignoreResponse, { token }));
});

export const listInstalledSkills = Effect.fn("TeamClient.listInstalledSkills")(function* (
  request: TeamApiRequest,
  agentId: string,
): Effect.fn.Return<InstalledSkill[], TeamRequestError> {
  return yield* teamCall(() => request("GET", TEAM_API_ROUTES.agent.skills(agentId), decodeInstalledSkills));
});

export const deleteAgent = Effect.fn("TeamClient.deleteAgent")(function* (
  request: TeamApiRequest,
  agentId: string,
): Effect.fn.Return<void, TeamRequestError> {
  return yield* teamCall(() => request("DELETE", TEAM_API_ROUTES.agent.one(agentId), ignoreResponse));
});

export const respondToApproval = Effect.fn("TeamClient.respondToApproval")(function* (
  request: TeamApiRequest,
  input: RespondToApprovalInput,
): Effect.fn.Return<void, TeamRequestError> {
  return yield* teamCall(() => request("POST", TEAM_API_ROUTES.respond.approval, ignoreResponse, { ...input }));
});

export const readPendingApproval = Effect.fn("TeamClient.readPendingApproval")(function* (
  request: TeamApiRequest,
  input: { agentId: string; requestId: string | number },
): Effect.fn.Return<AgentApproval, TeamRequestError> {
  return yield* teamCall(() =>
    request("POST", PENDING_APPROVAL_ROUTES.read, decodePendingApprovalResponse, { ...input }),
  );
});

export const sendPhoneFeedback = Effect.fn("TeamClient.sendPhoneFeedback")(function* (
  request: TeamApiRequest,
  input: { requestId: string | number; phone: FeedbackPhone },
): Effect.fn.Return<void, TeamRequestError> {
  return yield* teamCall(() =>
    request("POST", PHONE_FEEDBACK_ROUTES.send, ignoreResponse, {
      requestId: input.requestId,
      phone: { ...input.phone },
    }),
  );
});

export const respondToBrowserTakeover = Effect.fn("TeamClient.respondToBrowserTakeover")(function* (
  request: TeamApiRequest,
  input: RespondToBrowserTakeoverInput,
): Effect.fn.Return<void, TeamRequestError> {
  return yield* teamCall(() => request("POST", TEAM_API_ROUTES.respond.browserTakeover, ignoreResponse, { ...input }));
});

export const respondToBrowserSecret = Effect.fn("TeamClient.respondToBrowserSecret")(function* (
  request: TeamApiRequest,
  input: LocalBrowserSecretResponse,
): Effect.fn.Return<void, TeamRequestError> {
  const path =
    input.decision === "submit" && input.saveToVault
      ? BROWSER_SECRET_VAULT_ROUTES.respond
      : BROWSER_SECRET_RESPONSE_PATH;
  return yield* teamCall(() => request("POST", path, ignoreResponse, { ...remoteBrowserSecretResponse(input) }));
});

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

function withoutHostImage<T extends { imageUrl?: string | null }>(channel: T): T {
  return channel.imageUrl ? { ...channel, imageUrl: null } : channel;
}

export function teamChannelsApi(
  request: TeamApiRequest,
  once: () => boolean = () => false,
  keepHostImage = false,
): TeamChannelsApi {
  const image = <T extends { imageUrl?: string | null }>(channel: T): T =>
    keepHostImage ? channel : withoutHostImage(channel);
  const post = <T>(path: string, decode: (value: unknown) => T, body: unknown) =>
    request("POST", path, decode, decodeTeamProtocolV2Json(body));
  const send: RoutinesOncePost = (path, decode, body) => request("POST", path, decode, body);
  return {
    listChannels: async () => (await request("GET", CHANNEL_ROUTES.list, decodeChannelSummaries)).map(image),
    readChannel: async (input) => {
      const page = await post(CHANNEL_ROUTES.read, decodeChannelPage, input);
      return { ...page, channel: image(page.channel) };
    },
    channelCommand: async (command) => image(await post(CHANNEL_ROUTES.command, decodeChannel, command)),
    listChannelMemories: (channelId) => post(CHANNEL_ROUTES.memories, decodeChannelMemories, { channelId }),
    createChannelMemory: (input) => post(CHANNEL_ROUTES.memoryCreate, decodeChannelMemory, input),
    updateChannelMemory: (input) => post(CHANNEL_ROUTES.memoryUpdate, decodeChannelMemory, input),
    deleteChannelMemory: (input) => post(CHANNEL_ROUTES.memoryDelete, ignoreResponse, input),
    clearChannelMemories: (channelId) => post(CHANNEL_ROUTES.memoryClear, ignoreResponse, { channelId }),
    listChannelRoutines: async (channelId) => {
      const routines = post(CHANNEL_ROUTES.routines, decodeChannelRoutines, { channelId });
      if (!once()) return routines;
      const [released, onceRoutines] = await Promise.all([routines, listOnceChannelRoutines(send, channelId)]);
      return [...released, ...onceRoutines];
    },
    createChannelRoutine: (input) => {
      if (isOnceSchedule(input.schedule)) {
        requireReleasedScheduleOn(input.schedule, once());
        return createOnceChannelRoutine(send, input);
      }
      return post(CHANNEL_ROUTES.routineCreate, decodeChannelRoutine, input);
    },
    updateChannelRoutine: (input) => {
      if (once()) return updateChannelRoutineOnce(send, input);
      requireReleasedScheduleOn(input.schedule, false);
      return post(CHANNEL_ROUTES.routineUpdate, decodeChannelRoutine, input);
    },
    deleteChannelRoutine: (input) => post(CHANNEL_ROUTES.routineDelete, ignoreResponse, input),
    testChannelRoutine: (input) => post(CHANNEL_ROUTES.routineTest, decodeChannelRoutineRun, input),
    listChannelRoutineRuns: (input) => post(CHANNEL_ROUTES.routineRuns, decodeChannelRoutineRuns, input),
  };
}

const decodeRoutine = guardedDecoder(isRoutine, "routine");
const decodeRoutineRun = guardedDecoder(isRoutineRun, "routine run");
const decodeRoutines = guardedListDecoder(isRoutine, "routine list");
const decodeRoutineRuns = guardedListDecoder(isRoutineRun, "routine run list");

export type TeamAgentRoutinesApi = Pick<
  OpenBotDesktopApi["agent"],
  "listRoutines" | "createRoutine" | "updateRoutine" | "deleteRoutine" | "testRoutine" | "listRoutineRuns"
>;

export function withRoutineRunPlaces<R extends { id: string; runIn?: RoutineRunPlace }>(
  routines: readonly R[],
  places: readonly RoutineRunPlaceEntry[],
): R[] {
  const placeOf = new Map(places.map((place) => [place.routineId, place.runIn]));
  return routines.map((routine) => {
    const runIn = placeOf.get(routine.id);
    return runIn ? { ...routine, runIn } : routine;
  });
}

export function withRoutinePauseReasons<R extends { id: string; active: boolean }>(
  routines: readonly R[],
  reasons: readonly RoutinePauseReasonEntry[],
): R[] {
  if (reasons.length === 0) return [...routines];
  const reasonOf = new Map(reasons.map((reason) => [reason.routineId, reason.scheduledFor]));
  return routines.map((routine) => {
    const pausedByRun = routine.active ? undefined : { scheduledFor: reasonOf.get(routine.id) };
    return isRoutinePausedByRun(pausedByRun) ? { ...routine, pausedByRun } : routine;
  });
}

export function listRoutinePauseReasons(request: TeamApiRequest, agentId: string): Promise<RoutinePauseReasonEntry[]> {
  return request("POST", ROUTINE_PAUSE_REASONS_ROUTES.list, decodeRoutinePauseReasons, { agentId });
}

export function teamAgentRoutinesApi(
  request: TeamApiRequest,
  runPlaces: () => boolean = () => false,
  once: () => boolean = () => false,
  pauseReasons: () => boolean = () => false,
): TeamAgentRoutinesApi {
  const send: RoutinesOncePost = (path, decode, body) => request("POST", path, decode, body);
  const withRunPlace = async (
    routine: Routine,
    runIn: RoutineRunPlace | undefined,
    created = false,
  ): Promise<Routine> => {
    if (!runIn || !runPlaces()) return routine;
    const placed = request("POST", ROUTINE_RUN_PLACE_ROUTES.set, decodeRoutineRunPlace, {
      agentId: routine.agentId,
      routineId: routine.id,
      runIn,
    });
    const place = created ? await placed.catch(() => ({ runIn: "chat" as const })) : await placed;
    return { ...routine, runIn: place.runIn };
  };
  return {
    listRoutines: async (agentId) => {
      const [list, places, reasons, extra] = await Promise.all([
        request("GET", TEAM_API_ROUTES.agent.routines(agentId), decodeRoutines),
        runPlaces()
          ? request("POST", ROUTINE_RUN_PLACE_ROUTES.list, decodeRoutineRunPlaces, { agentId })
          : Promise.resolve([]),
        pauseReasons() ? listRoutinePauseReasons(request, agentId) : Promise.resolve([]),
        once() ? listOnceAgentRoutines(send, agentId) : Promise.resolve([]),
      ]);
      return [...withRoutinePauseReasons(withRoutineRunPlaces(list, places), reasons), ...extra];
    },
    createRoutine: async ({ runIn, ...input }) => {
      if (isOnceSchedule(input.schedule)) {
        requireReleasedScheduleOn(input.schedule, once());
        return createOnceAgentRoutine(send, { ...input, ...(runIn === undefined ? {} : { runIn }) });
      }
      return withRunPlace(
        await request(
          "POST",
          TEAM_API_ROUTES.agent.routines(input.agentId),
          decodeRoutine,
          decodeTeamProtocolV2Json(input),
        ),
        runIn,
        true,
      );
    },
    updateRoutine: async ({ runIn, ...input }) => {
      if (once()) return updateAgentRoutineOnce(send, { ...input, ...(runIn === undefined ? {} : { runIn }) });
      requireReleasedScheduleOn(input.schedule, false);
      return withRunPlace(
        await request(
          "PATCH",
          TEAM_API_ROUTES.agent.routine(input.agentId, input.routineId),
          decodeRoutine,
          decodeTeamProtocolV2Json(input),
        ),
        runIn,
      );
    },
    deleteRoutine: ({ agentId, routineId }) =>
      request("DELETE", TEAM_API_ROUTES.agent.routine(agentId, routineId), ignoreResponse),
    testRoutine: ({ agentId, routineId }) =>
      request("POST", TEAM_API_ROUTES.agent.routineTest(agentId, routineId), decodeRoutineRun),
    listRoutineRuns: ({ agentId, routineId, limit }) =>
      request("GET", `${TEAM_API_ROUTES.agent.routineRuns(agentId, routineId)}?limit=${limit}`, decodeRoutineRuns),
  };
}

export type AgentMemoriesRequest<E> = <T>(
  method: string,
  path: string,
  decode: (value: unknown) => T,
  body?: TeamProtocolV2Json,
) => Effect.Effect<T, E>;

export const readAgentMemories = Effect.fn("TeamClient.readAgentMemories")(function* <E>(
  request: AgentMemoriesRequest<E>,
  agentId: string,
  paged: boolean,
): Effect.fn.Return<AgentMemory[], E> {
  function decodeMemories(value: unknown): AgentMemory[] {
    if (!Array.isArray(value) || !value.every(isAgentMemory) || value.some((memory) => memory.agentId !== agentId))
      throw new Error("The host returned invalid memories.");
    return value;
  }
  if (!paged) return yield* request("GET", TEAM_API_ROUTES.agent.memories(agentId), decodeMemories);
  const memories: AgentMemory[] = [];
  let after: string | null = null;
  do {
    const page: { memories: AgentMemory[]; nextCursor: string | null } = yield* request(
      "POST",
      AGENT_MEMORIES_PAGE_ROUTE,
      (value) => {
        if (!isDynamicRecord(value) || !(value.nextCursor === null || isString(value.nextCursor)))
          throw new Error("The host returned an invalid memory page.");
        const entries = decodeMemories(value.memories);
        if (
          entries.length > AGENT_MEMORIES_PAGE_SIZE ||
          entries.some((entry, index) => {
            const previous = index === 0 ? after : entries[index - 1]?.id;
            return previous !== null && previous !== undefined && entry.id <= previous;
          }) ||
          (value.nextCursor !== null && (entries.length === 0 || value.nextCursor !== entries.at(-1)?.id))
        )
          throw new Error("The host returned an invalid memory cursor.");
        return { memories: entries, nextCursor: value.nextCursor };
      },
      { agentId, after },
    );
    memories.push(...page.memories);
    after = page.nextCursor;
  } while (after !== null);
  return memories.sort((left, right) =>
    left.updatedAt !== right.updatedAt
      ? left.updatedAt > right.updatedAt
        ? -1
        : 1
      : left.id < right.id
        ? -1
        : left.id > right.id
          ? 1
          : 0,
  );
});

export const readAgentMemorySelection = Effect.fn("TeamClient.readAgentMemorySelection")(function* <E>(
  request: AgentMemoriesRequest<E>,
  agentId: string,
  supported: boolean,
): Effect.fn.Return<AgentMemorySelectionState | null, E> {
  if (!supported) return null;
  const state: AgentMemorySelectionState = { selections: [], usedBytes: 0, budgetBytes: 8192 };
  let after: string | null = null;
  do {
    const page: AgentMemorySelectionState & { nextCursor: string | null } = yield* request(
      "POST",
      AGENT_MEMORY_SELECTION_PAGE_ROUTE,
      (value) => {
        if (
          !isDynamicRecord(value) ||
          value.agentId !== agentId ||
          !isAgentMemorySelectionState(value) ||
          !(value.nextCursor === null || isString(value.nextCursor))
        )
          throw new Error("The host returned invalid memory selection.");
        const entries = value.selections;
        if (
          entries.length > AGENT_MEMORIES_PAGE_SIZE ||
          entries.some((entry, index) => {
            const previous = index === 0 ? after : entries[index - 1]?.memoryId;
            return previous !== null && previous !== undefined && entry.memoryId <= previous;
          }) ||
          (value.nextCursor !== null && (entries.length === 0 || value.nextCursor !== entries.at(-1)?.memoryId))
        )
          throw new Error("The host returned an invalid selection cursor.");
        return {
          selections: entries,
          usedBytes: value.usedBytes,
          budgetBytes: value.budgetBytes,
          nextCursor: value.nextCursor,
        };
      },
      { agentId, after },
    );
    state.selections.push(...page.selections);
    state.usedBytes = page.usedBytes;
    state.budgetBytes = page.budgetBytes;
    after = page.nextCursor;
  } while (after !== null);
  return state;
});

export const setAgentMemoryInclusion = Effect.fn("TeamClient.setAgentMemoryInclusion")(function* <E>(
  request: AgentMemoriesRequest<E>,
  input: SetAgentMemoryInclusionInput,
): Effect.fn.Return<AgentMemorySelectionState, E> {
  yield* request("POST", AGENT_MEMORY_INCLUSION_ROUTE, ignoreResponse, {
    agentId: input.agentId,
    changes: input.changes.map(({ memoryId, inclusion, expectedRevision }) => ({
      memoryId,
      inclusion,
      expectedRevision,
    })),
  });
  const state = yield* readAgentMemorySelection(request, input.agentId, true);
  if (state === null) throw new Error("The host returned no memory selection.");
  return state;
});
