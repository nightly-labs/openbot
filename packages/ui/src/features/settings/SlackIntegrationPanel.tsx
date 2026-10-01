import type {
  AgentModelId,
  AgentModelOption,
  AgentProviderId,
  AgentStatus,
  CustomAgentSummary,
  CustomProviderSummary,
  MessagingConnection,
} from "@openbot/contracts/ipc";
import { SLACK_ORCHESTRATOR_AVATAR } from "@openbot/contracts/slack-app";
import type { AppTextKey } from "@openbot/i18n";
import {
  Alert,
  AlertContent,
  AlertDescription,
  AlertIcon,
  AlertTitle,
  Button,
  Check,
  ExternalLink,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
  Link2Off,
  SettingsSection,
  Spinner,
  Text,
  TriangleAlert,
} from "@openbot/ui";
import { createEffect, createSignal, For, Match, Show, Switch } from "solid-js";
import { ProviderModelPicker } from "../../components/ProviderModelPicker";
import { useText } from "../../text";
import { AgentAvatar } from "../agents/AgentAvatar";
import {
  DetailHeader,
  type IntegrationStatus,
  LogoTile,
  SlackMark,
  Stepper,
  WizardDialog,
  type WizardLink,
} from "./IntegrationLayout";
import type { IntegrationAgent } from "./IntegrationsHub";

export type SlackIntegrationAgent = IntegrationAgent & { title: string };

/** The model of the Slack Orchestrator that the user picks in the connect dialog. */
export interface SlackOrchestratorChoice {
  provider: AgentProviderId;
  model: AgentModelId;
}

/** The catalog behind the model picker. Absent, the orchestrator starts on a new agent's default. */
export interface SlackOrchestratorModels {
  modelOptions: AgentModelOption[];
  agentStatus: AgentStatus;
  initial: SlackOrchestratorChoice | null;
  customProviders?: readonly CustomProviderSummary[];
  customAgents?: readonly CustomAgentSummary[];
}

export interface SlackIntegrationPanelProps {
  /** Every agent on this computer. */
  agents: SlackIntegrationAgent[];
  /** The connected Slack workspaces. */
  connections: MessagingConnection[];
  /** True while an action runs. Every button waits for it. */
  busy: boolean;
  models?: SlackOrchestratorModels | undefined;
  onConnectWorkspace: () => void;
  onDisconnectWorkspace: (workspaceId: string) => void;
  onReconnect: (workspaceId: string) => void;
  onSetEnabled: (workspaceId: string, enabled: boolean) => void;
  onAddOrchestrator: (workspaceId: string, choice: SlackOrchestratorChoice | null) => void;
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

const STATE_HELP: Partial<Record<MessagingConnection["state"], AppTextKey>> = {
  invalid_token: "messaging.help.invalid_token",
  secret_storage_unavailable: "messaging.help.secret_storage_unavailable",
  relay_unavailable: "messaging.help.relay_unavailable",
};

/** The orchestrator agent of a workspace, when it still exists. */
export function slackOrchestrator<Agent extends { id: string }>(
  connection: MessagingConnection,
  agents: readonly Agent[],
): Agent | null {
  return agents.find((agent) => agent.id === connection.orchestratorAgentId) ?? null;
}

/** The state of the whole Slack integration, for the page header and the Connectors list. */
export function slackIntegrationState(
  connections: readonly MessagingConnection[],
  agents: readonly { id: string }[],
): { status: IntegrationStatus; label: AppTextKey; attention: number } {
  const attention = connections.filter(
    (connection) => rowKind(connection) === "attention" || !slackOrchestrator(connection, agents),
  ).length;
  if (attention > 0) return { status: "attention", label: "connector.slack.statusAttention", attention };
  if (connections.length === 0) return { status: "idle", label: "connector.slack.statusNotSetUp", attention };
  return { status: "connected", label: "connector.slack.statusConnected", attention };
}

/**
 * Server settings > Connectors > Slack. A workspace installs the one OpenBot app, and its Slack
 * Orchestrator agent receives every request, asks the team and answers. The connect dialog does both
 * steps. No token reaches this component.
 */
export function SlackIntegrationPanel(props: SlackIntegrationPanelProps) {
  const { t } = useText();
  const [dialogOpen, setDialogOpen] = createSignal(false);
  const [disconnecting, setDisconnecting] = createSignal<MessagingConnection | null>(null);
  const state = () => slackIntegrationState(props.connections, props.agents);
  const first = () => props.connections[0] ?? null;
  /** Until the first workspace has its orchestrator, the header offers the next step of the dialog. */
  const setUpDone = () => {
    const connection = first();
    return connection !== null && slackOrchestrator(connection, props.agents) !== null;
  };

  return (
    <div class="slack-integration">
      <DetailHeader
        logo={<SlackMark />}
        name={t("connector.slack.title")}
        status={state().status}
        statusLabel={t(state().label)}
        subtitle={t("connector.slack.description")}
        actions={
          <Show when={!setUpDone()}>
            <Button type="button" size="sm" disabled={props.busy} onClick={() => setDialogOpen(true)}>
              {first() ? t("connector.slack.addAgent") : t("connector.slack.connect")}
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

      {/* Not set up, the header holds the only step: Connect Slack. */}
      <Show when={props.connections.length > 0}>
        <SettingsSection title={t("connector.slack.workspaceTitle")}>
          <ItemGroup class="settings-modal-card">
            <For each={props.connections}>
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
      </Show>

      <For each={props.connections}>
        {(connection) => (
          <SettingsSection
            title={t("connector.slack.orchestratorTitle")}
            description={t("connector.slack.orchestratorDescription")}
          >
            <ItemGroup class="settings-modal-card">
              <Show
                when={slackOrchestrator(connection, props.agents)}
                fallback={
                  <Item class="settings-modal-row">
                    <ItemMedia>
                      <OrchestratorFace />
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle>{t("connector.slack.orchestratorNone")}</ItemTitle>
                      <ItemDescription>{t("connector.slack.orchestratorNoneDescription")}</ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <Button type="button" size="sm" disabled={props.busy} onClick={() => setDialogOpen(true)}>
                        {t("connector.slack.addAgent")}
                      </Button>
                    </ItemActions>
                  </Item>
                }
              >
                {(agent) => (
                  <Item class="settings-modal-row">
                    <ItemMedia>
                      <span class="integrations-agent-face" data-size="md">
                        <AgentAvatar agent={agent()} motion="idle" />
                      </span>
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle>{agent().name}</ItemTitle>
                      <ItemDescription>{agent().title}</ItemDescription>
                    </ItemContent>
                  </Item>
                )}
              </Show>
            </ItemGroup>
            <Text class="slack-integration-note" variant="caption" tone="muted">
              {t("connector.slack.inviteNote")}
            </Text>
          </SettingsSection>
        )}
      </For>

      <SlackConnectDialog
        open={dialogOpen()}
        connection={first()}
        agents={props.agents}
        busy={props.busy}
        models={props.models}
        onConnectWorkspace={props.onConnectWorkspace}
        onAddOrchestrator={props.onAddOrchestrator}
        onClose={() => setDialogOpen(false)}
      />
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

function OrchestratorFace(props: { size?: "md" | "lg" }) {
  return (
    <span class="integrations-agent-face" data-size={props.size ?? "md"}>
      <AgentAvatar
        seed={SLACK_ORCHESTRATOR_AVATAR.avatarSeed}
        hue={SLACK_ORCHESTRATOR_AVATAR.avatarHue}
        motion="idle"
      />
    </span>
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
        <ItemTitle>{props.connection.workspaceName}</ItemTitle>
        <ItemDescription>{note()}</ItemDescription>
      </ItemContent>
      <ItemActions>
        <Switch>
          <Match when={kind() === "attention"}>{action(t("connector.slack.reconnect"), props.onReconnect)}</Match>
          <Match when={kind() === "paused"}>
            {action(t("connector.slack.resume"), () => props.onSetEnabled(true))}
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

/** 0 connects the workspace, 1 adds the orchestrator, and 2 is done. */
type ConnectStep = 0 | 1 | 2;

/**
 * Connects Slack in two steps. Both end outside the dialog (the browser, then main), so the step
 * follows the first workspace's state: no workspace is step 1, a workspace with no orchestrator is
 * step 2, and one with an orchestrator is done.
 */
export function SlackConnectDialog(props: {
  open: boolean;
  connection: MessagingConnection | null;
  agents: readonly { id: string }[];
  busy: boolean;
  models?: SlackOrchestratorModels | undefined;
  onConnectWorkspace: () => void;
  onAddOrchestrator: (workspaceId: string, choice: SlackOrchestratorChoice | null) => void;
  onClose: () => void;
}) {
  const { t } = useText();
  const [waiting, setWaiting] = createSignal(false);
  const [choice, setChoice] = createSignal<SlackOrchestratorChoice | null>(null);
  createEffect(
    () => props.open,
    (open) => {
      if (!open) return;
      setWaiting(false);
      setChoice(props.models?.initial ?? null);
    },
  );
  const step = (): ConnectStep => {
    const connection = props.connection;
    if (!connection) return 0;
    return slackOrchestrator(connection, props.agents) ? 2 : 1;
  };
  const link = (): WizardLink => (step() === 2 ? "connected" : "connecting");
  const workspace = () => props.connection?.workspaceName ?? "";
  const copy = () => {
    switch (step()) {
      case 0:
        return { title: t("connector.slack.connectTitle"), description: t("connector.slack.connectDescription") };
      case 1:
        return {
          title: t("connector.slack.agentStepTitle"),
          description: t("connector.slack.agentStepDescription", { workspace: workspace() }),
        };
      case 2:
        return {
          title: t("connector.slack.doneTitle", { workspace: workspace() }),
          description: t("connector.slack.doneDescription"),
        };
    }
  };
  const steps = () => [t("connector.slack.stepWorkspace"), t("connector.slack.stepAgent")];
  return (
    <WizardDialog
      open={props.open}
      closeLabel={t("connector.slack.close")}
      onClose={props.onClose}
      logo={<SlackMark />}
      link={link()}
      title={copy().title}
      description={copy().description}
      stepper={<Stepper steps={steps()} current={step()} label={t("connector.slack.connect")} />}
      footer={
        <Switch>
          <Match when={step() === 0}>
            <Button
              type="button"
              size="sm"
              loading={props.busy}
              onClick={() => {
                setWaiting(true);
                props.onConnectWorkspace();
              }}
            >
              <ExternalLink size={14} aria-hidden="true" />
              {t("connector.slack.connectInSlack")}
            </Button>
          </Match>
          <Match when={step() === 1 && props.connection}>
            {(connection) => (
              <Button
                type="button"
                size="sm"
                loading={props.busy}
                onClick={() => props.onAddOrchestrator(connection().workspaceId, choice())}
              >
                {t("connector.slack.addAgent")}
              </Button>
            )}
          </Match>
          <Match when={step() === 2}>
            <Button type="button" size="sm" onClick={props.onClose}>
              {t("connector.slack.done")}
            </Button>
          </Match>
        </Switch>
      }
    >
      <Switch>
        <Match when={step() === 0}>
          <Show
            when={waiting()}
            fallback={
              <ol class="slack-checklist">
                <li>
                  <span class="slack-checklist-dot" aria-hidden="true" />
                  {t("connector.slack.connectStepBrowser")}
                </li>
                <li>
                  <span class="slack-checklist-dot" aria-hidden="true" />
                  {t("connector.slack.connectStepAllow")}
                </li>
                <li>
                  <span class="slack-checklist-dot" aria-hidden="true" />
                  {t("connector.slack.connectStepReturn")}
                </li>
              </ol>
            }
          >
            <div class="slack-waiting" aria-live="polite">
              <Spinner size="sm" />
              <Text variant="caption" tone="muted">
                {t("connector.slack.connectWaiting")}
              </Text>
            </div>
          </Show>
        </Match>
        <Match when={step() === 1}>
          <div class="slack-orchestrator-card">
            <OrchestratorFace size="lg" />
            <div class="slack-integration-stack">
              <Text as="span" variant="label">
                {t("connector.slack.orchestratorName")}
              </Text>
              <Text as="span" variant="caption" tone="muted">
                {t("connector.slack.orchestratorRole")}
              </Text>
            </div>
          </div>
          <ol class="slack-checklist">
            <li data-state="done">
              <Check size={14} aria-hidden="true" />
              {t("connector.slack.orchestratorDoesReceive")}
            </li>
            <li data-state="done">
              <Check size={14} aria-hidden="true" />
              {t("connector.slack.orchestratorDoesDelegate")}
            </li>
            <li data-state="done">
              <Check size={14} aria-hidden="true" />
              {t("connector.slack.orchestratorDoesAnswer")}
            </li>
          </ol>
          <Show when={props.models}>
            {(models) => (
              <Show when={choice()}>
                {(current) => (
                  <div class="slack-orchestrator-model">
                    <Text as="span" variant="label-sm">
                      {t("connector.slack.orchestratorModel")}
                    </Text>
                    <ProviderModelPicker
                      variant="field"
                      ariaLabel={t("connector.slack.orchestratorModel")}
                      provider={current().provider}
                      value={current().model}
                      modelOptions={models().modelOptions}
                      agentStatus={models().agentStatus}
                      customProviders={models().customProviders}
                      customAgents={models().customAgents}
                      disabled={props.busy}
                      onChange={(model, provider) => setChoice({ provider, model })}
                    />
                  </div>
                )}
              </Show>
            )}
          </Show>
        </Match>
      </Switch>
    </WizardDialog>
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
