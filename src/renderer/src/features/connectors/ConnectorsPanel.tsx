import type { GitHubConnectorStatus, OnePasswordConnectorStatus } from "@openbot/contracts/ipc";
import { Button, ChevronLeft } from "@openbot/ui";
import type { AgentProfile } from "@openbot/ui/data";
import { GitHubConnectorPanel } from "@openbot/ui/features/settings/GitHubConnectorPanel";
import {
  GitHubMark,
  type IntegrationStatus,
  OnePasswordMark,
  SlackMark,
} from "@openbot/ui/features/settings/IntegrationLayout";
import { IntegrationsHub, type IntegrationsHubRow } from "@openbot/ui/features/settings/IntegrationsHub";
import { OnePasswordConnectorPanel } from "@openbot/ui/features/settings/OnePasswordConnectorPanel";
import {
  SlackIntegrationPanel,
  slackIntegrationState,
  slackOrchestrator,
} from "@openbot/ui/features/settings/SlackIntegrationPanel";
import { useText } from "@openbot/ui/text";
import { createSignal, Match, onSettled, Show, Switch } from "solid-js";
import { type GitHubConnectorController, githubPanelProps } from "./github-connector";
import { type OnePasswordConnectorController, onePasswordPanelProps } from "./onepassword-connector";
import type { SlackConnectorController } from "./slack-connector";

type View = "hub" | "github" | "onepassword" | "slack";

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
  slack?: SlackConnectorController | undefined;
  agents: AgentProfile[];
}) {
  const { t } = useText();
  const [view, setView] = createSignal<View>("hub");
  // The Slack state changes on its own and main sends no event, so it is read while the section shows.
  onSettled(() => props.slack?.watch());

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
  const slackRow = (slack: SlackConnectorController): IntegrationsHubRow => {
    const connections = slack.overview()?.connections ?? [];
    const state = slackIntegrationState(connections, props.agents);
    const [connection] = connections;
    const orchestrator = connection ? slackOrchestrator(connection, props.agents) : null;
    const workspace = connection?.workspaceName;
    return {
      id: "slack",
      name: t("connector.slack.title"),
      logo: <SlackMark />,
      status: state.status,
      statusLabel: t(state.label),
      summary:
        state.attention > 0
          ? t("connector.slack.attentionTitle", { count: state.attention })
          : workspace === undefined
            ? t("connector.slack.description")
            : orchestrator
              ? t("connector.slack.summaryConnected", { workspace })
              : t("connector.slack.summaryNoAgent", { workspace }),
      agents: orchestrator ? [orchestrator] : [],
      onOpen: () => setView("slack"),
    };
  };
  const rows = () => {
    const list: IntegrationsHubRow[] = [];
    if (props.slack) list.push(slackRow(props.slack));
    if (props.github) list.push(githubRow(props.github));
    if (props.onePassword) list.push(onePasswordRow(props.onePassword));
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
      <Match when={view() === "onepassword" && props.onePassword}>
        {(onePassword) => (
          <div class="integrations-hub">
            <Back />
            <OnePasswordConnectorPanel {...onePasswordPanelProps(onePassword())} />
          </div>
        )}
      </Match>
      <Match when={view() === "slack" && props.slack}>
        {(slack) => (
          <div class="integrations-hub">
            <Back />
            <Show when={slack().overview()}>
              {(overview) => (
                <SlackIntegrationPanel
                  agents={props.agents}
                  connections={overview().connections}
                  busy={slack().busy()}
                  models={slack().models()}
                  onConnectWorkspace={slack().connectWorkspace}
                  onDisconnectWorkspace={slack().disconnectWorkspace}
                  onReconnect={slack().reconnect}
                  onSetEnabled={slack().setEnabled}
                  onAddOrchestrator={slack().addOrchestrator}
                />
              )}
            </Show>
          </div>
        )}
      </Match>
    </Switch>
  );
}
