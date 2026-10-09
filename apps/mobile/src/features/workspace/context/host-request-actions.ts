import { isAvatarMimeType } from "@openbot/contracts/avatar-images";
import {
  assertStorageUsageScope,
  CHANNEL_CHATS_CAPABILITY,
  decodeAgentAdminSettings,
  decodeAgentHostSettings,
  decodeChannelRoutineRuns,
  decodeChannelRoutines,
  decodeChannelSummaries,
  decodeInstalledSkills,
  decodeStorageUsage,
  isAgentMemory,
  isAgentModelOption,
  isQueueSnapshot,
  isRoutine,
  isRoutineRun,
  type RoutineCalendarOwner,
  STORAGE_CAPABILITY,
} from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { AGENT_ADMIN_CAPABILITY, AGENT_ADMIN_ROUTES } from "@openbot/contracts/team-protocol/agent-admin-v1";
import {
  AGENT_HOST_SETTINGS_CAPABILITY,
  AGENT_HOST_SETTINGS_ROUTES,
} from "@openbot/contracts/team-protocol/agent-host-settings-v1";
import { AGENT_INSTALL_CAPABILITY } from "@openbot/contracts/team-protocol/agent-install-v1";
import { AGENT_PUBLISH_CAPABILITY } from "@openbot/contracts/team-protocol/agent-publish-v1";
import { CHANNEL_ROUTES } from "@openbot/contracts/team-protocol/channels-v1";
import { CONTEXT_RESET_CAPABILITY } from "@openbot/contracts/team-protocol/context-reset-v1";
import {
  TEAM_EML_ATTACHMENTS_CAPABILITY,
  TEAM_MEDIA_ATTACHMENTS_CAPABILITY,
  TEAM_SEMANTIC_TAGS_CAPABILITY,
} from "@openbot/contracts/team-protocol/current";
import { EVENTS_CAPABILITY } from "@openbot/contracts/team-protocol/events-v1";
import { TEAM_QUEUE_EDIT_CAPABILITY } from "@openbot/contracts/team-protocol/queue-edit-v1";
import { SHARED_TABLES_CAPABILITY } from "@openbot/contracts/team-protocol/shared-tables-v1";
import { SKILLS_ADMIN_CAPABILITY } from "@openbot/contracts/team-protocol/skills-admin-v1";
import { STORAGE_ROUTES } from "@openbot/contracts/team-protocol/storage-v1";
import type { TeamProtocolV2Json } from "@openbot/contracts/team-protocol/v2";
import { readHostAnalytics, runTeamEffect } from "@openbot/team-client";
import type { RemoteFileUpload } from "@openbot/team-client/remote-peer";
import { buildRoutineCalendar, type RoutineCalendarSource } from "@openbot/team-client/routine-calendar";
import {
  deleteEventRoutine,
  deleteSharedTable,
  installAgentTemplate,
  listAgentSkills,
  listEventActivity,
  listEventRoutines,
  listSharedTables,
  previewAgentTemplate,
  publishAgentTemplate,
  rotateEventRoutineSecret,
  saveEventRoutine,
  setAgentSkillEnabled,
  testEventRoutine,
  uninstallAgentSkill,
  unpublishAgentTemplate,
} from "@openbot/team-client/team-admin-requests";
import { clearAgentContext, type TeamApiRequest, TeamRequestError } from "@openbot/team-client/team-api-requests";
import type { QueryClient } from "@tanstack/react-query";
import { Effect } from "effect";
import * as Crypto from "expo-crypto";
import { decodeConversationSearchPage } from "@/features/workspace/model/conversation";
import { saveAgentRecord } from "@/features/workspace/model/save-agent-record";
import { decodeAgentSummaries, ignoreResponse } from "@/features/workspace/model/workspace-records";
import type { MobileWorkspaceContextValue } from "@/features/workspace/model/workspace-types";
import { currentText } from "@/shared/lib/text";

/** Sends one Team API request to a server; without a server ID it uses the active server. */
export type WorkspaceRequest = <T>(
  method: string,
  path: string,
  decode: (value: unknown) => T,
  body?: TeamProtocolV2Json,
  serverId?: string | null,
  upload?: RemoteFileUpload,
  onUploadProgress?: (fraction: number) => void,
) => Promise<T>;

type HostRequestActions = Pick<
  MobileWorkspaceContextValue,
  | "saveAgentMemory"
  | "deleteAgentMemory"
  | "createAgentRoutine"
  | "updateAgentRoutine"
  | "deleteAgentRoutine"
  | "testAgentRoutine"
  | "loadAgentModels"
  | "loadAgentMemories"
  | "loadAgentRoutines"
  | "loadRoutineCalendar"
  | "listEventRoutines"
  | "saveEventRoutine"
  | "deleteEventRoutine"
  | "testEventRoutine"
  | "rotateEventRoutineSecret"
  | "listEventActivity"
  | "loadHostAnalytics"
  | "searchMessages"
  | "loadAgentSkills"
  | "setAgentSkillEnabled"
  | "uninstallAgentSkill"
  | "loadAgentStorage"
  | "loadAgentAdminSettings"
  | "updateAgentAdminSettings"
  | "loadAgentHostSettings"
  | "updateAgentHostSettings"
  | "canStartNewChat"
  | "startNewChat"
  | "listSharedTables"
  | "deleteSharedTable"
  | "loadAgentTemplatePreview"
  | "publishAgentTemplate"
  | "unpublishAgentTemplate"
  | "deleteStoredFile"
  | "canInstallAgentTemplate"
  | "installAgentTemplate"
  | "loadAgentAvatar"
  | "duplicateAgent"
  | "loadQueue"
  | "canEditQueue"
  | "attachmentSupport"
  | "editQueue"
  | "changeQueue"
  | "downloadAttachment"
>;

/** Runs a Team API request. A failure rejects with the error of the host, not its Effect wrapper. */
function runTeamRequest<A>(operation: Effect.Effect<A, { readonly cause: unknown }>): Promise<A> {
  return runTeamEffect(operation.pipe(Effect.mapError((error) => error.cause)));
}

/** Workspace actions that only send host requests and read advertised capabilities. */
export function createHostRequestActions({
  request,
  teamApi,
  queryClient,
  queryScope,
  capabilities,
  attachmentDownloads,
}: {
  request: WorkspaceRequest;
  teamApi: (serverId: string) => TeamApiRequest;
  queryClient: QueryClient;
  /** The API URL, user ID and session scope that start each account query key. */
  queryScope: readonly [apiUrl: string, userId: string, sessionScope: number];
  capabilities: ReadonlyMap<string, string[]>;
  attachmentDownloads: { current: Promise<void> };
}): HostRequestActions {
  /** The shared admin requests, sent to one server that serves `skills-admin-v1`. */
  function skillsAdmin(serverId: string): TeamApiRequest {
    if (!capabilities.get(serverId)?.includes(SKILLS_ADMIN_CAPABILITY))
      throw new Error(currentText().t("mobile.agent.skill.manageUnsupported"));
    return teamApi(serverId);
  }
  /** The shared tables are an optional admin route set. */
  function sharedTablesAdmin(serverId: string): TeamApiRequest {
    if (!capabilities.get(serverId)?.includes(SHARED_TABLES_CAPABILITY))
      throw new Error(currentText().t("mobile.agent.tables.unsupported"));
    return teamApi(serverId);
  }
  /** Publishing is an optional admin route set. */
  function publishAdmin(serverId: string): TeamApiRequest {
    if (!capabilities.get(serverId)?.includes(AGENT_PUBLISH_CAPABILITY))
      throw new Error(currentText().t("mobile.agent.publish.unsupported"));
    return teamApi(serverId);
  }
  /** The event admin routes are optional and reject members on the host. */
  function eventsAdmin(serverId: string): TeamApiRequest {
    if (!capabilities.get(serverId)?.includes(EVENTS_CAPABILITY))
      throw new Error(currentText().t("mobile.agent.record.eventsUnsupported"));
    return teamApi(serverId);
  }
  return {
    listEventRoutines: (owner, serverId) => runTeamRequest(listEventRoutines(eventsAdmin(serverId), { owner })),
    saveEventRoutine: (input, serverId) => runTeamRequest(saveEventRoutine(eventsAdmin(serverId), input)),
    deleteEventRoutine: (input, serverId) => runTeamRequest(deleteEventRoutine(eventsAdmin(serverId), input)),
    testEventRoutine: (input, serverId) => runTeamRequest(testEventRoutine(eventsAdmin(serverId), input)),
    rotateEventRoutineSecret: (input, serverId) =>
      runTeamRequest(rotateEventRoutineSecret(eventsAdmin(serverId), input)),
    listEventActivity: (input, serverId) => runTeamRequest(listEventActivity(eventsAdmin(serverId), input)),
    saveAgentMemory: async (agentId, text, serverId, memoryId) => {
      await saveAgentRecord(queryClient, ["agent-info", ...queryScope, serverId, agentId, "memories"], () =>
        request(
          memoryId ? "PATCH" : "POST",
          memoryId ? TEAM_API_ROUTES.agent.memory(agentId, memoryId) : TEAM_API_ROUTES.agent.memories(agentId),
          (value) => {
            if (!isAgentMemory(value) || value.agentId !== agentId || (memoryId !== undefined && value.id !== memoryId))
              throw new Error("The host returned an invalid saved record.");
            return value;
          },
          { text },
          serverId,
        ),
      );
    },
    deleteAgentMemory: async (agentId, memoryId, serverId) => {
      await request("DELETE", TEAM_API_ROUTES.agent.memory(agentId, memoryId), ignoreResponse, undefined, serverId);
    },
    createAgentRoutine: async (input, serverId) => {
      await saveAgentRecord(queryClient, ["agent-info", ...queryScope, serverId, input.agentId, "routines"], () =>
        request(
          "POST",
          TEAM_API_ROUTES.agent.routines(input.agentId),
          (value) => {
            if (!isRoutine(value) || value.agentId !== input.agentId)
              throw new Error("The host returned an invalid saved record.");
            return value;
          },
          {
            name: input.name,
            instruction: input.instruction,
            active: input.active,
            timezone: input.timezone,
            schedule: input.schedule,
          },
          serverId,
        ),
      );
    },
    updateAgentRoutine: async (input, serverId) => {
      await saveAgentRecord(queryClient, ["agent-info", ...queryScope, serverId, input.agentId, "routines"], () =>
        request(
          "PATCH",
          TEAM_API_ROUTES.agent.routine(input.agentId, input.routineId),
          (value) => {
            if (!isRoutine(value) || value.agentId !== input.agentId || value.id !== input.routineId)
              throw new Error("The host returned an invalid saved record.");
            return value;
          },
          {
            ...(input.name === undefined ? {} : { name: input.name }),
            ...(input.instruction === undefined ? {} : { instruction: input.instruction }),
            ...(input.active === undefined ? {} : { active: input.active }),
            ...(input.schedule === undefined ? {} : { schedule: input.schedule }),
          },
          serverId,
        ),
      );
    },
    deleteAgentRoutine: async (agentId, routineId, serverId) => {
      await request("DELETE", TEAM_API_ROUTES.agent.routine(agentId, routineId), ignoreResponse, undefined, serverId);
    },
    testAgentRoutine: async (agentId, routineId, serverId) => {
      await request("POST", TEAM_API_ROUTES.agent.routineTest(agentId, routineId), ignoreResponse, undefined, serverId);
    },
    loadAgentModels: (serverId) =>
      request(
        "GET",
        TEAM_API_ROUTES.agents.models,
        (value) => {
          if (!Array.isArray(value) || !value.every(isAgentModelOption))
            throw new Error("The host returned invalid models.");
          return value;
        },
        undefined,
        serverId,
      ),
    loadAgentMemories: (agentId, serverId) =>
      request(
        "GET",
        TEAM_API_ROUTES.agent.memories(agentId),
        (value) => {
          if (
            !Array.isArray(value) ||
            !value.every(isAgentMemory) ||
            value.some((memory) => memory.agentId !== agentId)
          )
            throw new Error("The host returned invalid memories.");
          return value;
        },
        undefined,
        serverId,
      ),
    loadAgentRoutines: (agentId, serverId) =>
      request(
        "GET",
        TEAM_API_ROUTES.agent.routines(agentId),
        (value) => {
          if (!Array.isArray(value) || !value.every(isRoutine) || value.some((routine) => routine.agentId !== agentId))
            throw new Error("The host returned invalid routines.");
          return value;
        },
        undefined,
        serverId,
      ),
    loadRoutineCalendar: (input, serverId) =>
      runTeamRequest(
        buildRoutineCalendar(
          { from: new Date(input.from), to: new Date(input.to) },
          new Date(),
          routineCalendarSource(
            teamApi(serverId),
            capabilities.get(serverId)?.includes(CHANNEL_CHATS_CAPABILITY) ?? false,
          ),
        ),
      ),
    loadHostAnalytics: (input, serverId) =>
      runTeamRequest(readHostAnalytics(teamApi(serverId), capabilities.get(serverId) ?? [], input)),
    searchMessages: (query, serverId, cursor) =>
      request(
        "GET",
        // A query parameter never reaches the JSON adapters, so every released host reads it as sent.
        `${TEAM_API_ROUTES.messages.search}?${new URLSearchParams({ q: query, limit: "50", ...(cursor ? { cursor } : {}) })}`,
        decodeConversationSearchPage,
        undefined,
        serverId,
      ),
    // A host too old to know the route answers 404, so ask its advertised capabilities first.
    loadAgentSkills: async (agentId, serverId, manage = false) => {
      if (manage) return runTeamRequest(listAgentSkills(skillsAdmin(serverId), agentId));
      return capabilities.get(serverId)?.includes(TEAM_SEMANTIC_TAGS_CAPABILITY)
        ? request("GET", TEAM_API_ROUTES.agent.skills(agentId), decodeInstalledSkills, undefined, serverId)
        : null;
    },
    setAgentSkillEnabled: async (input, serverId) => runTeamRequest(setAgentSkillEnabled(skillsAdmin(serverId), input)),
    uninstallAgentSkill: async (input, serverId) => runTeamRequest(uninstallAgentSkill(skillsAdmin(serverId), input)),
    loadAgentStorage: async (agentId, serverId, force = false) => {
      if (!capabilities.get(serverId)?.includes(STORAGE_CAPABILITY)) return null;
      const input = { scope: "agent" as const, agentId, ...(force ? { force: true } : {}) };
      return assertStorageUsageScope(
        await request("POST", STORAGE_ROUTES.usage, decodeStorageUsage, input, serverId),
        input,
      );
    },
    loadAgentAdminSettings: async (agentId, serverId) =>
      capabilities.get(serverId)?.includes(AGENT_ADMIN_CAPABILITY)
        ? request("POST", AGENT_ADMIN_ROUTES.settings, decodeAgentAdminSettings, { agentId }, serverId)
        : null,
    updateAgentAdminSettings: async (input, serverId) => {
      if (!capabilities.get(serverId)?.includes(AGENT_ADMIN_CAPABILITY))
        throw new Error(currentText().t("mobile.agent.access.unsupported"));
      return request("POST", AGENT_ADMIN_ROUTES.update, decodeAgentAdminSettings, { ...input }, serverId);
    },
    loadAgentHostSettings: async (agentId, serverId) =>
      capabilities.get(serverId)?.includes(AGENT_HOST_SETTINGS_CAPABILITY)
        ? request("POST", AGENT_HOST_SETTINGS_ROUTES.settings, decodeAgentHostSettings, { agentId }, serverId)
        : null,
    updateAgentHostSettings: async (input, serverId) => {
      if (!capabilities.get(serverId)?.includes(AGENT_HOST_SETTINGS_CAPABILITY))
        throw new Error(currentText().t("mobile.agent.host.unsupported"));
      return request("POST", AGENT_HOST_SETTINGS_ROUTES.update, decodeAgentHostSettings, { ...input }, serverId);
    },
    canStartNewChat: (serverId) => capabilities.get(serverId)?.includes(CONTEXT_RESET_CAPABILITY) ?? false,
    startNewChat: async (agentId, serverId) => {
      // A host too old to know the route answers 404, so refuse before the request.
      if (!capabilities.get(serverId)?.includes(CONTEXT_RESET_CAPABILITY))
        throw new Error(currentText().t("mobile.agent.newChat.unsupported"));
      await runTeamRequest(clearAgentContext(teamApi(serverId), agentId));
    },
    // Async, so a host without the capability rejects the promise and does not throw at the call.
    listSharedTables: async (serverId) => runTeamRequest(listSharedTables(sharedTablesAdmin(serverId))),
    deleteSharedTable: async (name, serverId) => runTeamRequest(deleteSharedTable(sharedTablesAdmin(serverId), name)),
    loadAgentTemplatePreview: async (agentId, serverId) =>
      runTeamRequest(previewAgentTemplate(publishAdmin(serverId), agentId)),
    // A phone cannot draw the share card, and the host publishes without one.
    publishAgentTemplate: async (agentId, serverId) =>
      runTeamRequest(publishAgentTemplate(publishAdmin(serverId), { agentId, card: null })),
    unpublishAgentTemplate: async (agentId, serverId) =>
      runTeamRequest(unpublishAgentTemplate(publishAdmin(serverId), agentId)),
    deleteStoredFile: async (fileId, serverId) => {
      if (!capabilities.get(serverId)?.includes(STORAGE_CAPABILITY))
        throw new Error(currentText().t("mobile.workspace.error.filesUnsupported"));
      await request("POST", STORAGE_ROUTES.deleteFile, ignoreResponse, { fileId }, serverId);
    },
    canInstallAgentTemplate: (serverId) => capabilities.get(serverId)?.includes(AGENT_INSTALL_CAPABILITY) ?? false,
    installAgentTemplate: (input, serverId) => {
      // A host too old to know the route answers 404, so refuse before the request.
      if (!capabilities.get(serverId)?.includes(AGENT_INSTALL_CAPABILITY))
        return Promise.reject(new Error(currentText().t("mobile.link.template.error.unsupported")));
      return runTeamRequest(installAgentTemplate(teamApi(serverId), input));
    },
    loadAgentAvatar: (agentId, avatarUrl, serverId) => requestAgentAvatar(request, agentId, avatarUrl, serverId),
    duplicateAgent: async (agentId) => {
      await request("POST", TEAM_API_ROUTES.agent.duplicate(agentId), ignoreResponse, {
        operationId: Crypto.randomUUID(),
      });
    },
    loadQueue: (agentId, serverId) =>
      request(
        "GET",
        TEAM_API_ROUTES.agent.queue(agentId),
        (value) => {
          if (!isQueueSnapshot(value) || value.agentId !== agentId)
            throw new Error("The host returned an invalid queue.");
          return value;
        },
        undefined,
        serverId,
      ),
    canEditQueue: (serverId) => capabilities.get(serverId)?.includes(TEAM_QUEUE_EDIT_CAPABILITY) ?? false,
    attachmentSupport: (serverId) => {
      const advertised = capabilities.get(serverId) ?? [];
      return {
        eml: advertised.includes(TEAM_EML_ATTACHMENTS_CAPABILITY),
        media: advertised.includes(TEAM_MEDIA_ATTACHMENTS_CAPABILITY),
      };
    },
    editQueue: async (agentId, serverId, input) => {
      return request(
        "POST",
        TEAM_API_ROUTES.agent.queueEdit(agentId),
        (value) => {
          if (!isQueueSnapshot(value) || value.agentId !== agentId)
            throw new Error("The host returned an invalid queue edit.");
          return value;
        },
        { ...input },
        serverId,
      );
    },
    changeQueue: async (agentId, serverId, action, input) => {
      const route =
        action === "cancel"
          ? TEAM_API_ROUTES.agent.queueCancel
          : action === "steer"
            ? TEAM_API_ROUTES.agent.queueSteer
            : TEAM_API_ROUTES.agent.queueReorder;
      await request("POST", route(agentId), ignoreResponse, input, serverId);
    },
    downloadAttachment: (serverId, attachmentId) => {
      const download = () =>
        request(
          "GET",
          TEAM_API_ROUTES.attachment(attachmentId),
          (value) => {
            if (
              !isDynamicRecord(value) ||
              !isString(value.name) ||
              !isString(value.mimeType) ||
              !isString(value.base64)
            )
              throw new Error("The host returned an invalid file.");
            return { name: value.name, mimeType: value.mimeType, base64: value.base64 };
          },
          undefined,
          serverId,
        );
      // Limit native/DOM copies when a message contains several large images.
      const result = attachmentDownloads.current.then(download);
      attachmentDownloads.current = result.then(
        () => {},
        () => {},
      );
      return result;
    },
  };
}

/** The routes that the desktop calendar reads from a remote host, so both place the same runs. */
function routineCalendarSource(request: TeamApiRequest, channels: boolean): RoutineCalendarSource<TeamRequestError> {
  /** One request to this server as an Effect. */
  const send = <T>(method: string, path: string, decode: (value: unknown) => T, body?: TeamProtocolV2Json) =>
    Effect.tryPromise({
      try: () => request(method, path, decode, body),
      catch: (cause) => new TeamRequestError({ cause }),
    });
  return {
    owners: () =>
      Effect.gen(function* () {
        // A host from before channels rejects the channel routes; its agents still have routines.
        const [agents, channelList] = yield* Effect.all(
          [
            send("GET", TEAM_API_ROUTES.agents.all, decodeAgentSummaries),
            channels ? send("GET", CHANNEL_ROUTES.list, decodeChannelSummaries) : Effect.succeed([]),
          ],
          { concurrency: "unbounded" },
        );
        return [
          ...agents.map((agent): RoutineCalendarOwner => ({ kind: "agent", agentId: agent.id })),
          ...channelList
            .filter((channel) => !channel.archived)
            .map((channel): RoutineCalendarOwner => ({ kind: "channel", channelId: channel.id })),
        ];
      }),
    routines: (owner) =>
      owner.kind === "agent"
        ? send("GET", TEAM_API_ROUTES.agent.routines(owner.agentId), (value) => {
            if (!Array.isArray(value) || !value.every(isRoutine))
              throw new Error("The host returned invalid routines.");
            return value;
          })
        : send("POST", CHANNEL_ROUTES.routines, decodeChannelRoutines, { channelId: owner.channelId }),
    runs: (owner, routineId, limit) =>
      owner.kind === "agent"
        ? send("GET", `${TEAM_API_ROUTES.agent.routineRuns(owner.agentId, routineId)}?limit=${limit}`, (value) => {
            if (!Array.isArray(value) || !value.every(isRoutineRun))
              throw new Error("The host returned an invalid routine history.");
            return value;
          })
        : send("POST", CHANNEL_ROUTES.routineRuns, decodeChannelRoutineRuns, {
            channelId: owner.channelId,
            routineId,
            limit,
          }),
  };
}

/** The agent photo as a data URL. The Live Activity reads it too, outside the workspace value. */
export function requestAgentAvatar(
  request: WorkspaceRequest,
  agentId: string,
  avatarUrl: string,
  serverId: string,
): Promise<string> {
  const version = new URL(avatarUrl).searchParams.get("v");
  if (!version) return Promise.reject(new Error("The agent avatar has no version."));
  return request(
    "GET",
    `${TEAM_API_ROUTES.agent.avatar(agentId)}?${new URLSearchParams({ v: version })}`,
    (value) => {
      if (
        !isDynamicRecord(value) ||
        !isString(value.mimeType) ||
        !isAvatarMimeType(value.mimeType) ||
        !isString(value.base64)
      )
        throw new Error("The host returned an invalid avatar.");
      return `data:${value.mimeType};base64,${value.base64}`;
    },
    undefined,
    serverId,
  );
}
