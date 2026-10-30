import { Effect, Schema } from "effect";
// Team API requests that the web client and the mobile app send in the same way.
//
// Each client has its own transport and its own error text for most responses, so only the requests
// whose path, body and decoding are the same in both are here. A request that differs in one of them
// stays at its call site.

import {
  type AgentImportPreview,
  type AgentMemory,
  type AgentMemorySelectionState,
  type AgentTask,
  type AgentTaskInput,
  type AgentTaskReadState,
  type AgentTasksSnapshot,
  type ApplyAgentImportInput,
  type AttachmentSummary,
  BROWSER_SECRET_RESPONSE_PATH,
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
  type InstalledSkill,
  isAgentMemory,
  isAgentMemorySelectionState,
  isAgentTask,
  isAgentTaskReadState,
  isAgentTasksSnapshot,
  isAttachmentSummary,
  isConversationSnapshot,
  isQueuedMessageReceipt,
  isRoutine,
  isRoutineFlowCanvas,
  isRoutineFlowLink,
  isRoutineRun,
  type LocalBrowserSecretResponse,
  type MarkAgentTaskReadInput,
  type OpenBotDesktopApi,
  type QueuedMessageReceipt,
  type RemoteAgentImportResult,
  type RenameAgentTaskInput,
  type ReorderQueueInput,
  type RespondToApprovalInput,
  type RespondToBrowserTakeoverInput,
  remoteBrowserSecretResponse,
  type SetAgentMemoryInclusionInput,
  type StartAgentTaskInput,
  type SteerQueuedMessageInput,
  type UpdateQueuedMessageInput,
} from "@openbot/contracts/ipc";
import { guardedDecoder, guardedListDecoder } from "@openbot/contracts/ipc-decoding";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { AGENT_IMPORT_ROUTES, AGENT_IMPORT_UPLOAD_BYTES } from "@openbot/contracts/team-protocol/agent-import-v1";
import {
  AGENT_MEMORIES_PAGE_ROUTE,
  AGENT_MEMORIES_PAGE_SIZE,
  AGENT_MEMORY_INCLUSION_ROUTE,
  AGENT_MEMORY_SELECTION_PAGE_ROUTE,
} from "@openbot/contracts/team-protocol/agent-memories-v1";
import { AGENT_TASKS_ROUTES } from "@openbot/contracts/team-protocol/agent-tasks-v1";
import { AGENT_THREAD_FILES_ROUTES } from "@openbot/contracts/team-protocol/agent-thread-files-v1";
import { AGENT_THREAD_READS_ROUTES } from "@openbot/contracts/team-protocol/agent-thread-reads-v1";
import { AGENT_THREADS_ROUTES } from "@openbot/contracts/team-protocol/agent-threads-v1";
import { BROWSER_SECRET_VAULT_ROUTES } from "@openbot/contracts/team-protocol/browser-secret-vault-v1";
import { CHANNEL_ROUTES } from "@openbot/contracts/team-protocol/channels-v1";
import { CONTEXT_RESET_ROUTES } from "@openbot/contracts/team-protocol/context-reset-v1";
import { ROUTINE_FLOWS_ROUTES } from "@openbot/contracts/team-protocol/routine-flows-v1";
import { decodeTeamProtocolV2Json, type TeamProtocolV2Json } from "@openbot/contracts/team-protocol/v2";
import type { RemoteFileUpload } from "./file-upload";

export class TeamRequestError extends Schema.TaggedError<TeamRequestError>()("TeamRequestError", {
  cause: Schema.Defect(),
}) {}

/** One request to the selected host. It rejects when the host fails or `decode` rejects the body. */
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

/** Sends a file as an attachment draft. The host keeps it until a message uses it or it is discarded. */
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

/** Starts a new chat with the agent. Send it only to a host that serves `context-reset-v1`. */
export const clearAgentContext = Effect.fn("TeamClient.clearAgentContext")(function* (
  request: TeamApiRequest,
  agentId: string,
): Effect.fn.Return<void, TeamRequestError> {
  return yield* teamCall(() => request("POST", CONTEXT_RESET_ROUTES.clear, ignoreResponse, { agentId }));
});

const decodeAgentTasks = guardedDecoder(isAgentTasksSnapshot, "agent tasks response");
const decodeAgentTask = guardedDecoder(isAgentTask, "agent task response");
const decodeTaskConversation = guardedDecoder(isConversationSnapshot, "task conversation response");
const decodeTaskReceipt = guardedDecoder(isQueuedMessageReceipt, "task message receipt");

/**
 * The tasks of one agent. Send them only to a host that serves `agent-tasks-v1`. A start and a
 * message carry text only: the caller refuses attachments before it calls them.
 */
export const listAgentTasks = Effect.fn("TeamClient.listAgentTasks")(function* (
  request: TeamApiRequest,
  agentId: string,
): Effect.fn.Return<AgentTasksSnapshot, TeamRequestError> {
  return yield* teamCall(() => request("POST", AGENT_TASKS_ROUTES.list, decodeAgentTasks, { agentId }));
});

export const readAgentTask = Effect.fn("TeamClient.readAgentTask")(function* (
  request: TeamApiRequest,
  { agentId, taskId }: AgentTaskInput,
): Effect.fn.Return<ConversationSnapshot, TeamRequestError> {
  return yield* teamCall(() => request("POST", AGENT_TASKS_ROUTES.read, decodeTaskConversation, { agentId, taskId }));
});

/**
 * Starts a task. With files it uses `agent-thread-files-v1`, so send files only to a host that serves
 * it; `agent-tasks-v1` carries text only.
 */
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

/** Sends to a task. With files it uses `agent-thread-files-v1`, as `startAgentTask` does. */
export const sendAgentTaskMessage = Effect.fn("TeamClient.sendAgentTaskMessage")(function* (
  request: TeamApiRequest,
  {
    agentId,
    taskId,
    text,
    attachmentDraftIds,
    clientMessageId,
  }: AgentTaskInput & { text: string; attachmentDraftIds?: string[]; clientMessageId?: string },
): Effect.fn.Return<QueuedMessageReceipt, TeamRequestError> {
  return yield* teamCall(() =>
    attachmentDraftIds?.length
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

/** Stops the running turn of a task, closes the task, or reopens it. */
export const agentTaskControl = Effect.fn("TeamClient.agentTaskControl")(function* (
  request: TeamApiRequest,
  action: "stop" | "close" | "reopen",
  { agentId, taskId }: AgentTaskInput,
): Effect.fn.Return<void, TeamRequestError> {
  return yield* teamCall(() => request("POST", AGENT_TASKS_ROUTES[action], ignoreResponse, { agentId, taskId }));
});

/** Renames a side thread. Send it only to a host that serves `agent-threads-v1`. */
export const renameAgentThread = Effect.fn("TeamClient.renameAgentThread")(function* (
  request: TeamApiRequest,
  { agentId, taskId, title }: RenameAgentTaskInput,
): Effect.fn.Return<void, TeamRequestError> {
  return yield* teamCall(() =>
    request("POST", AGENT_THREADS_ROUTES.rename, ignoreResponse, { agentId, taskId, title }),
  );
});

/** Deletes a side thread for good. Send it only to a host that serves `agent-threads-v1`. */
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

/** The person's read mark of each open side thread. Send it only to a host that serves `agent-thread-reads-v1`. */
export const listAgentThreadReads = Effect.fn("TeamClient.listAgentThreadReads")(function* (
  request: TeamApiRequest,
  agentId: string,
): Effect.fn.Return<AgentTaskReadState[], TeamRequestError> {
  const answer = yield* teamCall(() => request("POST", AGENT_THREAD_READS_ROUTES.list, decodeThreadReads, { agentId }));
  return answer.reads;
});

/** Moves the person's read mark of a side thread. Send it only to a host that serves `agent-thread-reads-v1`. */
export const markAgentThreadRead = Effect.fn("TeamClient.markAgentThreadRead")(function* (
  request: TeamApiRequest,
  { agentId, taskId, throughMessageId }: MarkAgentTaskReadInput,
): Effect.fn.Return<AgentTaskReadState, TeamRequestError> {
  return yield* teamCall(() =>
    request("POST", AGENT_THREAD_READS_ROUTES.mark, decodeThreadReadState, { agentId, taskId, throughMessageId }),
  );
});

/** Sends a Grok Bot export to the host. Send it only to a host that serves `agent-import-v1`. */
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

/** The agent's skills that a message can tag. Send it only to a host that serves `installed-skills`. */
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
  // The released route carries only the released fields. A save goes on `browser-secret-vault-v1`, which
  // the caller offers only to an owner or admin of a host that serves it.
  const path =
    input.decision === "submit" && input.saveToVault
      ? BROWSER_SECRET_VAULT_ROUTES.respond
      : BROWSER_SECRET_RESPONSE_PATH;
  return yield* teamCall(() => request("POST", path, ignoreResponse, { ...remoteBrowserSecretResponse(input) }));
});

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

const decodeRoutine = guardedDecoder(isRoutine, "routine");
const decodeRoutineRun = guardedDecoder(isRoutineRun, "routine run");
const decodeRoutines = guardedListDecoder(isRoutine, "routine list");
const decodeRoutineRuns = guardedListDecoder(isRoutineRun, "routine run list");

/** The agent routine calls of the desktop IPC surface, which a remote desktop sends to the host the same way. */
export type TeamAgentRoutinesApi = Pick<
  OpenBotDesktopApi["agent"],
  "listRoutines" | "createRoutine" | "updateRoutine" | "deleteRoutine" | "testRoutine" | "listRoutineRuns"
>;

/** The frozen v1 agent routine routes. Every host serves them. */
export function teamAgentRoutinesApi(request: TeamApiRequest): TeamAgentRoutinesApi {
  return {
    listRoutines: (agentId) => request("GET", TEAM_API_ROUTES.agent.routines(agentId), decodeRoutines),
    createRoutine: (input) =>
      request("POST", TEAM_API_ROUTES.agent.routines(input.agentId), decodeRoutine, decodeTeamProtocolV2Json(input)),
    updateRoutine: (input) =>
      request(
        "PATCH",
        TEAM_API_ROUTES.agent.routine(input.agentId, input.routineId),
        decodeRoutine,
        decodeTeamProtocolV2Json(input),
      ),
    deleteRoutine: ({ agentId, routineId }) =>
      request("DELETE", TEAM_API_ROUTES.agent.routine(agentId, routineId), ignoreResponse),
    testRoutine: ({ agentId, routineId }) =>
      request("POST", TEAM_API_ROUTES.agent.routineTest(agentId, routineId), decodeRoutineRun),
    listRoutineRuns: ({ agentId, routineId, limit }) =>
      request("GET", `${TEAM_API_ROUTES.agent.routineRuns(agentId, routineId)}?limit=${limit}`, decodeRoutineRuns),
  };
}

/** The routine canvas calls of the desktop IPC surface. Send them only to a host that serves `routine-flows-v1`. */
export type TeamRoutineFlowsApi = OpenBotDesktopApi["routineFlows"];

const decodeRoutineFlowCanvas = guardedDecoder(isRoutineFlowCanvas, "routine flow canvas");
const decodeRoutineFlowLink = guardedDecoder(isRoutineFlowLink, "routine flow link");

/** Every routine flow route is a POST with its input in the body. */
export function teamRoutineFlowsApi(request: TeamApiRequest): TeamRoutineFlowsApi {
  const post = <T>(path: string, decode: (value: unknown) => T, body: unknown) =>
    request("POST", path, decode, decodeTeamProtocolV2Json(body));
  return {
    canvas: (agentId) => post(ROUTINE_FLOWS_ROUTES.canvas, decodeRoutineFlowCanvas, { agentId }),
    savePosition: (input) => post(ROUTINE_FLOWS_ROUTES.savePosition, ignoreResponse, input),
    removePosition: (input) => post(ROUTINE_FLOWS_ROUTES.removePosition, ignoreResponse, input),
    connect: (input) => post(ROUTINE_FLOWS_ROUTES.connect, decodeRoutineFlowLink, input),
    disconnect: (input) => post(ROUTINE_FLOWS_ROUTES.disconnect, ignoreResponse, input),
    updateLink: (input) => post(ROUTINE_FLOWS_ROUTES.updateLink, decodeRoutineFlowLink, input),
  };
}
/** An Effect request lets the desktop reuse its managed request lifetime. */
export type AgentMemoriesRequest<E> = <T>(
  method: string,
  path: string,
  decode: (value: unknown) => T,
  body?: TeamProtocolV2Json,
) => Effect.Effect<T, E>;

/** Old hosts keep their full-list route; new hosts send bounded pages in stable id order. */
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
  // Match the local store's updated_at DESC, memory_id order after collecting stable pages.
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

/** Selection pages name their owner and use strictly increasing memory IDs. */
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
