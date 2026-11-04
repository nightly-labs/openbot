import {
  type AgentAccessLevels,
  MESSAGING_LIMITS,
  type OpenBotDesktopApi,
  type ServerSummary,
} from "@openbot/contracts/ipc";
import type {
  WorkflowDiscordServer,
  WorkflowPlace,
  WorkflowSlackWorkspace,
  WorkflowTelegramChat,
} from "@openbot/ui/features/workflows/workflow-model";
import {
  type GitHubConnectorPort,
  githubConnectorPort,
  hostGitHubConnectorPort,
} from "../connectors/github-connector-port";
import { serverRoleCanAdminister, serverSupportsCapability } from "../servers/server-capabilities";

type WorkflowsApi = OpenBotDesktopApi["workflows"];
/** The methods that take only the server. */
type NoInputMethod = "list" | "githubCatalog";
/** Each method with its input only; `list` and `githubCatalog` take none. */
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
  /** Only this computer keeps messaging places; a joined server gives none. */
  places(): Promise<WorkflowPlace[]>;
  /** Only this computer runs Discord triggers and outputs; a joined server gives none. */
  discordServers(): Promise<WorkflowDiscordServer[]>;
  /** Only this computer runs Telegram triggers and outputs; a joined server gives none. */
  telegramChats(): Promise<WorkflowTelegramChat[]>;
  /** Only this computer runs Slack triggers and outputs; a joined server gives none. */
  slackWorkspaces(): Promise<WorkflowSlackWorkspace[]>;
  /** The level of this account on each agent that it sees, or null when it manages all of them. */
  agentLevels(): Promise<AgentAccessLevels | null>;
  /**
   * Whether the host runs GitHub triggers and outputs: this computer always, and a joined server only
   * when it advertises `workflows-github-v1`.
   */
  githubSupported(): boolean;
  /** The GitHub connection that the host's GitHub triggers and outputs use. */
  githubConnector: GitHubConnectorPort;
  /** The joined server, as its server row names it, or undefined for this computer. */
  hostName(): string | undefined;
  /** Opens an http or https page in the browser. */
  openUrl(url: string): Promise<void>;
}

/**
 * The desktop adapter for one server. `window.openbot` and `server` are read on each call: tests and
 * stories replace them per case, and a role can change.
 */
export function desktopWorkflowHost(serverId: string, server: () => ServerSummary | undefined): WorkflowHost {
  const api = () => window.openbot.workflows;
  /** A server that has not loaded yet is this computer, as the page reads it. */
  const local = () => server()?.kind !== "remote";
  const githubSupported = () => serverSupportsCapability(server(), "workflows-github-v1");
  // A joined server without GitHub workflows gets no call: its port rejects before main.
  const hostGitHub = hostGitHubConnectorPort(() => (githubSupported() ? serverId : undefined));
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
      if (!local()) return [];
      const connections = await window.openbot.routineResults.options();
      return connections.flatMap((connection) =>
        connection.places.map((place) => ({
          connectionId: connection.connectionId,
          placeId: place.id,
          label: `${connection.connectionName} · ${place.name}`,
        })),
      );
    },
    async discordServers() {
      if (!local()) return [];
      const [options, overview] = await Promise.all([
        window.openbot.routineResults.options(),
        window.openbot.messaging.getDiscordOverview(),
      ]);
      const discord = options.filter((option) => option.platform === "discord");
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
      if (!local()) return [];
      const options = await window.openbot.routineResults.options();
      return options
        .filter((option) => option.platform === "telegram")
        .map((option) => ({ connectionId: option.connectionId, name: option.connectionName }));
    },
    async slackWorkspaces() {
      if (!local()) return [];
      const options = await window.openbot.routineResults.options();
      return options
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
    githubSupported,
    get githubConnector() {
      return local() ? githubConnectorPort() : hostGitHub;
    },
    hostName: () => (local() ? undefined : server()?.name),
    openUrl: (url) => window.openbot.openUrl(url),
  };
}
