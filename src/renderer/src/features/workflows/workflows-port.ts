import { ATTACHMENT_LIMITS } from "@openbot/contracts/input-limits";
import {
  type AgentAccessLevels,
  MESSAGING_LIMITS,
  type OpenBotDesktopApi,
  type ServerSummary,
  STORAGE_CAPABILITY,
  type StorageUsage,
  type StoredFileRow,
  WORKFLOW_PICTURE_TYPES,
  type WorkflowFolderAction,
  type WorkflowFoldersSnapshot,
  type WorkflowMediaKind,
} from "@openbot/contracts/ipc";
import { ATTACHMENT_PREVIEW_CAPABILITY } from "@openbot/contracts/team-protocol/attachment-preview-v1";
import { WORKFLOW_FOLDERS_CAPABILITY } from "@openbot/contracts/team-protocol/workflow-folders-v1";
import { WORKFLOWS_AGENT_FILES_CAPABILITY } from "@openbot/contracts/team-protocol/workflows-agent-files-v1";
import { WORKFLOWS_MEDIA_ACCOUNT_CAPABILITY } from "@openbot/contracts/team-protocol/workflows-media-account-v1";
import { WORKFLOWS_MEDIA_SIZE_CAPABILITY } from "@openbot/contracts/team-protocol/workflows-media-size-v1";
import { WORKFLOWS_MEDIA_TRANSPARENT_CAPABILITY } from "@openbot/contracts/team-protocol/workflows-media-transparent-v1";
import { WORKFLOWS_STEP_SETTINGS_CAPABILITY } from "@openbot/contracts/team-protocol/workflows-step-settings-v1";
import type {
  WorkflowChannel,
  WorkflowDiscordServer,
  WorkflowPlace,
  WorkflowSlackWorkspace,
  WorkflowTelegramChat,
} from "@openbot/ui/features/workflows/workflow-model";
import { currentText } from "@openbot/ui/text";
import {
  type GitHubConnectorPort,
  githubConnectorPort,
  hostGitHubConnectorPort,
} from "../connectors/github-connector-port";
import { serverCanAdminister, serverRoleCanAdminister, serverSupportsCapability } from "../servers/server-capabilities";

type WorkflowsApi = OpenBotDesktopApi["workflows"];
type NoInputMethod = "list" | "githubCatalog" | "mediaProviders" | "mediaCredits" | "mediaCatalog" | "folders";
type BoundWorkflowsApi = {
  [Name in Exclude<keyof WorkflowsApi, NoInputMethod>]: (
    input: Parameters<WorkflowsApi[Name]>[0],
  ) => ReturnType<WorkflowsApi[Name]>;
} & { [Name in NoInputMethod]: () => ReturnType<WorkflowsApi[Name]> };

export interface WorkflowHost {
  workflows: BoundWorkflowsApi;
  onChanged(changed: (workflowId: string | null, agentId?: string) => void): () => void;
  places(): Promise<WorkflowPlace[]>;
  channels(): Promise<WorkflowChannel[]>;
  discordServers(): Promise<WorkflowDiscordServer[]>;
  telegramChats(): Promise<WorkflowTelegramChat[]>;
  slackWorkspaces(): Promise<WorkflowSlackWorkspace[]>;
  agentLevels(): Promise<AgentAccessLevels | null>;
  githubSupported(): boolean;
  mediaSupported(): boolean;
  mediaAccountSupported(): boolean;
  mediaTransparentSupported(): boolean;
  mediaSizeSupported(): boolean;
  agentFilesSupported(): boolean;
  stepSettingsSupported(): boolean;
  foldersSupported(): boolean;
  folders(): Promise<WorkflowFoldersSnapshot>;
  folderAction(action: WorkflowFolderAction): Promise<WorkflowFoldersSnapshot>;
  onFoldersChanged(changed: () => void): () => void;
  pictures(): Promise<readonly StoredFileRow[]>;
  uploadPicture(file: File): Promise<StoredFileRow>;
  mediaUrl(attachmentId: string, kind: WorkflowMediaKind): string | null | undefined;
  mediaPreviewUrl(attachmentId: string): string | null | undefined;
  githubConnector: GitHubConnectorPort;
  hostName(): string | undefined;
  openUrl(url: string): Promise<void>;
}

export function libraryPictures(usage: StorageUsage | null): readonly StoredFileRow[] {
  return (usage?.files ?? [])
    .filter((file) => file.status === "available" && WORKFLOW_PICTURE_TYPES.has(file.mimeType))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function checkPicture(file: File, maxBytes: number): void {
  const { t } = currentText();
  if (!WORKFLOW_PICTURE_TYPES.has(file.type)) throw new Error(t("error.workflow.pictureType"));
  if (file.size > maxBytes) throw new Error(t("error.attachment.fileTooLarge"));
}

export function keptPicture(fileId: string, file: File, previewUrl: string | null): StoredFileRow {
  return {
    id: fileId,
    name: file.name,
    size: file.size,
    kind: "image",
    mimeType: file.type,
    previewKind: "image",
    previewUrl,
    source: "generated",
    agentId: null,
    conversation: null,
    messageId: null,
    createdAt: new Date().toISOString(),
    status: "available",
    deletable: true,
  };
}

export function desktopMediaCredits(serverId: string) {
  return window.openbot.workflows.mediaCredits(serverId);
}

export function desktopWorkflowHost(serverId: string, server: () => ServerSummary | undefined): WorkflowHost {
  const api = () => window.openbot.workflows;
  const local = () => server()?.kind !== "remote";
  const placesSupported = () => local() || serverCanAdminister(server(), "routine-results-v1");
  const chatsSupported = () => local() || (placesSupported() && serverCanAdminister(server(), "workflows-chats-v1"));
  const channelsSupported = () => local() || serverCanAdminister(server(), "workflows-channels-v1");
  let optionsCall: ReturnType<OpenBotDesktopApi["routineResults"]["options"]> | undefined;
  const options = () => {
    optionsCall ??= window.openbot.routineResults.options(serverId).finally(() => {
      optionsCall = undefined;
    });
    return optionsCall;
  };
  const githubSupported = () => serverSupportsCapability(server(), "workflows-github-v1");
  const mediaSupported = () => local() || serverSupportsCapability(server(), "workflows-media-v1");
  const mediaAccountSupported = () =>
    mediaSupported() && (local() || serverSupportsCapability(server(), WORKFLOWS_MEDIA_ACCOUNT_CAPABILITY));
  const mediaTransparentSupported = () =>
    mediaSupported() && (local() || serverSupportsCapability(server(), WORKFLOWS_MEDIA_TRANSPARENT_CAPABILITY));
  const mediaSizeSupported = () =>
    mediaSupported() && (local() || serverSupportsCapability(server(), WORKFLOWS_MEDIA_SIZE_CAPABILITY));
  const agentFilesSupported = () => local() || serverSupportsCapability(server(), WORKFLOWS_AGENT_FILES_CAPABILITY);
  const foldersSupported = () => local() || serverSupportsCapability(server(), WORKFLOW_FOLDERS_CAPABILITY);
  const hostGitHub = hostGitHubConnectorPort(() => (githubSupported() ? serverId : undefined));
  const mediaUrl = (attachmentId: string) =>
    local()
      ? `openbot-attachment://file/${encodeURIComponent(attachmentId)}`
      : `openbot-remote-attachment://${encodeURIComponent(serverId)}/${encodeURIComponent(attachmentId)}`;
  const mediaPreviewUrl = (attachmentId: string) =>
    !local() && serverSupportsCapability(server(), ATTACHMENT_PREVIEW_CAPABILITY)
      ? `${mediaUrl(attachmentId)}?preview=1`
      : mediaUrl(attachmentId);
  return {
    workflows: {
      list: () => api().list(serverId),
      get: (workflowId) => api().get(workflowId, serverId),
      create: (input) => api().create(input, serverId),
      rename: (input) => api().rename(input, serverId),
      delete: (workflowId) => api().delete(workflowId, serverId),
      saveGraph: (input) => api().saveGraph(input, serverId),
      versions: (workflowId) => api().versions(workflowId, serverId),
      versionGraph: (input) => api().versionGraph(input, serverId),
      restoreVersion: (input) => api().restoreVersion(input, serverId),
      startRun: (input) => api().startRun(input, serverId),
      runStep: (input) => api().runStep(input, serverId),
      stopStep: (stepId) => api().stopStep(stepId, serverId),
      stopRun: (runId) => api().stopRun(runId, serverId),
      retryStep: (input) => api().retryStep(input, serverId),
      decide: (input) => api().decide(input, serverId),
      runs: (input) => api().runs(input, serverId),
      run: (runId) => api().run(runId, serverId),
      stepSettings: (stepId) => api().stepSettings(stepId, serverId),
      rotateWebhookSecret: (input) => api().rotateWebhookSecret(input, serverId),
      githubCatalog: () => api().githubCatalog(serverId),
      githubOptions: (input) => api().githubOptions(input, serverId),
      githubHistory: (workflowId) => api().githubHistory(workflowId, serverId),
      githubRunLastEvent: (input) => api().githubRunLastEvent(input, serverId),
      keepPicture: (draftId) => api().keepPicture(draftId, serverId),
      mediaProviders: () => api().mediaProviders(serverId),
      mediaCredits: () => api().mediaCredits(serverId),
      mediaCatalog: () => api().mediaCatalog(serverId),
      mediaPrice: (input) => api().mediaPrice(input, serverId),
      folders: () => api().folders(serverId),
      folderAction: (action) => api().folderAction(action, serverId),
    },
    onChanged(changed) {
      const unsubscribe = window.openbot.agent.onScopedEvent((scoped) => {
        if (scoped.serverId !== serverId) return;
        if (scoped.event.type === "workflows-changed") changed(scoped.event.workflowId, scoped.event.agentId);
        else if (scoped.event.type === "agent-access-changed") changed(null);
      });
      const reconnect = window.openbot.servers.onEvent((servers) => {
        if (servers.some((server) => server.id === serverId && server.state === "online")) changed(null);
      });
      return () => {
        unsubscribe();
        reconnect();
      };
    },
    foldersSupported,
    folders: () => api().folders(serverId),
    folderAction: (action) => api().folderAction(action, serverId),
    onFoldersChanged(changed) {
      const unsubscribe = window.openbot.agent.onScopedEvent((scoped) => {
        if (scoped.serverId === serverId && scoped.event.type === "workflow-folders-changed") changed();
      });
      const reconnect = window.openbot.servers.onEvent((servers) => {
        if (servers.some((server) => server.id === serverId && server.state === "online")) changed();
      });
      return () => {
        unsubscribe();
        reconnect();
      };
    },
    async places() {
      if (!placesSupported()) return [];
      const connections = await options();
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
      const channels = await window.openbot.agent.listChannels(serverId);
      return channels.filter((channel) => !channel.archived).map((channel) => ({ id: channel.id, name: channel.name }));
    },
    async discordServers() {
      if (!local()) return [];
      const [connections, overview] = await Promise.all([options(), window.openbot.messaging.getDiscordOverview()]);
      const discord = connections.filter((option) => option.platform === "discord");
      return Promise.all(
        discord.map(async (option) => {
          const guilds = overview.connections.filter(
            (connection) => connection.workspaceName.slice(0, MESSAGING_LIMITS.name) === option.connectionName,
          );
          const guild = guilds.length === 1 ? guilds[0] : undefined;
          const roles = guild
            ? await window.openbot.messaging.listDiscordRoles({ workspaceId: guild.workspaceId }).then(
                (list) => list.roles,
                () => [],
              )
            : [];
          return {
            connectionId: option.connectionId,
            name: option.connectionName,
            channels: option.places.map((place) => ({ id: place.id, name: place.name.replace(/^#/u, "") })),
            roles,
          };
        }),
      );
    },
    async telegramChats() {
      if (!chatsSupported()) return [];
      return (await options())
        .filter((option) => option.platform === "telegram")
        .map((option) => ({ connectionId: option.connectionId, name: option.connectionName }));
    },
    async slackWorkspaces() {
      if (!chatsSupported()) return [];
      return (await options())
        .filter((option) => option.platform === "slack")
        .map((option) => ({
          connectionId: option.connectionId,
          name: option.connectionName,
          channels: option.places.map((place) => ({ id: place.id, name: place.name.replace(/^#/u, "") })),
        }));
    },
    async agentLevels() {
      if (local() || serverRoleCanAdminister(server())) return null;
      return (await window.openbot.hostAdmin.getAgentAccess(serverId)).mine;
    },
    async pictures() {
      if (!mediaSupported() || !(local() || serverSupportsCapability(server(), STORAGE_CAPABILITY))) return [];
      return libraryPictures(await window.openbot.storage.getUsage({ scope: "host" }, serverId));
    },
    async uploadPicture(file) {
      checkPicture(file, ATTACHMENT_LIMITS.fileBytes);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const [draft] = await window.openbot.agent.importAttachmentData(
        [{ name: file.name, mimeType: file.type, bytes }],
        serverId,
      );
      if (!draft) throw new Error(currentText().t("error.workflow.pictureMissing"));
      const fileId = await api()
        .keepPicture(draft.id, serverId)
        .catch(async (error: unknown) => {
          await window.openbot.agent.discardDraftAttachment(draft.id, serverId).catch(() => undefined);
          throw error;
        });
      return keptPicture(fileId, file, mediaUrl(fileId));
    },
    githubSupported,
    mediaSupported,
    mediaAccountSupported,
    mediaTransparentSupported,
    mediaSizeSupported,
    agentFilesSupported,
    stepSettingsSupported: () => local() || serverSupportsCapability(server(), WORKFLOWS_STEP_SETTINGS_CAPABILITY),
    mediaUrl,
    mediaPreviewUrl,
    get githubConnector() {
      return local() ? githubConnectorPort() : hostGitHub;
    },
    hostName: () => (local() ? undefined : server()?.name),
    openUrl: (url) => window.openbot.openUrl(url),
  };
}
