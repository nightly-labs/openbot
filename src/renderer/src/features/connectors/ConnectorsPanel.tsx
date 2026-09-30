import type { GitHubConnectorStatus } from "@openbot/contracts/ipc";
import { Button, ChevronLeft } from "@openbot/ui";
import type { AgentProfile } from "@openbot/ui/data";
import { GitHubConnectorPanel } from "@openbot/ui/features/settings/GitHubConnectorPanel";
import { GitHubMark, type IntegrationStatus, SlackMark } from "@openbot/ui/features/settings/IntegrationLayout";
import { IntegrationsHub, type IntegrationsHubRow } from "@openbot/ui/features/settings/IntegrationsHub";
import {
  SlackIntegrationPanel,
  slackIntegrationState,
  slackMembers,
} from "@openbot/ui/features/settings/SlackIntegrationPanel";
import { useText } from "@openbot/ui/text";
import { createSignal, Match, onSettled, Show, Switch } from "solid-js";
import type { GitHubConnectorController } from "./github-connector";
import type { SlackConnectorController } from "./slack-connector";

type View = "hub" | "github" | "slack";

const GITHUB_STATUS = {
  disconnected: { status: "idle", label: "connector.github.statusNotSetUp" },
  pending: { status: "idle", label: "connector.github.statusConnecting" },
  connected: { status: "connected", label: "connector.github.statusConnected" },
  expired: { status: "attention", label: "connector.github.statusExpired" },
} as const satisfies Record<GitHubConnectorStatus["state"], { status: IntegrationStatus; label: string }>;

/**
 * Server settings > Connectors: the list of this computer's integrations, and the page of the one
 * the user opens. Each integration is passed only when this computer has it.
 */
export function ConnectorsPanel(props: {
  github?: GitHubConnectorController | undefined;
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
  const slackRow = (slack: SlackConnectorController): IntegrationsHubRow => {
    const connections = slack.overview()?.connections ?? [];
    const workspaces = slack.overview()?.workspaces ?? [];
    const state = slackIntegrationState(connections, workspaces);
    const members = slackMembers(connections);
    const workspace = workspaces[0]?.name;
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
            : members.length > 0
              ? t("connector.slack.summaryAgents", { workspace, count: members.length })
              : t("connector.slack.summaryNoAgents", { workspace }),
      agents: props.agents.filter((agent) => members.some((member) => member.agentId === agent.id)),
      onOpen: () => setView("slack"),
    };
  };
  const rows = () => {
    const list: IntegrationsHubRow[] = [];
    if (props.slack) list.push(slackRow(props.slack));
    if (props.github) list.push(githubRow(props.github));
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
            <GitHubConnectorPanel
              status={github().status()}
              busy={github().busy()}
              repositories={github().repositories()}
              repositoriesError={github().repositoriesError()}
              onConnect={github().connect}
              onCancel={github().cancel}
              onDisconnect={github().disconnect}
              onOpenVerification={github().openVerification}
              onOpenInstall={github().openInstall}
            />
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
                  workspaces={overview().workspaces}
                  busy={slack().busy()}
                  onConnectWorkspace={slack().connectWorkspace}
                  onDisconnectWorkspace={slack().disconnectWorkspace}
                  onCreateApp={slack().createApp}
                  onOpenInstall={slack().openInstall}
                  onReconnect={slack().reconnect}
                  onSetEnabled={slack().setEnabled}
                  onRemove={slack().remove}
                />
              )}
            </Show>
          </div>
        )}
      </Match>
    </Switch>
  );
}
