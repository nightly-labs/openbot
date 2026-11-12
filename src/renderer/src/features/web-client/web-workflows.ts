// The Workflows page of the joined server in the browser client. The host serves the workflows
// through `workflows-v1`, and the GitHub catalog, options, history and last-event runs through
// `workflows-github-v1`, and keeps an uploaded picture through `workflows-media-v1`. The targets of an
// output use the same capabilities as on desktop.

import {
  type AgentEvent,
  type AttachmentSummary,
  STORAGE_CAPABILITY,
  type TeamRealtimeEvent,
  type WorkflowMediaKind,
} from "@openbot/contracts/ipc";
import { AGENT_ACCESS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-access-v1";
import { ROUTINE_RESULTS_CAPABILITY } from "@openbot/contracts/team-protocol/routine-results-v1";
import { decodeTeamProtocolV2Json, TEAM_PROTOCOL_V2_MAX_FILE_BYTES } from "@openbot/contracts/team-protocol/v2";
import { WORKFLOWS_CHANNELS_CAPABILITY } from "@openbot/contracts/team-protocol/workflows-channels-v1";
import { WORKFLOWS_CHATS_CAPABILITY } from "@openbot/contracts/team-protocol/workflows-chats-v1";
import {
  WORKFLOWS_GITHUB_CAPABILITY,
  WORKFLOWS_GITHUB_ROUTES,
} from "@openbot/contracts/team-protocol/workflows-github-v1";
import {
  WORKFLOWS_MEDIA_CAPABILITY,
  WORKFLOWS_MEDIA_ROUTES,
} from "@openbot/contracts/team-protocol/workflows-media-v1";
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
  decodeRemoteWorkflowDetail,
  decodeRemoteWorkflowGitHubCatalog,
  decodeRemoteWorkflowGitHubHistory,
  decodeRemoteWorkflowGitHubOptions,
  decodeRemoteWorkflowList,
  decodeRemoteWorkflowPicture,
  decodeRemoteWorkflowRunDetail,
  decodeRemoteWorkflowRunPage,
  decodeRemoteWorkflowSaveResult,
  decodeRemoteWorkflowSecret,
  decodeRemoteWorkflowStep,
  decodeRemoteWorkflowSummary,
  decodeRemoteWorkflowVersionGraph,
  decodeRemoteWorkflowVersions,
} from "@openbot/team-client/workflow-decoding";
import type { AttachmentMediaSource } from "@openbot/ui/features/conversation/AttachmentCards";
import { currentText } from "@openbot/ui/text";
import { Effect } from "effect";
import type { GitHubConnectorPort } from "../connectors/github-connector-port";
import { checkPicture, keptPicture, libraryPictures, type WorkflowHost } from "../workflows/workflows-port";
import { openWebLink } from "./web-attachments";

/**
 * Each value is read on each call, so one host serves each server that the tab connects to. The page
 * remounts on a server switch.
 */
export interface WebWorkflowHostOptions {
  /** The admin requests of the connected host. It throws when no server is connected. */
  request: () => TeamApiRequest;
  capabilities: () => readonly string[];
  /** Whether this account is an owner or admin of the connected host. */
  admin: () => boolean;
  hostName: () => string | undefined;
  /** Every event of the connected host. Returns the unsubscribe function. */
  onHostEvent: (listener: (event: AgentEvent | TeamRealtimeEvent) => void) => () => void;
  /** Calls `listener` each time the connected host is online again. Returns the unsubscribe function. */
  onReconnect: (listener: () => void) => () => void;
  githubConnector: GitHubConnectorPort;
  /** The object URLs of the chat's host files. A media step shows its file through them. */
  attachmentMedia: AttachmentMediaSource | undefined;
}

/** The host sends only the id of a media step's file, so the name and type come from the step kind. */
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
  /** Only an owner or admin reads the host's connections (`routine-results-v1`). */
  const placesSupported = () => options.admin() && has(ROUTINE_RESULTS_CAPABILITY);
  const chatsSupported = () => placesSupported() && has(WORKFLOWS_CHATS_CAPABILITY);
  const channelsSupported = () => options.admin() && has(WORKFLOWS_CHANNELS_CAPABILITY);
  const githubSupported = () => has(WORKFLOWS_GITHUB_CAPABILITY);
  const tooOld = () => new Error(currentText().t("error.workflow.serverTooOld"));

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
  const empty = () => undefined;
  const run = <T>(effect: (request: TeamApiRequest) => Effect.Effect<T, TeamAdminRequestError>) =>
    runTeamEffect(Effect.suspend(() => effect(options.request())).pipe(Effect.mapError((error) => error.cause)));
  const connectionOptions = () => run(listRoutineResultOptions);

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
      rotateWebhookSecret: (input) => post(WORKFLOWS_ROUTES.rotateWebhookSecret, decodeRemoteWorkflowSecret, input),
      githubCatalog: () => postGitHub(WORKFLOWS_GITHUB_ROUTES.catalog, decodeRemoteWorkflowGitHubCatalog, {}),
      githubOptions: (input) => postGitHub(WORKFLOWS_GITHUB_ROUTES.options, decodeRemoteWorkflowGitHubOptions, input),
      githubHistory: (workflowId) =>
        postGitHub(WORKFLOWS_GITHUB_ROUTES.history, decodeRemoteWorkflowGitHubHistory, { workflowId }),
      githubRunLastEvent: (input) =>
        postGitHub(WORKFLOWS_GITHUB_ROUTES.runLastEvent, decodeRemoteWorkflowRunDetail, input),
      keepPicture: (draftId) => postMedia(WORKFLOWS_MEDIA_ROUTES.keepPicture, decodeRemoteWorkflowPicture, { draftId }),
    },
    onChanged(changed) {
      const events = options.onHostEvent((event) => {
        // A joined server does not name the agent of the change.
        if (event.type === "workflows-changed") changed(event.workflowId);
        else if (event.type === "agent-access-changed") changed(null);
      });
      const reconnect = options.onReconnect(() => changed(null));
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
      // As on desktop for a joined server: the role filter needs the host's Discord roles, which no
      // Team API route sends.
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
          // The rows show their own "#" icon.
          channels: option.places.map((place) => ({ id: place.id, name: place.name.replace(/^#/u, "") })),
        }));
    },
    async agentLevels() {
      // A host without `agent-access-v1` has no levels per agent: a member uses each agent it sees.
      if (options.admin() || !has(AGENT_ACCESS_CAPABILITY)) return null;
      return (await run(getHostAgentAccess)).mine;
    },
    async pictures() {
      if (!has(WORKFLOWS_MEDIA_CAPABILITY) || !has(STORAGE_CAPABILITY)) return [];
      // The browser gets no preview address: the canvas reads each picture through `mediaUrl`.
      const usage = await run((request) => getStorageUsage(request, { scope: "host" }));
      return libraryPictures(usage).map((file) => ({ ...file, previewUrl: null }));
    },
    // The draft goes to the host as a chat attachment does; a draft that the host does not keep goes
    // away. The canvas reads the picture through `mediaUrl`.
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
    mediaUrl(attachmentId, kind) {
      const media = options.attachmentMedia;
      if (!media) return undefined;
      void media.load(mediaSummary(attachmentId, kind));
      return media.url(attachmentId);
    },
    githubConnector: options.githubConnector,
    hostName: options.hostName,
    openUrl: openWebLink,
  };
}
