import type { GitHubConnectorStatus, MessagingPlatform, OnePasswordConnectorStatus } from "@openbot/contracts/ipc";
import { Button, ChevronLeft, Lock } from "@openbot/ui";
import type { AgentProfile } from "@openbot/ui/data";
import {
  BitwardenConnectorPanel,
  type BitwardenConnectorPanelProps,
} from "@openbot/ui/features/settings/BitwardenConnectorPanel";
import { GitHubConnectorPanel } from "@openbot/ui/features/settings/GitHubConnectorPanel";
import {
  GitHubMark,
  type IntegrationStatus,
  OnePasswordMark,
  TelegramMark,
} from "@openbot/ui/features/settings/IntegrationLayout";
import { IntegrationsHub, type IntegrationsHubRow } from "@openbot/ui/features/settings/IntegrationsHub";
import { OnePasswordConnectorPanel } from "@openbot/ui/features/settings/OnePasswordConnectorPanel";
import {
  MessagingMark,
  messagingPlatformText,
  SlackIntegrationPanel,
  slackIntegrationState,
  slackOrchestrator,
} from "@openbot/ui/features/settings/SlackIntegrationPanel";
import {
  TelegramIntegrationPanel,
  telegramAgent,
  telegramIntegrationState,
} from "@openbot/ui/features/settings/TelegramIntegrationPanel";
import { useText } from "@openbot/ui/text";
import { createSignal, Match, onSettled, Show, Switch } from "solid-js";
import type { DiscordConnectorController } from "./discord-connector";
import { type GitHubConnectorController, githubPanelProps } from "./github-connector";
import { type OnePasswordConnectorController, onePasswordPanelProps } from "./onepassword-connector";
import type { SlackConnectorController } from "./slack-connector";
import type { TelegramConnectorController } from "./telegram-connector";

type View = "hub" | "github" | "onepassword" | "bitwarden" | MessagingPlatform;

const GITHUB_STATUS = {
  disconnected: { status: "idle", label: "connector.github.statusNotSetUp" },
  pending: { status: "idle", label: "connector.github.statusConnecting" },
  connected: { status: "connected", label: "connector.github.statusConnected" },
  expired: { status: "attention", label: "connector.github.statusExpired" },
} as const satisfies Record<GitHubConnectorStatus["state"], { status: IntegrationStatus; label: string }>;

const ONEPASSWORD_STATUS = {
  disconnected: { status: "idle", label: "connector.onePassword.statusNotSetUp" },
  connecting: { status: "idle", label: "connector.onePassword.statusConnecting" },
  "choose-account": { status: "idle", label: "connector.onePassword.statusConnecting" },
  connected: { status: "connected", label: "connector.onePassword.statusConnected" },
} as const satisfies Record<OnePasswordConnectorStatus["state"], { status: IntegrationStatus; label: string }>;

/**
 * Server settings > Connectors: the list of this computer's integrations, and the page of the one
 * the user opens. Each integration is passed only when this computer has it.
 */
export function ConnectorsPanel(props: {
  github?: GitHubConnectorController | undefined;
  onePassword?: OnePasswordConnectorController | undefined;
  bitwarden?: BitwardenConnectorPanelProps | undefined;
  slack?: SlackConnectorController | undefined;
  discord?: DiscordConnectorController | undefined;
  telegram?: TelegramConnectorController | undefined;
  agents: AgentProfile[];
}) {
  const { t } = useText();
  const [view, setView] = createSignal<View>("hub");
  // The messaging states change on their own and main sends no event, so they are read while
  // the section shows.
  onSettled(() => {
    props.slack?.watch();
    props.discord?.watch();
    props.telegram?.watch();
  });
  /** The Slack or Discord page on screen, when this computer has that integration. */
  const openMessaging = () => {
    const platform = view();
    if (platform !== "slack" && platform !== "discord") return undefined;
    const controller = platform === "discord" ? props.discord : props.slack;
    return controller ? { platform, controller } : undefined;
  };

  const githubRow = (github: GitHubConnectorController): IntegrationsHubRow => {
    const status = github.status();
    const header = GITHUB_STATUS[status.state];
    return {
      id: "github",
      name: t("connector.github.title"),
      logo: <GitHubMark />,
      status: header.status,
      statusLabel: t(header.label),
      summary:
        status.state === "connected"
          ? `@${status.login ?? ""}`
          : status.state === "expired"
            ? t("connector.github.expiredTitle")
            : t("connector.github.description"),
      onOpen: () => setView("github"),
    };
  };
  const onePasswordRow = (onePassword: OnePasswordConnectorController): IntegrationsHubRow => {
    const status = onePassword.status();
    const header = ONEPASSWORD_STATUS[status.state];
    return {
      id: "onepassword",
      name: t("connector.onePassword.title"),
      logo: <OnePasswordMark />,
      status: header.status,
      statusLabel: t(header.label),
      summary:
        status.state === "connected" && status.loginCount !== null
          ? t("connector.onePassword.loginCount", { count: status.loginCount })
          : t("connector.onePassword.description"),
      onOpen: () => setView("onepassword"),
    };
  };
  const messagingRow = (
    platform: MessagingPlatform,
    controller: SlackConnectorController | DiscordConnectorController,
  ): IntegrationsHubRow => {
    const text = messagingPlatformText(platform);
    const connections = controller.overview()?.connections ?? [];
    const state = slackIntegrationState(connections, props.agents, platform);
    const [connection] = connections;
    const orchestrator = connection ? slackOrchestrator(connection, props.agents) : null;
    const workspace = connection?.workspaceName;
    return {
      id: platform,
      name: t(text.title),
      logo: <MessagingMark platform={platform} />,
      status: state.status,
      statusLabel: t(state.label),
      summary:
        state.attention > 0
          ? t(text.attentionTitle, { count: state.attention })
          : workspace === undefined
            ? t(text.description)
            : orchestrator
              ? t(text.summaryConnected, { workspace })
              : t(text.summaryNoAgent, { workspace }),
      agents: orchestrator ? [orchestrator] : [],
      onOpen: () => setView(platform),
    };
  };
  const telegramRow = (telegram: TelegramConnectorController): IntegrationsHubRow => {
    const connections = telegram.overview()?.connections ?? [];
    const state = telegramIntegrationState(connections, props.agents);
    const [connection] = connections;
    const agent = connection ? telegramAgent(connection, props.agents) : null;
    const bot = connection?.workspaceName;
    return {
      id: "telegram",
      name: t("connector.telegram.title"),
      logo: <TelegramMark />,
      status: state.status,
      statusLabel: t(state.label),
      summary:
        state.attention > 0
          ? t("connector.telegram.attentionTitle", { count: state.attention })
          : bot === undefined
            ? t("connector.telegram.description")
            : agent
              ? t("connector.telegram.summaryConnected", { botUsername: bot })
              : t("connector.telegram.summaryNoAgent", { botUsername: bot }),
      agents: agent ? [agent] : [],
      onOpen: () => setView("telegram"),
    };
  };
  const rows = () => {
    const list: IntegrationsHubRow[] = [];
    if (props.slack) list.push(messagingRow("slack", props.slack));
    if (props.discord) list.push(messagingRow("discord", props.discord));
    if (props.telegram) list.push(telegramRow(props.telegram));
    if (props.github) list.push(githubRow(props.github));
    if (props.onePassword) list.push(onePasswordRow(props.onePassword));
    if (props.bitwarden)
      list.push({
        id: "bitwarden",
        name: t("connector.bitwarden.title"),
        logo: <Lock />,
        status: props.bitwarden.status.connected ? "connected" : "idle",
        statusLabel: props.bitwarden.status.connected
          ? t("connector.bitwarden.connected")
          : t("connector.bitwarden.disconnected"),
        summary: t("connector.bitwarden.description"),
        onOpen: () => setView("bitwarden"),
      });
    return list;
  };

  const Back = () => (
    <Button type="button" size="sm" variant="ghost" class="integrations-back" onClick={() => setView("hub")}>
      <ChevronLeft aria-hidden="true" />
      {t("connector.hub.back")}
    </Button>
  );

  return (
    <Switch fallback={<IntegrationsHub rows={rows()} />}>
      <Match when={view() === "github" && props.github}>
        {(github) => (
          <div class="integrations-hub">
            <Back />
            <GitHubConnectorPanel {...githubPanelProps(github())} />
          </div>
        )}
      </Match>
      <Match when={view() === "bitwarden" && props.bitwarden}>
        {(panel) => (
          <>
            <Back />
            <BitwardenConnectorPanel
              status={panel().status}
              busy={panel().busy}
              onConnect={(key) => panel().onConnect(key)}
              onDisconnect={() => panel().onDisconnect()}
            />
          </>
        )}
      </Match>
      <Match when={view() === "onepassword" && props.onePassword}>
        {(onePassword) => (
          <div class="integrations-hub">
            <Back />
            <OnePasswordConnectorPanel {...onePasswordPanelProps(onePassword())} />
          </div>
        )}
      </Match>
      <Match when={openMessaging()}>
        {(open) => (
          <div class="integrations-hub">
            <Back />
            <Show when={open().controller.overview()}>
              {(overview) => (
                <SlackIntegrationPanel
                  platform={open().platform}
                  agents={props.agents}
                  connections={overview().connections}
                  busy={open().controller.busy()}
                  models={open().controller.models()}
                  onConnectWorkspace={open().controller.connectWorkspace}
                  onDisconnectWorkspace={open().controller.disconnectWorkspace}
                  onReconnect={open().controller.reconnect}
                  onSetEnabled={open().controller.setEnabled}
                  onAddOrchestrator={open().controller.addOrchestrator}
                />
              )}
            </Show>
          </div>
        )}
      </Match>
      <Match when={view() === "telegram" && props.telegram}>
        {(telegram) => (
          <div class="integrations-hub">
            <Back />
            <Show when={telegram().overview()}>
              {(overview) => (
                <TelegramIntegrationPanel
                  agents={props.agents}
                  connections={overview().connections}
                  busy={telegram().busy()}
                  onConnect={telegram().connectTelegram}
                  onDisconnect={telegram().disconnectTelegram}
                  onReconnect={telegram().reconnect}
                  onSetEnabled={telegram().setEnabled}
                  onSetAgent={telegram().setAgent}
                />
              )}
            </Show>
          </div>
        )}
      </Match>
    </Switch>
  );
}
