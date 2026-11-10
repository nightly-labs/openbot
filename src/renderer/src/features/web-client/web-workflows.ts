// The Workflows page of the joined server in the browser client. The host serves the workflows
// through `workflows-v1`, and the GitHub catalog, options, history and last-event runs through
// `workflows-github-v1`. The targets of an output use the same capabilities as on desktop.

import type { AgentEvent, TeamRealtimeEvent } from "@openbot/contracts/ipc";
import { AGENT_ACCESS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-access-v1";
import { ROUTINE_RESULTS_CAPABILITY } from "@openbot/contracts/team-protocol/routine-results-v1";
import { decodeTeamProtocolV2Json } from "@openbot/contracts/team-protocol/v2";
import { WORKFLOWS_CHANNELS_CAPABILITY } from "@openbot/contracts/team-protocol/workflows-channels-v1";
import { WORKFLOWS_CHATS_CAPABILITY } from "@openbot/contracts/team-protocol/workflows-chats-v1";
import {
  WORKFLOWS_GITHUB_CAPABILITY,
  WORKFLOWS_GITHUB_ROUTES,
} from "@openbot/contracts/team-protocol/workflows-github-v1";
import { WORKFLOWS_CAPABILITY, WORKFLOWS_ROUTES } from "@openbot/contracts/team-protocol/workflows-v1";
import { runTeamEffect } from "@openbot/team-client";
import {
  getHostAgentAccess,
  listRoutineResultOptions,
  type TeamAdminRequestError,
} from "@openbot/team-client/team-admin-requests";
import { type TeamApiRequest, teamChannelsApi } from "@openbot/team-client/team-api-requests";
import {
  decodeRemoteWorkflowDetail,
  decodeRemoteWorkflowGitHubCatalog,
  decodeRemoteWorkflowGitHubHistory,
  decodeRemoteWorkflowGitHubOptions,
  decodeRemoteWorkflowList,
  decodeRemoteWorkflowRunDetail,
  decodeRemoteWorkflowRunPage,
  decodeRemoteWorkflowSaveResult,
  decodeRemoteWorkflowSecret,
  decodeRemoteWorkflowStep,
  decodeRemoteWorkflowSummary,
  decodeRemoteWorkflowVersionGraph,
  decodeRemoteWorkflowVersions,
} from "@openbot/team-client/workflow-decoding";
import { currentText } from "@openbot/ui/text";
import { Effect } from "effect";
import type { GitHubConnectorPort } from "../connectors/github-connector-port";
import type { WorkflowHost } from "../workflows/workflows-port";
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
    githubSupported,
    githubConnector: options.githubConnector,
    hostName: options.hostName,
    openUrl: openWebLink,
  };
}
