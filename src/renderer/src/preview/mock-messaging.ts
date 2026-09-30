import type {
  MessagingConnection,
  MessagingDesktopApi,
  MessagingOverview,
  MessagingThread,
  SlackWorkspace,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { clone } from "./mock-support";

const PREVIEW_THREADS: MessagingThread[] = [
  {
    linkId: "mock-slack-thread-release",
    title: "#launch · Can you check the release notes?",
    messages: [
      {
        id: "mock-slack-message-1",
        role: "external",
        authorName: "Ada",
        text: "Can you check the release notes for typos?",
        createdAt: "2026-09-29T09:00:00.000Z",
      },
      {
        id: "mock-slack-message-2",
        role: "agent",
        authorName: null,
        text: "I found two typos in the Added section and fixed them in the draft.",
        createdAt: "2026-09-29T09:01:30.000Z",
      },
    ],
  },
  {
    linkId: "mock-slack-thread-direct",
    title: "Grace",
    messages: [
      {
        id: "mock-slack-message-3",
        role: "external",
        authorName: "Grace",
        text: "What is on the board for today?",
        createdAt: "2026-09-29T10:15:00.000Z",
      },
    ],
  },
];

const PREVIEW_WORKSPACE: SlackWorkspace = { workspaceId: "T0PREVIEW", name: "Preview workspace" };

/**
 * The Slack connection of each preview agent. Connecting Slack connects a preview workspace. Adding
 * an agent creates an app that waits for its install, and opening the install page connects it to
 * a workspace that already has two conversations.
 */
export function createMockMessaging(agentName: (agentId: string) => string | undefined): MessagingDesktopApi {
  const connections = new Map<string, MessagingConnection>();
  const workspaces = new Map<string, SlackWorkspace>();
  const requireAgent = (agentId: string) => {
    const name = agentName(agentId);
    if (!name) throw new Error(sourceText("error.team.agentNotFound"));
    return name;
  };
  const overview = (agentId: string): MessagingOverview => {
    requireAgent(agentId);
    const connection = connections.get(agentId) ?? null;
    return clone({
      connection,
      threads:
        connection?.credentials === "saved"
          ? PREVIEW_THREADS.map((thread, index) => ({
              linkId: thread.linkId,
              title: thread.title,
              isDirect: index === 1,
              updatedAt: thread.messages.at(-1)?.createdAt ?? "2026-09-29T09:00:00.000Z",
            }))
          : [],
      slackWorkspaces: [...workspaces.values()],
    });
  };
  const change = (agentId: string, update: Partial<MessagingConnection>): MessagingOverview => {
    const current = connections.get(agentId);
    if (!current) throw new Error(sourceText("error.messaging.notConnected"));
    connections.set(agentId, { ...current, ...update });
    return overview(agentId);
  };
  return {
    getOverview: async ({ agentId }) => overview(agentId),
    reconnect: async ({ agentId }) => change(agentId, { enabled: true, state: "connected" }),
    setEnabled: async ({ agentId, enabled }) => change(agentId, { enabled, state: enabled ? "connected" : "paused" }),
    disconnect: async ({ agentId }) =>
      change(agentId, {
        enabled: false,
        state: "paused",
        workspaceName: null,
        botUserId: null,
        credentials: "missing",
      }),
    readThread: async ({ agentId, linkId }) => {
      requireAgent(agentId);
      const thread = PREVIEW_THREADS.find((candidate) => candidate.linkId === linkId);
      if (!thread || connections.get(agentId)?.credentials !== "saved")
        throw new Error(sourceText("error.messaging.threadNotFound"));
      return clone(thread);
    },
    getSlackOverview: async () =>
      clone({
        connections: [...connections.values()].filter((connection) => agentName(connection.agentId)),
        workspaces: [...workspaces.values()],
      }),
    connectSlackWorkspace: async () => {
      workspaces.set(PREVIEW_WORKSPACE.workspaceId, PREVIEW_WORKSPACE);
    },
    disconnectSlackWorkspace: async ({ workspaceId }) => {
      workspaces.delete(workspaceId);
    },
    createSlackApp: async ({ agentId, workspaceId }) => {
      requireAgent(agentId);
      const workspace = workspaces.get(workspaceId);
      if (!workspace) throw new Error(sourceText("error.messaging.workspaceNotConnected"));
      connections.set(agentId, {
        agentId,
        platform: "slack",
        enabled: true,
        state: "awaiting_install",
        workspaceName: workspace.name,
        botUserId: null,
        missingScopes: [],
        retryAt: null,
        credentials: "saved",
      });
      return overview(agentId);
    },
    setSlackIcon: async ({ agentId }) => {
      requireAgent(agentId);
    },
    openSlackInstall: async ({ agentId }) => {
      change(agentId, { state: "connected", botUserId: "U0PREVIEW" });
    },
  };
}
