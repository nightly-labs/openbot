import type { MessagingConnection } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import {
  Alert,
  AlertContent,
  AlertDescription,
  AlertIcon,
  AlertTitle,
  Button,
  Check,
  Checkbox,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
  Link2Off,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SettingsSection,
  Text,
  TriangleAlert,
} from "@openbot/ui";
import { createSignal, For, Match, Show, Switch } from "solid-js";
import { useText } from "../../text";
import { AgentAvatar } from "../agents/AgentAvatar";
import {
  DetailHeader,
  type IntegrationStatus,
  LogoTile,
  SlackMark,
  StatusPill,
  WizardDialog,
} from "./IntegrationLayout";
import type { IntegrationAgent } from "./IntegrationsHub";

export type SlackIntegrationAgent = IntegrationAgent & { title: string };

export interface SlackIntegrationPanelProps {
  /** Every agent on this computer. */
  agents: SlackIntegrationAgent[];
  /** The connected Slack workspaces. */
  connections: MessagingConnection[];
  /** True while an action runs. Every button waits for it. */
  busy: boolean;
  onConnectWorkspace: () => void;
  onDisconnectWorkspace: (workspaceId: string) => void;
  onReconnect: (workspaceId: string) => void;
  onSetEnabled: (workspaceId: string, enabled: boolean) => void;
  onSetRouting: (workspaceId: string, routerAgentId: string | null, agentIds: string[]) => void;
}

/** What a workspace row can do. */
type RowKind = "live" | "setup" | "paused" | "attention";

function rowKind(connection: MessagingConnection): RowKind {
  switch (connection.state) {
    case "connected":
      return "live";
    case "paused":
      return "paused";
    case "connecting":
    case "reconnecting":
    case "rate_limited":
      return "setup";
    default:
      return "attention";
  }
}

const ROW_STATUS = {
  live: "connected",
  setup: "idle",
  paused: "idle",
  attention: "attention",
} as const satisfies Record<RowKind, IntegrationStatus>;

const STATE_LABEL = {
  connecting: "messaging.state.connecting",
  connected: "messaging.state.connected",
  reconnecting: "messaging.state.reconnecting",
  paused: "messaging.state.paused",
  invalid_token: "messaging.state.invalid_token",
  missing_scope: "messaging.state.missing_scope",
  rate_limited: "messaging.state.rate_limited",
  secret_storage_unavailable: "messaging.state.secret_storage_unavailable",
  error: "messaging.state.error",
  relay_unavailable: "messaging.state.relay_unavailable",
} as const satisfies Record<MessagingConnection["state"], AppTextKey>;

const STATE_HELP: Partial<Record<MessagingConnection["state"], AppTextKey>> = {
  invalid_token: "messaging.help.invalid_token",
  secret_storage_unavailable: "messaging.help.secret_storage_unavailable",
  relay_unavailable: "messaging.help.relay_unavailable",
};

/** The agents that can answer in a workspace. An empty list means every agent. */
export function slackAnsweringAgents<Agent extends { id: string }>(
  connection: MessagingConnection,
  agents: readonly Agent[],
): Agent[] {
  return connection.agentIds.length ? agents.filter((agent) => connection.agentIds.includes(agent.id)) : [...agents];
}

/** The state of the whole Slack integration, for the page header and the Connectors list. */
export function slackIntegrationState(connections: readonly MessagingConnection[]): {
  status: IntegrationStatus;
  label: AppTextKey;
  attention: number;
} {
  const attention = connections.filter((connection) => rowKind(connection) === "attention").length;
  if (attention > 0) return { status: "attention", label: "connector.slack.statusAttention", attention };
  if (connections.length === 0) return { status: "idle", label: "connector.slack.statusNotSetUp", attention };
  return { status: "connected", label: "connector.slack.statusConnected", attention };
}

/**
 * Server settings > Connectors > Slack. A workspace installs the one OpenBot app, and people mention
 * @OpenBot or send it a direct message. The router agent picks the agent that answers each new
 * request. No token reaches this component.
 */
export function SlackIntegrationPanel(props: SlackIntegrationPanelProps) {
  const { t } = useText();
  const [disconnecting, setDisconnecting] = createSignal<MessagingConnection | null>(null);
  const state = () => slackIntegrationState(props.connections);

  return (
    <div class="slack-integration">
      <DetailHeader
        logo={<SlackMark />}
        name={t("connector.slack.title")}
        status={state().status}
        statusLabel={t(state().label)}
        subtitle={t("connector.slack.description")}
        actions={
          <Show when={props.connections.length === 0}>
            <Button type="button" size="sm" loading={props.busy} onClick={props.onConnectWorkspace}>
              {t("connector.slack.connect")}
            </Button>
          </Show>
        }
      />

      <Show when={state().attention > 0}>
        <Alert tone="warning" role="alert">
          <AlertIcon>
            <TriangleAlert />
          </AlertIcon>
          <AlertContent>
            <AlertTitle>{t("connector.slack.attentionTitle", { count: state().attention })}</AlertTitle>
            <AlertDescription>{t("connector.slack.attentionDescription")}</AlertDescription>
          </AlertContent>
        </Alert>
      </Show>

      <SettingsSection title={t("connector.slack.workspaceTitle")}>
        <ItemGroup class="settings-modal-card">
          <For
            each={props.connections}
            fallback={
              <Item class="settings-modal-row">
                <ItemMedia>
                  <LogoTile>
                    <SlackMark />
                  </LogoTile>
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>{t("connector.slack.workspaceNone")}</ItemTitle>
                  <ItemDescription>{t("connector.slack.workspaceNoneDescription")}</ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    loading={props.busy}
                    onClick={props.onConnectWorkspace}
                  >
                    {t("connector.slack.connect")}
                  </Button>
                </ItemActions>
              </Item>
            }
          >
            {(connection) => (
              <WorkspaceRow
                connection={connection}
                busy={props.busy}
                onReconnect={() => props.onReconnect(connection.workspaceId)}
                onSetEnabled={(enabled) => props.onSetEnabled(connection.workspaceId, enabled)}
                onDisconnect={() => setDisconnecting(connection)}
              />
            )}
          </For>
        </ItemGroup>
      </SettingsSection>

      <For each={props.connections}>
        {(connection) => (
          <SettingsSection
            title={
              props.connections.length > 1
                ? t("connector.slack.routingTitleIn", { workspace: connection.workspaceName })
                : t("connector.slack.routingTitle")
            }
            description={t("connector.slack.routingDescription")}
          >
            <Routing
              connection={connection}
              agents={props.agents}
              busy={props.busy}
              onChange={(routerAgentId, agentIds) =>
                props.onSetRouting(connection.workspaceId, routerAgentId, agentIds)
              }
            />
          </SettingsSection>
        )}
      </For>

      <Show when={props.connections.length > 0}>
        <Text class="slack-integration-note" variant="caption" tone="muted">
          {t("connector.slack.warning")}
        </Text>
      </Show>

      <DisconnectDialog
        connection={disconnecting()}
        onConfirm={(workspaceId) => {
          setDisconnecting(null);
          props.onDisconnectWorkspace(workspaceId);
        }}
        onClose={() => setDisconnecting(null)}
      />
    </div>
  );
}

function WorkspaceRow(props: {
  connection: MessagingConnection;
  busy: boolean;
  onReconnect: () => void;
  onSetEnabled: (enabled: boolean) => void;
  onDisconnect: () => void;
}) {
  const { t, format } = useText();
  const kind = () => rowKind(props.connection);
  const note = () => {
    const current = props.connection;
    if (current.missingScopes.length > 0)
      return t("connector.slack.missingScopes", { scopes: format.list(current.missingScopes) });
    if (current.retryAt)
      return t("connector.slack.retryAt", {
        time: format.date(new Date(current.retryAt), { hour: "numeric", minute: "2-digit" }),
      });
    const help = STATE_HELP[current.state];
    return help ? t(help) : t("connector.slack.workspaceDescription");
  };
  const label = (action: string) => t("connector.slack.rowAction", { action, name: props.connection.workspaceName });
  const action = (text: string, onClick: () => void) => (
    <Button type="button" size="sm" variant="outline" disabled={props.busy} aria-label={label(text)} onClick={onClick}>
      {text}
    </Button>
  );
  return (
    <Item class="settings-modal-row" data-status={kind()}>
      <ItemMedia>
        <LogoTile>
          <SlackMark />
        </LogoTile>
      </ItemMedia>
      <ItemContent>
        <ItemTitle>
          {props.connection.workspaceName}
          <StatusPill status={ROW_STATUS[kind()]} label={t(STATE_LABEL[props.connection.state])} />
        </ItemTitle>
        <ItemDescription>{note()}</ItemDescription>
      </ItemContent>
      <ItemActions>
        <Switch>
          <Match when={kind() === "attention"}>{action(t("connector.slack.reconnect"), props.onReconnect)}</Match>
          <Match when={kind() === "paused"}>
            {action(t("connector.slack.resume"), () => props.onSetEnabled(true))}
          </Match>
          <Match when={kind() === "live" || kind() === "setup"}>
            {action(t("connector.slack.pause"), () => props.onSetEnabled(false))}
          </Match>
        </Switch>
        <Button
          type="button"
          size="sm"
          variant="destructive-ghost"
          disabled={props.busy}
          aria-label={label(t("connector.slack.disconnectWorkspace"))}
          onClick={props.onDisconnect}
        >
          {t("connector.slack.disconnectWorkspace")}
        </Button>
      </ItemActions>
    </Item>
  );
}

/** The router agent of one workspace, and the agents that can answer there. */
function Routing(props: {
  connection: MessagingConnection;
  agents: SlackIntegrationAgent[];
  busy: boolean;
  onChange: (routerAgentId: string | null, agentIds: string[]) => void;
}) {
  const { t } = useText();
  const answering = () => new Set(slackAnsweringAgents(props.connection, props.agents).map((agent) => agent.id));
  /** Null names the first agent that can answer, which is the router until the user picks one. */
  const router = () =>
    props.agents.find((agent) => agent.id === props.connection.routerAgentId) ??
    props.agents.find((agent) => answering().has(agent.id)) ??
    null;
  const toggle = (agentId: string, on: boolean) => {
    const next = new Set(answering());
    if (on) next.add(agentId);
    else next.delete(agentId);
    // Every agent is stored as no list, so an agent added later can answer too.
    const agentIds =
      next.size === props.agents.length ? [] : props.agents.map((agent) => agent.id).filter((id) => next.has(id));
    props.onChange(props.connection.routerAgentId, agentIds);
  };
  return (
    <>
      <ItemGroup class="settings-modal-card">
        <Item class="settings-modal-row">
          <ItemContent>
            <ItemTitle>{t("connector.slack.routerLabel")}</ItemTitle>
            <ItemDescription>{t("connector.slack.routerDescription")}</ItemDescription>
          </ItemContent>
          <ItemActions>
            <Select<SlackIntegrationAgent>
              class="settings-modal-select"
              options={props.agents}
              optionValue="id"
              optionTextValue="name"
              value={router()}
              disabled={props.busy || props.agents.length === 0}
              onChange={(agent) => agent && props.onChange(agent.id, props.connection.agentIds)}
              placement="bottom-end"
              itemComponent={(item) => <SelectItem item={item.item}>{item.item.rawValue.name}</SelectItem>}
            >
              <SelectTrigger size="sm" aria-label={t("connector.slack.routerLabel")}>
                <SelectValue<SlackIntegrationAgent>>{(selected) => selected.selectedOption()?.name}</SelectValue>
              </SelectTrigger>
              <SelectContent />
            </Select>
          </ItemActions>
        </Item>
      </ItemGroup>
      <div class="slack-integration-table-wrap">
        <table class="slack-integration-table">
          <caption class="sr-only">{t("connector.slack.answeringCaption")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("connector.slack.columnAgent")}</th>
              <th scope="col">{t("connector.slack.columnAnswers")}</th>
            </tr>
          </thead>
          <tbody>
            <For each={props.agents}>
              {(agent) => (
                <tr>
                  <th scope="row">
                    <span class="slack-integration-agent">
                      <span class="integrations-agent-face" data-size="sm">
                        <AgentAvatar agent={agent} motion="idle" />
                      </span>
                      <span class="slack-integration-stack">
                        <Text as="span" variant="label-sm">
                          {agent.name}
                        </Text>
                        <Text as="span" variant="caption" tone="muted">
                          {agent.title}
                        </Text>
                      </span>
                    </span>
                  </th>
                  <td>
                    <Checkbox
                      checked={answering().has(agent.id)}
                      disabled={props.busy}
                      aria-label={t("connector.slack.answerToggle", { name: agent.name })}
                      onChange={(event) => toggle(agent.id, event.currentTarget.checked)}
                    />
                  </td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>
      <Text class="slack-integration-note" variant="caption" tone="muted">
        {t("connector.slack.inviteNote")}
      </Text>
    </>
  );
}

function DisconnectDialog(props: {
  connection: MessagingConnection | null;
  onConfirm: (workspaceId: string) => void;
  onClose: () => void;
}) {
  const { t } = useText();
  const workspace = () => props.connection?.workspaceName ?? "";
  return (
    <WizardDialog
      open={props.connection !== null}
      closeLabel={t("connector.slack.close")}
      onClose={props.onClose}
      logo={<SlackMark />}
      link="broken"
      title={t("connector.slack.disconnectTitle", { workspace: workspace() })}
      description={t("connector.slack.disconnectDescription", { workspace: workspace() })}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={props.onClose}>
            {t("connector.slack.keep")}
          </Button>
          <Show when={props.connection}>
            {(connection) => (
              <Button type="button" variant="destructive" onClick={() => props.onConfirm(connection().workspaceId)}>
                <Link2Off aria-hidden="true" />
                {t("connector.slack.disconnectWorkspace")}
              </Button>
            )}
          </Show>
        </>
      }
    >
      <ul class="slack-effects">
        <li data-tone="danger">
          <span class="slack-effect-icon" aria-hidden="true">
            <Link2Off />
          </span>
          {t("connector.slack.disconnectEffect", { workspace: workspace() })}
        </li>
        <li data-tone="success">
          <span class="slack-effect-icon" aria-hidden="true">
            <Check />
          </span>
          {t("connector.slack.removeEffectKept")}
        </li>
      </ul>
    </WizardDialog>
  );
}
