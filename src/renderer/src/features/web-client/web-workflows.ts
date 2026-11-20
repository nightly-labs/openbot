import {
  type AgentEvent,
  type AttachmentSummary,
  decodeWorkflowFoldersSnapshot,
  STORAGE_CAPABILITY,
  type TeamRealtimeEvent,
  type WorkflowFolderAction,
  type WorkflowMediaKind,
} from "@openbot/contracts/ipc";
import { AGENT_ACCESS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-access-v1";
import { ATTACHMENT_PREVIEW_CAPABILITY } from "@openbot/contracts/team-protocol/attachment-preview-v1";
import { ROUTINE_RESULTS_CAPABILITY } from "@openbot/contracts/team-protocol/routine-results-v1";
import { decodeTeamProtocolV2Json, TEAM_PROTOCOL_V2_MAX_FILE_BYTES } from "@openbot/contracts/team-protocol/v2";
import {
  WORKFLOW_FOLDERS_CAPABILITY,
  WORKFLOW_FOLDERS_ROUTES,
} from "@openbot/contracts/team-protocol/workflow-folders-v1";
import { WORKFLOWS_AGENT_FILES_CAPABILITY } from "@openbot/contracts/team-protocol/workflows-agent-files-v1";
import { WORKFLOWS_CHANNELS_CAPABILITY } from "@openbot/contracts/team-protocol/workflows-channels-v1";
import { WORKFLOWS_CHATS_CAPABILITY } from "@openbot/contracts/team-protocol/workflows-chats-v1";
import {
  WORKFLOWS_GITHUB_CAPABILITY,
  WORKFLOWS_GITHUB_ROUTES,
} from "@openbot/contracts/team-protocol/workflows-github-v1";
import {
  WORKFLOWS_HIGGSFIELD_CAPABILITY,
  WORKFLOWS_HIGGSFIELD_ROUTES,
} from "@openbot/contracts/team-protocol/workflows-higgsfield-v1";
import { WORKFLOWS_MEDIA_ACCOUNT_CAPABILITY } from "@openbot/contracts/team-protocol/workflows-media-account-v1";
import {
  WORKFLOWS_MEDIA_CATALOG_CAPABILITY,
  WORKFLOWS_MEDIA_CATALOG_ROUTES,
} from "@openbot/contracts/team-protocol/workflows-media-catalog-v1";
import {
  WORKFLOWS_MEDIA_CATALOG_V2_CAPABILITY,
  WORKFLOWS_MEDIA_CATALOG_V2_ROUTES,
} from "@openbot/contracts/team-protocol/workflows-media-catalog-v2";
import {
  WORKFLOWS_MEDIA_SERVICE_ACCOUNT_CAPABILITY,
  WORKFLOWS_MEDIA_SERVICE_ACCOUNT_ROUTES,
} from "@openbot/contracts/team-protocol/workflows-media-service-account-v1";
import { WORKFLOWS_MEDIA_SIZE_CAPABILITY } from "@openbot/contracts/team-protocol/workflows-media-size-v1";
import { WORKFLOWS_MEDIA_TRANSPARENT_CAPABILITY } from "@openbot/contracts/team-protocol/workflows-media-transparent-v1";
import {
  WORKFLOWS_MEDIA_CAPABILITY,
  WORKFLOWS_MEDIA_ROUTES,
} from "@openbot/contracts/team-protocol/workflows-media-v1";
import {
  WORKFLOWS_STEP_SETTINGS_CAPABILITY,
  WORKFLOWS_STEP_SETTINGS_ROUTES,
} from "@openbot/contracts/team-protocol/workflows-step-settings-v1";
import {
  WORKFLOWS_SUNRA_CAPABILITY,
  WORKFLOWS_SUNRA_ROUTES,
} from "@openbot/contracts/team-protocol/workflows-sunra-v1";
import { WORKFLOWS_CAPABILITY, WORKFLOWS_ROUTES } from "@openbot/contracts/team-protocol/workflows-v1";
import { runTeamEffect } from "@openbot/team-client";
import { bytesToBase64 } from "@openbot/team-client/base64";
import {
  getHostAgentAccess,
  getStorageUsage,
  listRoutineResultOptions,
  type TeamAdminRequestError,
} from "@openbot/team-client/team-admin-requests";
import {
  discardAttachmentDraft,
  type TeamApiRequest,
  teamChannelsApi,
  uploadAttachmentDraft,
} from "@openbot/team-client/team-api-requests";
import {
  decodeRemoteHiggsfieldCredits,
  decodeRemoteHiggsfieldProviders,
  decodeRemoteMediaServiceAccounts,
  decodeRemoteMediaServiceCredits,
  decodeRemoteWorkflowDetail,
  decodeRemoteWorkflowGitHubCatalog,
  decodeRemoteWorkflowGitHubHistory,
  decodeRemoteWorkflowGitHubOptions,
  decodeRemoteWorkflowList,
  decodeRemoteWorkflowMediaCatalog,
  decodeRemoteWorkflowMediaCredits,
  decodeRemoteWorkflowMediaPrice,
  decodeRemoteWorkflowMediaProviders,
  decodeRemoteWorkflowPicture,
  decodeRemoteWorkflowRunDetail,
  decodeRemoteWorkflowRunPage,
  decodeRemoteWorkflowSaveResult,
  decodeRemoteWorkflowSecret,
  decodeRemoteWorkflowStep,
  decodeRemoteWorkflowStepSettings,
  decodeRemoteWorkflowSummary,
  decodeRemoteWorkflowVersionGraph,
  decodeRemoteWorkflowVersions,
  workflowMediaCreditsOf,
  workflowMediaProvidersOf,
} from "@openbot/team-client/workflow-decoding";
import type { AttachmentMediaSource } from "@openbot/ui/features/conversation/AttachmentCards";
import { currentText } from "@openbot/ui/text";
import { Effect } from "effect";
import { createSignal } from "solid-js";
import type { GitHubConnectorPort } from "../connectors/github-connector-port";
import { checkPicture, keptPicture, libraryPictures, type WorkflowHost } from "../workflows/workflows-port";
import { openWebLink } from "./web-attachments";

export interface WebWorkflowHostOptions {
  request: () => TeamApiRequest;
  capabilities: () => readonly string[];
  admin: () => boolean;
  hostName: () => string | undefined;
  onHostEvent: (listener: (event: AgentEvent | TeamRealtimeEvent) => void) => () => void;
  onReconnect: (listener: () => void) => () => void;
  githubConnector: GitHubConnectorPort;
  attachmentMedia: AttachmentMediaSource | undefined;
  previewMedia: AttachmentMediaSource | undefined;
}

function mediaSummary(id: string, kind: WorkflowMediaKind): AttachmentSummary {
  const video = kind === "video";
  return {
    id,
    name: video ? "video.mp4" : "image.png",
    mimeType: video ? "video/mp4" : "image/png",
    size: 0,
    kind: video ? "file" : "image",
    previewKind: video ? "none" : "image",
    previewUrl: null,
  };
}

export function webWorkflowHost(options: WebWorkflowHostOptions): WorkflowHost {
  const has = (capability: string) => options.capabilities().includes(capability);
  const placesSupported = () => options.admin() && has(ROUTINE_RESULTS_CAPABILITY);
  const chatsSupported = () => placesSupported() && has(WORKFLOWS_CHATS_CAPABILITY);
  const channelsSupported = () => options.admin() && has(WORKFLOWS_CHANNELS_CAPABILITY);
  const githubSupported = () => has(WORKFLOWS_GITHUB_CAPABILITY);
  const tooOld = () => new Error(currentText().t("error.workflow.serverTooOld"));
  const [unloaded, setUnloaded] = createSignal<ReadonlySet<string>>(new Set());
  options.onReconnect(() => setUnloaded(new Set()));
  const loaded = (
    media: AttachmentMediaSource,
    attachmentId: string,
    kind: WorkflowMediaKind,
    size: "thumbnail" | "generated",
    key: string,
  ) => {
    if (unloaded().has(key)) return null;
    void media.load(mediaSummary(attachmentId, kind), size).then((shown) => {
      if (!shown) setUnloaded((keys) => new Set(keys).add(key));
    });
    return media.url(attachmentId);
  };
  const mediaUrl = (attachmentId: string, kind: WorkflowMediaKind) => {
    const media = options.attachmentMedia;
    return media ? loaded(media, attachmentId, kind, "thumbnail", `file:${attachmentId}`) : undefined;
  };

  const post = async <T>(path: string, decode: (value: unknown) => T, body: unknown): Promise<T> => {
    if (!has(WORKFLOWS_CAPABILITY)) throw tooOld();
    return options.request()("POST", path, decode, decodeTeamProtocolV2Json(body));
  };
  const postGitHub = async <T>(path: string, decode: (value: unknown) => T, body: unknown): Promise<T> => {
    if (!githubSupported()) throw tooOld();
    return post(path, decode, body);
  };
  const postMedia = async <T>(path: string, decode: (value: unknown) => T, body: unknown): Promise<T> => {
    if (!has(WORKFLOWS_MEDIA_CAPABILITY)) throw tooOld();
    return post(path, decode, body);
  };
  const foldersSupported = () => has(WORKFLOWS_CAPABILITY) && has(WORKFLOW_FOLDERS_CAPABILITY);
  const postFolders = async (path: string, body: unknown) => {
    if (!foldersSupported()) throw tooOld();
    return post(path, decodeWorkflowFoldersSnapshot, body);
  };
  const folders = () => postFolders(WORKFLOW_FOLDERS_ROUTES.read, {});
  const folderAction = (action: WorkflowFolderAction) => postFolders(WORKFLOW_FOLDERS_ROUTES.actions, action);
  const empty = () => undefined;
  const run = <T>(effect: (request: TeamApiRequest) => Effect.Effect<T, TeamAdminRequestError>) =>
    runTeamEffect(Effect.suspend(() => effect(options.request())).pipe(Effect.mapError((error) => error.cause)));
  let optionsCall: ReturnType<typeof readOptions> | undefined;
  const readOptions = () => run(listRoutineResultOptions);
  const connectionOptions = () => {
    optionsCall ??= readOptions().finally(() => {
      optionsCall = undefined;
    });
    return optionsCall;
  };

  return {
    workflows: {
      list: () => post(WORKFLOWS_ROUTES.list, decodeRemoteWorkflowList, {}),
      get: (workflowId) => post(WORKFLOWS_ROUTES.get, decodeRemoteWorkflowDetail, { workflowId }),
      create: (input) => post(WORKFLOWS_ROUTES.create, decodeRemoteWorkflowDetail, input),
      rename: (input) => post(WORKFLOWS_ROUTES.rename, decodeRemoteWorkflowSummary, input),
      delete: (workflowId) => post(WORKFLOWS_ROUTES.delete, empty, { workflowId }),
      saveGraph: (input) => post(WORKFLOWS_ROUTES.saveGraph, decodeRemoteWorkflowSaveResult, input),
      versions: (workflowId) => post(WORKFLOWS_ROUTES.versions, decodeRemoteWorkflowVersions, { workflowId }),
      versionGraph: (input) => post(WORKFLOWS_ROUTES.versionGraph, decodeRemoteWorkflowVersionGraph, input),
      restoreVersion: (input) => post(WORKFLOWS_ROUTES.restoreVersion, decodeRemoteWorkflowDetail, input),
      startRun: (input) => post(WORKFLOWS_ROUTES.startRun, decodeRemoteWorkflowRunDetail, input),
      runStep: (input) => post(WORKFLOWS_ROUTES.runStep, decodeRemoteWorkflowStep, input),
      stopStep: (stepId) => post(WORKFLOWS_ROUTES.stopStep, empty, { stepId }),
      stopRun: (runId) => post(WORKFLOWS_ROUTES.stopRun, empty, { runId }),
      retryStep: (input) => post(WORKFLOWS_ROUTES.retryStep, decodeRemoteWorkflowStep, input),
      decide: (input) => post(WORKFLOWS_ROUTES.decide, empty, input),
      runs: (input) => post(WORKFLOWS_ROUTES.runs, decodeRemoteWorkflowRunPage, input),
      run: (runId) => post(WORKFLOWS_ROUTES.run, decodeRemoteWorkflowRunDetail, { runId }),
      stepSettings: async (stepId) => {
        if (!has(WORKFLOWS_STEP_SETTINGS_CAPABILITY)) throw tooOld();
        return post(WORKFLOWS_STEP_SETTINGS_ROUTES.read, decodeRemoteWorkflowStepSettings, { stepId });
      },
      rotateWebhookSecret: (input) => post(WORKFLOWS_ROUTES.rotateWebhookSecret, decodeRemoteWorkflowSecret, input),
      githubCatalog: () => postGitHub(WORKFLOWS_GITHUB_ROUTES.catalog, decodeRemoteWorkflowGitHubCatalog, {}),
      githubOptions: (input) => postGitHub(WORKFLOWS_GITHUB_ROUTES.options, decodeRemoteWorkflowGitHubOptions, input),
      githubHistory: (workflowId) =>
        postGitHub(WORKFLOWS_GITHUB_ROUTES.history, decodeRemoteWorkflowGitHubHistory, { workflowId }),
      githubRunLastEvent: (input) =>
        postGitHub(WORKFLOWS_GITHUB_ROUTES.runLastEvent, decodeRemoteWorkflowRunDetail, input),
      keepPicture: (draftId) => postMedia(WORKFLOWS_MEDIA_ROUTES.keepPicture, decodeRemoteWorkflowPicture, { draftId }),
      mediaProviders: async () => {
        if (has(WORKFLOWS_MEDIA_SERVICE_ACCOUNT_CAPABILITY)) {
          const accounts = await post(
            WORKFLOWS_MEDIA_SERVICE_ACCOUNT_ROUTES.accounts,
            decodeRemoteMediaServiceAccounts,
            {},
          );
          return workflowMediaProvidersOf(accounts);
        }
        const [sunra, higgsfield] = await Promise.all([
          has(WORKFLOWS_SUNRA_CAPABILITY)
            ? post(WORKFLOWS_SUNRA_ROUTES.providers, decodeRemoteWorkflowMediaProviders, {})
            : { sunra: false },
          has(WORKFLOWS_HIGGSFIELD_CAPABILITY)
            ? post(WORKFLOWS_HIGGSFIELD_ROUTES.providers, decodeRemoteHiggsfieldProviders, {})
            : { higgsfield: false },
        ]);
        return { ...sunra, ...higgsfield, accounts: null };
      },
      mediaCredits: async () => {
        if (has(WORKFLOWS_MEDIA_SERVICE_ACCOUNT_CAPABILITY)) {
          const accounts = await post(
            WORKFLOWS_MEDIA_SERVICE_ACCOUNT_ROUTES.credits,
            decodeRemoteMediaServiceCredits,
            {},
          );
          return workflowMediaCreditsOf(accounts);
        }
        const [sunra, higgsfield] = await Promise.all([
          has(WORKFLOWS_SUNRA_CAPABILITY)
            ? post(WORKFLOWS_SUNRA_ROUTES.credits, decodeRemoteWorkflowMediaCredits, {})
            : { sunra: null },
          has(WORKFLOWS_HIGGSFIELD_CAPABILITY)
            ? post(WORKFLOWS_HIGGSFIELD_ROUTES.credits, decodeRemoteHiggsfieldCredits, {})
            : { higgsfield: null },
        ]);
        return { ...sunra, ...higgsfield, accounts: null };
      },
      mediaCatalog: async () =>
        has(WORKFLOWS_MEDIA_CATALOG_V2_CAPABILITY)
          ? post(WORKFLOWS_MEDIA_CATALOG_V2_ROUTES.catalog, decodeRemoteWorkflowMediaCatalog, {})
          : has(WORKFLOWS_MEDIA_CATALOG_CAPABILITY)
            ? post(WORKFLOWS_MEDIA_CATALOG_ROUTES.catalog, decodeRemoteWorkflowMediaCatalog, {})
            : { models: [] },
      mediaPrice: async (input) =>
        has(WORKFLOWS_MEDIA_CATALOG_V2_CAPABILITY)
          ? post(WORKFLOWS_MEDIA_CATALOG_V2_ROUTES.price, decodeRemoteWorkflowMediaPrice, input)
          : has(WORKFLOWS_MEDIA_CATALOG_CAPABILITY)
            ? post(WORKFLOWS_MEDIA_CATALOG_ROUTES.price, decodeRemoteWorkflowMediaPrice, input)
            : { credits: null },
      folders,
      folderAction,
    },
    onChanged(changed) {
      const events = options.onHostEvent((event) => {
        if (event.type === "workflows-changed") changed(event.workflowId);
        else if (event.type === "agent-access-changed") changed(null);
      });
      const reconnect = options.onReconnect(() => changed(null));
      return () => {
        events();
        reconnect();
      };
    },
    foldersSupported,
    folders,
    folderAction,
    onFoldersChanged(changed) {
      const events = options.onHostEvent((event) => {
        if (event.type === "workflow-folders-changed") changed();
      });
      const reconnect = options.onReconnect(changed);
      return () => {
        events();
        reconnect();
      };
    },
    async places() {
      if (!placesSupported()) return [];
      const connections = await connectionOptions();
      return connections.flatMap((connection) =>
        connection.places.map((place) => ({
          connectionId: connection.connectionId,
          placeId: place.id,
          label: `${connection.connectionName} · ${place.name}`,
          platform: connection.platform,
          connection: connection.connectionName,
          name: place.name,
        })),
      );
    },
    async channels() {
      if (!channelsSupported()) return [];
      const channels = await teamChannelsApi(options.request()).listChannels();
      return channels.filter((channel) => !channel.archived).map((channel) => ({ id: channel.id, name: channel.name }));
    },
    async discordServers() {
      return [];
    },
    async telegramChats() {
      if (!chatsSupported()) return [];
      return (await connectionOptions())
        .filter((option) => option.platform === "telegram")
        .map((option) => ({ connectionId: option.connectionId, name: option.connectionName }));
    },
    async slackWorkspaces() {
      if (!chatsSupported()) return [];
      return (await connectionOptions())
        .filter((option) => option.platform === "slack")
        .map((option) => ({
          connectionId: option.connectionId,
          name: option.connectionName,
          channels: option.places.map((place) => ({ id: place.id, name: place.name.replace(/^#/u, "") })),
        }));
    },
    async agentLevels() {
      if (options.admin() || !has(AGENT_ACCESS_CAPABILITY)) return null;
      return (await run(getHostAgentAccess)).mine;
    },
    async pictures() {
      if (!has(WORKFLOWS_MEDIA_CAPABILITY) || !has(STORAGE_CAPABILITY)) return [];
      const usage = await run((request) => getStorageUsage(request, { scope: "host" }));
      return libraryPictures(usage).map((file) => ({ ...file, previewUrl: null }));
    },
    async uploadPicture(file) {
      if (!has(WORKFLOWS_MEDIA_CAPABILITY)) throw tooOld();
      checkPicture(file, TEAM_PROTOCOL_V2_MAX_FILE_BYTES);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const request = options.request();
      const draft = await runTeamEffect(
        uploadAttachmentDraft(request, {
          name: file.name,
          mimeType: file.type,
          base64: bytesToBase64(bytes),
          maxBytes: TEAM_PROTOCOL_V2_MAX_FILE_BYTES,
        }).pipe(Effect.mapError((error) => error.cause)),
      );
      const fileId = await postMedia(WORKFLOWS_MEDIA_ROUTES.keepPicture, decodeRemoteWorkflowPicture, {
        draftId: draft.id,
      }).catch(async (error: unknown) => {
        await runTeamEffect(
          discardAttachmentDraft(request, draft.id).pipe(Effect.mapError((failure) => failure.cause)),
        ).catch(() => undefined);
        throw error;
      });
      return keptPicture(fileId, file, null);
    },
    githubSupported,
    mediaSupported: () => has(WORKFLOWS_MEDIA_CAPABILITY),
    mediaAccountSupported: () => has(WORKFLOWS_MEDIA_CAPABILITY) && has(WORKFLOWS_MEDIA_ACCOUNT_CAPABILITY),
    mediaTransparentSupported: () => has(WORKFLOWS_MEDIA_CAPABILITY) && has(WORKFLOWS_MEDIA_TRANSPARENT_CAPABILITY),
    mediaSizeSupported: () => has(WORKFLOWS_MEDIA_CAPABILITY) && has(WORKFLOWS_MEDIA_SIZE_CAPABILITY),
    agentFilesSupported: () => has(WORKFLOWS_AGENT_FILES_CAPABILITY),
    stepSettingsSupported: () => has(WORKFLOWS_STEP_SETTINGS_CAPABILITY),
    mediaUrl,
    mediaPreviewUrl(attachmentId) {
      const previews = options.previewMedia;
      const key = `preview:${attachmentId}`;
      if (!previews || !has(ATTACHMENT_PREVIEW_CAPABILITY) || unloaded().has(key)) {
        return mediaUrl(attachmentId, "image");
      }
      return loaded(previews, attachmentId, "image", "thumbnail", key);
    },
    githubConnector: options.githubConnector,
    hostName: options.hostName,
    openUrl: openWebLink,
  };
}
