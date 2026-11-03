import {
  type ConnectorMessagingPlatform,
  MESSAGING_LIMITS,
  type MessagingConnection,
  type MessagingOverview,
} from "@openbot/contracts/ipc";
import type { MessagingConnectorPage as HostPage } from "@openbot/team-client/team-admin-requests";
import type { UseQueryResult } from "@tanstack/react-query";
import { openAuthSessionAsync } from "expo-web-browser";
import { Typography } from "heroui-native";
import { Alert, Linking } from "react-native";
import { useUniwind } from "uniwind";
import { BloubAvatarThumbnail } from "@/features/agents/components/bloub-avatar";
import { ConnectorError, ConnectorHeader } from "@/features/servers/components/connector-header";
import {
  attentionCount,
  CONNECTOR_STATUS_KEYS,
  connectionKind,
  isTelegramGroup,
  MESSAGING_INSTALL_RETURN,
  MESSAGING_TEXT,
  messagingInstallGrant,
  messagingStatus,
  platformPage,
  telegramOrchestrator,
  type WorkspacePlatform,
  workspaceOrchestrator,
} from "@/features/servers/model/connectors";
import { useConnectorAction } from "@/features/servers/model/use-server-connectors";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { SettingsSwitch } from "@/features/settings/components/settings-controls";
import { useMobileWorkspaceActions } from "@/features/workspace/context/mobile-workspace-context";
import type { MobileAgent, MobileServer } from "@/features/workspace/model/workspace-types";
import { currentText, type MobileText, useText } from "@/shared/lib/text";

const KIND_KEYS = {
  live: "mobile.server.connectors.statusConnected",
  paused: "mobile.server.connectors.statusPaused",
  setup: "mobile.server.connectors.statusConnecting",
  attention: "mobile.server.connectors.statusAttention",
} as const;

const TITLE_KEYS = {
  slack: "mobile.server.connectors.slack.title",
  discord: "mobile.server.connectors.discord.title",
  telegram: "mobile.server.connectors.telegram.title",
} as const;

const AVATAR_SIZE = 32;

/** What to do about a stopped connection, or null for a state that shows the connection's description. */
function connectionHelp(
  { t }: MobileText,
  platform: ConnectorMessagingPlatform,
  state: MessagingConnection["state"],
  host: string,
): string | null {
  if (platform === "telegram")
    switch (state) {
      case "removed":
        return t("mobile.server.connectors.telegram.helpRemoved");
      case "relay_unavailable":
        return t("mobile.server.connectors.telegram.helpRelay", { host });
      case "invalid_token":
      case "secret_storage_unavailable":
      case "error":
        return t("mobile.server.connectors.telegram.helpError");
      default:
        return null;
    }
  const slack = platform === "slack";
  switch (state) {
    case "invalid_token":
      return t(
        slack ? "mobile.server.connectors.slack.helpInvalidToken" : "mobile.server.connectors.discord.helpInvalidToken",
      );
    case "secret_storage_unavailable":
      return t(
        slack
          ? "mobile.server.connectors.slack.helpSecretStorage"
          : "mobile.server.connectors.discord.helpSecretStorage",
        { host },
      );
    case "relay_unavailable":
      return t(slack ? "mobile.server.connectors.slack.helpRelay" : "mobile.server.connectors.discord.helpRelay", {
        host,
      });
    default:
      return null;
  }
}

function isWorkspacePlatform(platform: ConnectorMessagingPlatform): platform is WorkspacePlatform {
  return platform !== "telegram";
}

/**
 * Opens the platform's page that the host named. A Slack or Discord install returns to an
 * `openbot://` link with a grant that is sealed to the host; the browser session gives it back here,
 * and the phone sends it on. A Telegram link opens Telegram, and the chat shows when it is linked.
 * Resolves false when the user closed the browser.
 */
async function openHostPage(
  platform: ConnectorMessagingPlatform,
  page: HostPage,
  /** Resolves false when the host refused the grant, such as after its install key expired. */
  complete: (grant: { nonce: string; grant: string }) => Promise<boolean>,
): Promise<boolean> {
  if (page.url === null) return true;
  const address = platformPage(platform, page.url);
  const text = currentText();
  if (!address) throw new Error(text.t("mobile.server.connectors.openFailed"));
  if (!isWorkspacePlatform(platform)) {
    await Linking.openURL(address);
    return true;
  }
  if (!page.nonce) throw new Error(text.t(MESSAGING_TEXT[platform].installFailed));
  const result = await openAuthSessionAsync(address, MESSAGING_INSTALL_RETURN[platform]);
  if (result.type !== "success") return false;
  const grant = messagingInstallGrant(platform, result.url, page.nonce);
  if (!grant) throw new Error(text.t(MESSAGING_TEXT[platform].installFailed));
  if (!(await complete(grant))) throw new Error(text.t(MESSAGING_TEXT[platform].installFailed));
  return true;
}

/**
 * Server settings › Connectors › Slack, Discord or Telegram of a joined server. A Slack workspace or a
 * Discord server installs the one OpenBot app, and its orchestrator agent receives every request.
 * Every Telegram chat adds the one OpenBot bot and shares one orchestrator. No token reaches the phone.
 */
export function MessagingConnectorPage({
  server,
  platform,
  query,
  agents,
}: {
  server: MobileServer;
  platform: ConnectorMessagingPlatform;
  query: UseQueryResult<MessagingOverview>;
  agents: readonly MobileAgent[];
}) {
  const text = useText();
  const { t, format, errorMessage } = text;
  const { theme } = useUniwind();
  const {
    connectMessaging,
    completeMessagingInstall,
    reconnectMessaging,
    disconnectMessaging,
    setMessagingEnabled,
    addMessagingOrchestrator,
  } = useMobileWorkspaceActions();
  const action = useConnectorAction(query.refetch);
  const connections = query.data?.connections;
  const host = server.name;
  const title = t(TITLE_KEYS[platform]);
  if (!connections)
    return (
      <SettingsContent>
        <SettingsNote>
          {query.isError
            ? errorMessage(query.error, t("mobile.server.connectors.readFailed"))
            : t("mobile.server.connectors.loading")}
        </SettingsNote>
      </SettingsContent>
    );
  const workspace = isWorkspacePlatform(platform) ? MESSAGING_TEXT[platform] : null;
  const status = messagingStatus(platform, connections, agents);
  const attention = attentionCount(platform, connections, agents);
  const telegramAgent = workspace ? null : telegramOrchestrator(connections, agents);
  const orchestrator = (connection: MessagingConnection) =>
    workspace ? workspaceOrchestrator(connection, agents) : telegramAgent;
  /** Each orchestrator once. An earlier build gave each workspace its own; now they share one. */
  const orchestrators = [
    ...new Map(
      connections.flatMap((connection) => {
        const agent = orchestrator(connection);
        return agent ? [[agent.id, agent] as const] : [];
      }),
    ).values(),
  ];
  /** The first connection that no agent answers: Add agent creates its orchestrator. */
  const needsAgent = connections.find((connection) => !orchestrator(connection)) ?? null;
  const complete = (grant: { nonce: string; grant: string }) =>
    isWorkspacePlatform(platform)
      ? completeMessagingInstall({ platform, ...grant }, server.id)
      : Promise.resolve(false);

  const addAgent = (connection: MessagingConnection) =>
    void action.perform(async () => {
      await addMessagingOrchestrator({ platform, workspaceId: workspace ? connection.workspaceId : null }, server.id);
    });
  /** After a new workspace, the next step is its orchestrator, as in the desktop connect dialog. */
  const offerAgent = (connection: MessagingConnection) => {
    if (!workspace) return;
    Alert.alert(t(workspace.agentPromptTitle), t(workspace.agentPromptBody, { workspace: connection.workspaceName }), [
      { text: t("mobile.server.connectors.later"), style: "cancel" },
      { text: t("mobile.server.connectors.addAgent"), onPress: () => addAgent(connection) },
    ]);
  };
  const connect = (place: "group" | "direct" | null) => {
    const before = new Set(connections.map((connection) => connection.workspaceId));
    let installed = false;
    void action
      .perform(async () => {
        const page = await connectMessaging({ platform, place }, server.id);
        installed = (await openHostPage(platform, page, complete)) && workspace !== null;
      })
      .then(async (done) => {
        if (!done || !installed) return;
        const next = await query.refetch();
        const added = next.data?.connections.find(
          (connection) => !before.has(connection.workspaceId) && !workspaceOrchestrator(connection, agents),
        );
        if (added) offerAgent(added);
      });
  };
  const reconnect = (connection: MessagingConnection) =>
    void action.perform(async () => {
      const page = await reconnectMessaging({ platform, workspaceId: connection.workspaceId }, server.id);
      await openHostPage(platform, page, complete);
    });
  const disconnect = (connection: MessagingConnection) => {
    const agent = orchestrator(connection);
    // A disconnect deletes the orchestrator only when no other connection uses it.
    const deletes =
      agent !== null &&
      !connections.some(
        (other) =>
          other.workspaceId !== connection.workspaceId && (workspace ? other.orchestratorAgentId === agent.id : true),
      );
    const name = connection.workspaceName;
    const body = workspace
      ? t(workspace.disconnectBody, { workspace: name, host })
      : t("mobile.server.connectors.telegram.disconnectBody", { chat: name });
    const effect = workspace
      ? t(deletes ? workspace.disconnectDeleted : workspace.disconnectKept)
      : t(
          deletes
            ? "mobile.server.connectors.telegram.disconnectDeleted"
            : "mobile.server.connectors.telegram.disconnectKept",
        );
    Alert.alert(
      workspace
        ? t(workspace.disconnectTitle, { workspace: name })
        : t("mobile.server.connectors.telegram.disconnectTitle", { chat: name }),
      `${body}\n\n${effect}`,
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("mobile.server.connectors.disconnect"),
          style: "destructive",
          onPress: () =>
            void action.perform(async () => {
              await disconnectMessaging({ platform, workspaceId: connection.workspaceId }, server.id);
            }),
        },
      ],
    );
  };
  const note = (connection: MessagingConnection) => {
    if (workspace && connection.missingScopes.length > 0)
      return t(workspace.missingScopes, { scopes: format.list(connection.missingScopes) });
    if (connection.retryAt)
      return t(workspace ? workspace.retryAt : "mobile.server.connectors.telegram.retryAt", {
        time: format.date(new Date(connection.retryAt), { hour: "numeric", minute: "2-digit" }),
      });
    const help = connectionHelp(text, platform, connection.state, host);
    if (help) return help;
    if (workspace) return t(workspace.connectionDescription);
    return t(
      isTelegramGroup(connection)
        ? "mobile.server.connectors.telegram.groupDescription"
        : "mobile.server.connectors.telegram.directDescription",
    );
  };
  const failure = action.error
    ? errorMessage(action.error, t("mobile.server.connectors.actionFailed", { name: title }))
    : query.isError
      ? errorMessage(query.error, t("mobile.server.connectors.readFailed"))
      : null;
  const atLimit = connections.length >= MESSAGING_LIMITS.connections;

  return (
    <SettingsContent>
      <ConnectorHeader
        id={platform}
        status={
          attention > 0
            ? workspace
              ? t(workspace.attention, { count: attention })
              : t("mobile.server.connectors.telegram.attention", { count: attention })
            : t(CONNECTOR_STATUS_KEYS[status])
        }
        attention={attention > 0}
        description={workspace ? t(workspace.description) : t("mobile.server.connectors.telegram.description")}
      />
      <ConnectorError message={failure} />
      {connections.map((connection) => {
        const kind = connectionKind(connection);
        const name = connection.workspaceName;
        return (
          <SettingsSection
            key={connection.workspaceId}
            title={
              workspace
                ? t(workspace.connectionTitle)
                : t(
                    isTelegramGroup(connection)
                      ? "mobile.server.connectors.telegram.groupTitle"
                      : "mobile.server.connectors.telegram.directTitle",
                  )
            }
          >
            <SettingsRow
              disclosure={false}
              supportingText={note(connection)}
              trailing={
                <Typography.Paragraph
                  type="body-xs"
                  className={kind === "attention" ? "text-warning-text" : "text-grouped-secondary"}
                >
                  {t(KIND_KEYS[kind])}
                </Typography.Paragraph>
              }
            >
              <Typography.Paragraph>{name}</Typography.Paragraph>
            </SettingsRow>
            {kind === "live" || kind === "paused" ? (
              <SettingsRow>
                <SettingsSwitch
                  value={connection.enabled}
                  disabled={action.busy}
                  label={t("mobile.server.connectors.answerMessages")}
                  dark={theme === "dark"}
                  onValueChange={(enabled) =>
                    void action.perform(async () => {
                      await setMessagingEnabled({ platform, workspaceId: connection.workspaceId, enabled }, server.id);
                    })
                  }
                />
              </SettingsRow>
            ) : null}
            {/* A removed Telegram chat is unlinked. Only a new link with the bot brings it back. */}
            {kind === "attention" && connection.state !== "removed" ? (
              <SettingsRow
                disclosure={false}
                disabled={action.busy}
                accessibilityLabel={t("mobile.server.connectors.rowAction", {
                  action: t("mobile.server.connectors.reconnect"),
                  name,
                })}
                onPress={() => reconnect(connection)}
              >
                <Typography.Paragraph className="text-accent">
                  {t("mobile.server.connectors.reconnect")}
                </Typography.Paragraph>
              </SettingsRow>
            ) : null}
            <SettingsRow
              disclosure={false}
              disabled={action.busy}
              accessibilityLabel={t("mobile.server.connectors.rowAction", {
                action: t("mobile.server.connectors.disconnect"),
                name,
              })}
              onPress={() => disconnect(connection)}
            >
              <Typography.Paragraph className="text-danger-text">
                {t("mobile.server.connectors.disconnect")}
              </Typography.Paragraph>
            </SettingsRow>
          </SettingsSection>
        );
      })}
      {connections.length > 0 ? (
        <SettingsSection
          title={workspace ? t(workspace.orchestratorTitle) : t("mobile.server.connectors.telegram.orchestratorTitle")}
          footer={
            workspace
              ? t(workspace.orchestratorDescription)
              : t("mobile.server.connectors.telegram.orchestratorDescription")
          }
        >
          {orchestrators.map((agent) => (
            <SettingsRow
              key={agent.id}
              disclosure={false}
              supportingText={agent.title || undefined}
              leading={
                <BloubAvatarThumbnail
                  agentId={agent.id}
                  serverId={agent.serverId}
                  hue={agent.avatarHue}
                  seed={agent.avatarSeed}
                  size={AVATAR_SIZE}
                />
              }
            >
              <Typography.Paragraph>{agent.name}</Typography.Paragraph>
            </SettingsRow>
          ))}
          {orchestrators.length === 0 ? (
            <SettingsRow
              disclosure={false}
              supportingText={t(
                workspace ? workspace.orchestratorNone : "mobile.server.connectors.telegram.orchestratorNone",
              )}
            >
              <Typography.Paragraph>{t("mobile.server.connectors.noAgent")}</Typography.Paragraph>
            </SettingsRow>
          ) : null}
          {needsAgent ? (
            <SettingsRow disclosure={false} disabled={action.busy} onPress={() => addAgent(needsAgent)}>
              <Typography.Paragraph className="text-accent">
                {t(workspace ? workspace.addAgent : "mobile.server.connectors.telegram.addAgent")}
              </Typography.Paragraph>
            </SettingsRow>
          ) : null}
        </SettingsSection>
      ) : null}
      {workspace ? (
        <SettingsSection
          footer={
            atLimit
              ? t(workspace.limit, { count: MESSAGING_LIMITS.connections })
              : connections.length > 0
                ? t(workspace.note)
                : t(workspace.connectFooter)
          }
        >
          <SettingsRow disclosure={false} disabled={action.busy || atLimit} onPress={() => connect(null)}>
            <Typography.Paragraph className="text-accent">
              {t(connections.length === 0 ? workspace.connect : workspace.add)}
            </Typography.Paragraph>
          </SettingsRow>
        </SettingsSection>
      ) : (
        <SettingsSection
          title={t(
            connections.length === 0
              ? "mobile.server.connectors.telegram.linkTitle"
              : "mobile.server.connectors.telegram.linkAnother",
          )}
          footer={
            atLimit
              ? t("mobile.server.connectors.telegram.limit", { count: MESSAGING_LIMITS.connections })
              : t("mobile.server.connectors.telegram.linkFooter")
          }
        >
          <SettingsRow disclosure={false} disabled={action.busy || atLimit} onPress={() => connect("group")}>
            <Typography.Paragraph className="text-accent">
              {t("mobile.server.connectors.telegram.addToGroup")}
            </Typography.Paragraph>
          </SettingsRow>
          <SettingsRow disclosure={false} disabled={action.busy || atLimit} onPress={() => connect("direct")}>
            <Typography.Paragraph className="text-accent">
              {t("mobile.server.connectors.telegram.openDirectChat")}
            </Typography.Paragraph>
          </SettingsRow>
        </SettingsSection>
      )}
    </SettingsContent>
  );
}
