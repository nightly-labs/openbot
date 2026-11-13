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
  type WorkflowMediaKind,
} from "@openbot/contracts/ipc";
import { WORKFLOWS_MEDIA_ACCOUNT_CAPABILITY } from "@openbot/contracts/team-protocol/workflows-media-account-v1";
import { WORKFLOWS_MEDIA_TRANSPARENT_CAPABILITY } from "@openbot/contracts/team-protocol/workflows-media-transparent-v1";
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
/** The methods that take only the server. */
type NoInputMethod = "list" | "githubCatalog" | "mediaProviders" | "mediaCredits";
/** Each method with its input only; `list`, `githubCatalog`, `mediaProviders` and `mediaCredits` take none. */
type BoundWorkflowsApi = {
  [Name in Exclude<keyof WorkflowsApi, NoInputMethod>]: (
    input: Parameters<WorkflowsApi[Name]>[0],
  ) => ReturnType<WorkflowsApi[Name]>;
} & { [Name in NoInputMethod]: () => ReturnType<WorkflowsApi[Name]> };

/**
 * What the Workflows page reaches on one server: the workflows, the changes that make one stale, and
 * the messaging places an output can post to. The desktop app reaches this computer or a joined
 * server through main.
 */
export interface WorkflowHost {
  /** Called without a server: the host already names one. */
  workflows: BoundWorkflowsApi;
  /**
   * Calls `changed` with the workflow that changed, or null when all can be stale: the server came
   * back, or the agent levels changed. `agentId`: the agent whose tool call made or saved the
   * workflow. Only this computer names it; a joined server does not.
   */
  onChanged(changed: (workflowId: string | null, agentId?: string) => void): () => void;
  /**
   * The messaging places that an output can post to: this computer's, or a joined server's for an owner
   * or admin when the host serves `routine-results-v1`. A member gets none, as the host lets only an
   * owner or admin choose a place.
   */
  places(): Promise<WorkflowPlace[]>;
  /**
   * The open channels that an output can post to: this computer's, or a joined server's for an owner
   * or admin when the host serves `workflows-channels-v1`.
   */
  channels(): Promise<WorkflowChannel[]>;
  /**
   * Only this computer runs Discord triggers and outputs; a joined server gives none. A Discord node
   * filters by role, and no Team API route sends the host's Discord roles (`workflows-chats-v1`).
   */
  discordServers(): Promise<WorkflowDiscordServer[]>;
  /**
   * The Telegram chats of triggers and outputs: this computer's, or a joined server's for an owner or
   * admin when the host serves `workflows-chats-v1` and `routine-results-v1`.
   */
  telegramChats(): Promise<WorkflowTelegramChat[]>;
  /** The Slack workspaces of triggers and outputs, with the same gate as `telegramChats`. */
  slackWorkspaces(): Promise<WorkflowSlackWorkspace[]>;
  /** The level of this account on each agent that it sees, or null when it manages all of them. */
  agentLevels(): Promise<AgentAccessLevels | null>;
  /**
   * Whether the host runs GitHub triggers and outputs: this computer always, and a joined server only
   * when it advertises `workflows-github-v1`.
   */
  githubSupported(): boolean;
  /**
   * Whether the host runs image and video steps: this computer always, and a joined server only when
   * it advertises `workflows-media-v1`.
   */
  mediaSupported(): boolean;
  /**
   * Whether the host makes an image or a video on the account that the step chooses: this computer
   * always, and a joined server only when it advertises `workflows-media-account-v1`. An older host
   * makes each file on the provider's own sign-in.
   */
  mediaAccountSupported(): boolean;
  /**
   * Whether an image step can have a transparent background: this computer always, and a joined
   * server only when it advertises `workflows-media-transparent-v1`. An older host makes the image
   * with the model's own background.
   */
  mediaTransparentSupported(): boolean;
  /**
   * The pictures of the host's Library that an asset step can use: this computer's, or a joined
   * server's when it serves `storage-v1`. The host gives a member only the files of the agents that
   * they see. A host without image and video steps gives none.
   */
  pictures(): Promise<readonly StoredFileRow[]>;
  /**
   * Sends a PNG, JPEG or WebP picture from this computer to the host, which keeps it with no owner
   * agent, and answers it as a Library file. Only a host with image and video steps keeps one.
   */
  uploadPicture(file: File): Promise<StoredFileRow>;
  /** The address of an image or a video that a media step made, from its attachment id. */
  mediaUrl(attachmentId: string, kind: WorkflowMediaKind): string | undefined;
  /** The GitHub connection that the host's GitHub triggers and outputs use. */
  githubConnector: GitHubConnectorPort;
  /** The joined server, as its server row names it, or undefined for this computer. */
  hostName(): string | undefined;
  /** Opens an http or https page in the browser. */
  openUrl(url: string): Promise<void>;
}

/** The pictures of a Library scan that the host can send to an image or video model. */
export function libraryPictures(usage: StorageUsage | null): readonly StoredFileRow[] {
  return (usage?.files ?? []).filter(
    (file) => file.status === "available" && WORKFLOW_PICTURE_TYPES.has(file.mimeType),
  );
}

/** Refuses a file that the host does not keep as a picture, before its bytes come into memory. */
export function checkPicture(file: File, maxBytes: number): void {
  const { t } = currentText();
  if (!WORKFLOW_PICTURE_TYPES.has(file.type)) throw new Error(t("error.workflow.pictureType"));
  if (file.size > maxBytes) throw new Error(t("error.attachment.fileTooLarge"));
}

/** The Library row of a picture that the host kept from `file`. */
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

/**
 * The desktop adapter for one server. `window.openbot` and `server` are read on each call: tests and
 * stories replace them per case, and a role can change.
 */
/** The media credits of one server: this computer, or a joined server through main. */
export function desktopMediaCredits(serverId: string) {
  return window.openbot.workflows.mediaCredits(serverId);
}

export function desktopWorkflowHost(serverId: string, server: () => ServerSummary | undefined): WorkflowHost {
  const api = () => window.openbot.workflows;
  /** A server that has not loaded yet is this computer, as the page reads it. */
  const local = () => server()?.kind !== "remote";
  /** A joined server lets only an owner or admin read its connections (`routine-results-v1`). */
  const placesSupported = () => local() || serverCanAdminister(server(), "routine-results-v1");
  /** The host runs Telegram and Slack nodes, and their chats and workspaces come from its connections. */
  const chatsSupported = () => local() || (placesSupported() && serverCanAdminister(server(), "workflows-chats-v1"));
  const channelsSupported = () => local() || serverCanAdminister(server(), "workflows-channels-v1");
  const options = () => window.openbot.routineResults.options(serverId);
  const githubSupported = () => serverSupportsCapability(server(), "workflows-github-v1");
  const mediaSupported = () => local() || serverSupportsCapability(server(), "workflows-media-v1");
  const mediaAccountSupported = () =>
    mediaSupported() && (local() || serverSupportsCapability(server(), WORKFLOWS_MEDIA_ACCOUNT_CAPABILITY));
  const mediaTransparentSupported = () =>
    mediaSupported() && (local() || serverSupportsCapability(server(), WORKFLOWS_MEDIA_TRANSPARENT_CAPABILITY));
  // A joined server without GitHub workflows gets no call: its port rejects before main.
  const hostGitHub = hostGitHubConnectorPort(() => (githubSupported() ? serverId : undefined));
  // A joined server's attachment comes through main, which downloads it from the host.
  const mediaUrl = (attachmentId: string) =>
    local()
      ? `openbot-attachment://file/${encodeURIComponent(attachmentId)}`
      : `openbot-remote-attachment://${encodeURIComponent(serverId)}/${encodeURIComponent(attachmentId)}`;
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
      rotateWebhookSecret: (input) => api().rotateWebhookSecret(input, serverId),
      githubCatalog: () => api().githubCatalog(serverId),
      githubOptions: (input) => api().githubOptions(input, serverId),
      githubHistory: (workflowId) => api().githubHistory(workflowId, serverId),
      githubRunLastEvent: (input) => api().githubRunLastEvent(input, serverId),
      keepPicture: (draftId) => api().keepPicture(draftId, serverId),
      // Main answers `{ sunra: false }` for a joined server without `workflows-sunra-v1`.
      mediaProviders: () => api().mediaProviders(serverId),
      // Main answers `{ sunra: null }` for a joined server without `workflows-sunra-v1`.
      mediaCredits: () => api().mediaCredits(serverId),
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
      // Local only: the role filter needs the host's Discord roles, which no Team API route sends.
      if (!local()) return [];
      const [connections, overview] = await Promise.all([options(), window.openbot.messaging.getDiscordOverview()]);
      const discord = connections.filter((option) => option.platform === "discord");
      return Promise.all(
        discord.map(async (option) => {
          // The options name a server only by its name; two servers with one name get no roles.
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
            // The driver names a channel "#general"; the Discord rows show their own "#" icon.
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
          // The rows show their own "#" icon.
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
    // The draft goes to the host as a chat attachment does; a draft that the host does not keep goes away.
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
    mediaUrl,
    get githubConnector() {
      return local() ? githubConnectorPort() : hostGitHub;
    },
    hostName: () => (local() ? undefined : server()?.name),
    openUrl: (url) => window.openbot.openUrl(url),
  };
}
