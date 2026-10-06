import { DISCORD_ORCHESTRATOR_AVATAR } from "@openbot/contracts/discord-app";
import type {
  AgentModelId,
  AgentModelOption,
  AgentProviderId,
  AgentStatus,
  CustomAgentSummary,
  CustomProviderSummary,
  MessagingConnection,
  MessagingPlatform,
} from "@openbot/contracts/ipc";
import { SLACK_ORCHESTRATOR_AVATAR } from "@openbot/contracts/slack-app";
import type { AppMessages, AppTextKey } from "@openbot/i18n";
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
  DiscordMark,
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
  /** Slack when absent. Discord shows the same page with its own text, logo and orchestrator. */
  platform?: MessagingPlatform | undefined;
  /** Every agent on this computer. */
  agents: SlackIntegrationAgent[];
  /** The connected workspaces: Slack workspaces or Discord servers. */
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

const STATE_HELP: Record<MessagingPlatform, Partial<Record<MessagingConnection["state"], AppTextKey>>> = {
  slack: {
    invalid_token: "messaging.help.invalid_token",
    secret_storage_unavailable: "messaging.help.secret_storage_unavailable",
    relay_unavailable: "messaging.help.relay_unavailable",
  },
  discord: {
    invalid_token: "messaging.discordHelp.invalid_token",
    secret_storage_unavailable: "messaging.discordHelp.secret_storage_unavailable",
    relay_unavailable: "messaging.discordHelp.relay_unavailable",
  },
};

const SLACK_TEXT = {
  title: "connector.slack.title",
  description: "connector.slack.description",
  statusNotSetUp: "connector.slack.statusNotSetUp",
  statusConnected: "connector.slack.statusConnected",
  statusAttention: "connector.slack.statusAttention",
  summaryConnected: "connector.slack.summaryConnected",
  summaryNoAgent: "connector.slack.summaryNoAgent",
  attentionTitle: "connector.slack.attentionTitle",
  attentionDescription: "connector.slack.attentionDescription",
  connect: "connector.slack.connect",
  addAgent: "connector.slack.addAgent",
  workspaceTitle: "connector.slack.workspaceTitle",
  workspaceDescription: "connector.slack.workspaceDescription",
  disconnectWorkspace: "connector.slack.disconnectWorkspace",
  missingScopes: "connector.slack.missingScopes",
  retryAt: "connector.slack.retryAt",
  reconnect: "connector.slack.reconnect",
  resume: "connector.slack.resume",
  rowAction: "connector.slack.rowAction",
  orchestratorTitle: "connector.slack.orchestratorTitle",
  orchestratorDescription: "connector.slack.orchestratorDescription",
  orchestratorNone: "connector.slack.orchestratorNone",
  orchestratorNoneDescription: "connector.slack.orchestratorNoneDescription",
  note: "connector.slack.inviteNote",
  stepWorkspace: "connector.slack.stepWorkspace",
  stepAgent: "connector.slack.stepAgent",
  connectTitle: "connector.slack.connectTitle",
  connectDescription: "connector.slack.connectDescription",
  connectStepBrowser: "connector.slack.connectStepBrowser",
  connectStepAllow: "connector.slack.connectStepAllow",
  connectStepReturn: "connector.slack.connectStepReturn",
  connectInApp: "connector.slack.connectInSlack",
  connectWaiting: "connector.slack.connectWaiting",
  agentStepTitle: "connector.slack.agentStepTitle",
  agentStepDescription: "connector.slack.agentStepDescription",
  orchestratorName: "connector.slack.orchestratorName",
  orchestratorRole: "connector.slack.orchestratorRole",
  orchestratorDoesReceive: "connector.slack.orchestratorDoesReceive",
  orchestratorDoesDelegate: "connector.slack.orchestratorDoesDelegate",
  orchestratorDoesAnswer: "connector.slack.orchestratorDoesAnswer",
  orchestratorModel: "connector.slack.orchestratorModel",
  doneTitle: "connector.slack.doneTitle",
  doneDescription: "connector.slack.doneDescription",
  done: "connector.slack.done",
  disconnectTitle: "connector.slack.disconnectTitle",
  disconnectDescription: "connector.slack.disconnectDescription",
  disconnectEffect: "connector.slack.disconnectEffect",
  removeEffectKept: "connector.slack.removeEffectKept",
  keep: "connector.slack.keep",
  close: "connector.slack.close",
} as const satisfies Record<string, keyof AppMessages>;

const DISCORD_TEXT = {
  title: "connector.discord.title",
  description: "connector.discord.description",
  statusNotSetUp: "connector.discord.statusNotSetUp",
  statusConnected: "connector.discord.statusConnected",
  statusAttention: "connector.discord.statusAttention",
  summaryConnected: "connector.discord.summaryConnected",
  summaryNoAgent: "connector.discord.summaryNoAgent",
  attentionTitle: "connector.discord.attentionTitle",
  attentionDescription: "connector.discord.attentionDescription",
  connect: "connector.discord.connect",
  addAgent: "connector.discord.addAgent",
  workspaceTitle: "connector.discord.workspaceTitle",
  workspaceDescription: "connector.discord.workspaceDescription",
  disconnectWorkspace: "connector.discord.disconnectWorkspace",
  missingScopes: "connector.discord.missingScopes",
  retryAt: "connector.discord.retryAt",
  reconnect: "connector.discord.reconnect",
  resume: "connector.discord.resume",
  rowAction: "connector.discord.rowAction",
  orchestratorTitle: "connector.discord.orchestratorTitle",
  orchestratorDescription: "connector.discord.orchestratorDescription",
  orchestratorNone: "connector.discord.orchestratorNone",
  orchestratorNoneDescription: "connector.discord.orchestratorNoneDescription",
  note: "connector.discord.channelsNote",
  stepWorkspace: "connector.discord.stepWorkspace",
  stepAgent: "connector.discord.stepAgent",
  connectTitle: "connector.discord.connectTitle",
  connectDescription: "connector.discord.connectDescription",
  connectStepBrowser: "connector.discord.connectStepBrowser",
  connectStepAllow: "connector.discord.connectStepAllow",
  connectStepReturn: "connector.discord.connectStepReturn",
  connectInApp: "connector.discord.connectInDiscord",
  connectWaiting: "connector.discord.connectWaiting",
  agentStepTitle: "connector.discord.agentStepTitle",
  agentStepDescription: "connector.discord.agentStepDescription",
  orchestratorName: "connector.discord.orchestratorName",
  orchestratorRole: "connector.discord.orchestratorRole",
  orchestratorDoesReceive: "connector.discord.orchestratorDoesReceive",
  orchestratorDoesDelegate: "connector.discord.orchestratorDoesDelegate",
  orchestratorDoesAnswer: "connector.discord.orchestratorDoesAnswer",
  orchestratorModel: "connector.discord.orchestratorModel",
  doneTitle: "connector.discord.doneTitle",
  doneDescription: "connector.discord.doneDescription",
  done: "connector.discord.done",
  disconnectTitle: "connector.discord.disconnectTitle",
  disconnectDescription: "connector.discord.disconnectDescription",
  disconnectEffect: "connector.discord.disconnectEffect",
  removeEffectKept: "connector.discord.removeEffectKept",
  keep: "connector.discord.keep",
  close: "connector.discord.close",
} as const satisfies Record<keyof typeof SLACK_TEXT, keyof AppMessages>;

/** The catalog keys of a platform's page. The Connectors list reads the title and summaries too. */
export function messagingPlatformText(platform: MessagingPlatform = "slack") {
  return platform === "discord" ? DISCORD_TEXT : SLACK_TEXT;
}

const ORCHESTRATOR_AVATAR = {
  slack: SLACK_ORCHESTRATOR_AVATAR,
  discord: DISCORD_ORCHESTRATOR_AVATAR,
} as const satisfies Record<MessagingPlatform, { avatarSeed: string; avatarHue: number }>;

/** The logo of a platform. */
export function MessagingMark(props: { platform?: MessagingPlatform | undefined }) {
  return (
    <Show when={props.platform === "discord"} fallback={<SlackMark />}>
      <DiscordMark />
    </Show>
  );
}

/** The orchestrator agent of a workspace, when it still exists. */
export function slackOrchestrator<Agent extends { id: string }>(
  connection: MessagingConnection,
  agents: readonly Agent[],
): Agent | null {
  return agents.find((agent) => agent.id === connection.orchestratorAgentId) ?? null;
}

/** The state of the whole Slack or Discord integration, for the page header and the Connectors list. */
export function slackIntegrationState(
  connections: readonly MessagingConnection[],
  agents: readonly { id: string }[],
  platform: MessagingPlatform = "slack",
): { status: IntegrationStatus; label: AppTextKey; attention: number } {
  const text = messagingPlatformText(platform);
  const attention = connections.filter(
    (connection) => rowKind(connection) === "attention" || !slackOrchestrator(connection, agents),
  ).length;
  if (attention > 0) return { status: "attention", label: text.statusAttention, attention };
  if (connections.length === 0) return { status: "idle", label: text.statusNotSetUp, attention };
  return { status: "connected", label: text.statusConnected, attention };
}

/**
 * Server settings > Connectors > Slack. A workspace installs the one OpenBot app, and its Slack
 * Orchestrator agent receives every request, asks the team and answers. The connect dialog does both
 * steps. No token reaches this component. Server settings > Connectors > Discord is the same page
 * for a Discord server, with `platform` "discord".
 */
export function SlackIntegrationPanel(props: SlackIntegrationPanelProps) {
  const { t } = useText();
  const [dialogOpen, setDialogOpen] = createSignal(false);
  const [disconnecting, setDisconnecting] = createSignal<MessagingConnection | null>(null);
  const text = () => messagingPlatformText(props.platform);
  const state = () => slackIntegrationState(props.connections, props.agents, props.platform);
  const first = () => props.connections[0] ?? null;
  /** Until the first workspace has its orchestrator, the header offers the next step of the dialog. */
  const setUpDone = () => {
    const connection = first();
    return connection !== null && slackOrchestrator(connection, props.agents) !== null;
  };

  return (
    <div class="slack-integration">
      <DetailHeader
        logo={<MessagingMark platform={props.platform} />}
        name={t(text().title)}
        status={state().status}
        statusLabel={t(state().label)}
        subtitle={t(text().description)}
        actions={
          <Show when={!setUpDone()}>
            <Button type="button" size="sm" disabled={props.busy} onClick={() => setDialogOpen(true)}>
              {first() ? t(text().addAgent) : t(text().connect)}
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
            <AlertTitle>{t(text().attentionTitle, { count: state().attention })}</AlertTitle>
            <AlertDescription>{t(text().attentionDescription)}</AlertDescription>
          </AlertContent>
        </Alert>
      </Show>

      {/* Not set up, the header holds the only step: Connect Slack. */}
      <Show when={props.connections.length > 0}>
        <SettingsSection title={t(text().workspaceTitle)}>
          <ItemGroup class="settings-modal-card">
            <For each={props.connections}>
              {(connection) => (
                <WorkspaceRow
                  platform={props.platform}
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
          <SettingsSection title={t(text().orchestratorTitle)} description={t(text().orchestratorDescription)}>
            <ItemGroup class="settings-modal-card">
              <Show
                when={slackOrchestrator(connection, props.agents)}
                fallback={
                  <Item class="settings-modal-row">
                    <ItemMedia>
                      <OrchestratorFace platform={props.platform} />
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle>{t(text().orchestratorNone)}</ItemTitle>
                      <ItemDescription>{t(text().orchestratorNoneDescription)}</ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <Button type="button" size="sm" disabled={props.busy} onClick={() => setDialogOpen(true)}>
                        {t(text().addAgent)}
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
              {t(text().note)}
            </Text>
          </SettingsSection>
        )}
      </For>

      <SlackConnectDialog
        platform={props.platform}
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
        platform={props.platform}
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

function OrchestratorFace(props: { platform?: MessagingPlatform | undefined; size?: "md" | "lg" }) {
  const avatar = () => ORCHESTRATOR_AVATAR[props.platform ?? "slack"];
  return (
    <span class="integrations-agent-face" data-size={props.size ?? "md"}>
      <AgentAvatar seed={avatar().avatarSeed} hue={avatar().avatarHue} motion="idle" />
    </span>
  );
}

function WorkspaceRow(props: {
  platform?: MessagingPlatform | undefined;
  connection: MessagingConnection;
  busy: boolean;
  onReconnect: () => void;
  onSetEnabled: (enabled: boolean) => void;
  onDisconnect: () => void;
}) {
  const { t, format } = useText();
  const text = () => messagingPlatformText(props.platform);
  const kind = () => rowKind(props.connection);
  const note = () => {
    const current = props.connection;
    if (current.missingScopes.length > 0)
      return t(text().missingScopes, { scopes: format.list(current.missingScopes) });
    if (current.retryAt)
      return t(text().retryAt, {
        time: format.date(new Date(current.retryAt), { hour: "numeric", minute: "2-digit" }),
      });
    const help = STATE_HELP[props.platform ?? "slack"][current.state];
    return help ? t(help) : t(text().workspaceDescription);
  };
  const label = (action: string) => t(text().rowAction, { action, name: props.connection.workspaceName });
  const action = (text: string, onClick: () => void) => (
    <Button type="button" size="sm" variant="outline" disabled={props.busy} aria-label={label(text)} onClick={onClick}>
      {text}
    </Button>
  );
  return (
    <Item class="settings-modal-row" data-status={kind()}>
      <ItemMedia>
        <LogoTile>
          <MessagingMark platform={props.platform} />
        </LogoTile>
      </ItemMedia>
      <ItemContent>
        <ItemTitle>{props.connection.workspaceName}</ItemTitle>
        <ItemDescription>{note()}</ItemDescription>
      </ItemContent>
      <ItemActions>
        <Switch>
          <Match when={kind() === "attention"}>{action(t(text().reconnect), props.onReconnect)}</Match>
          <Match when={kind() === "paused"}>{action(t(text().resume), () => props.onSetEnabled(true))}</Match>
        </Switch>
        <Button
          type="button"
          size="sm"
          variant="destructive-ghost"
          disabled={props.busy}
          aria-label={label(t(text().disconnectWorkspace))}
          onClick={props.onDisconnect}
        >
          {t(text().disconnectWorkspace)}
        </Button>
      </ItemActions>
    </Item>
  );
}

/** 0 connects the workspace, 1 adds the orchestrator, and 2 is done. */
type ConnectStep = 0 | 1 | 2;

/**
 * Connects Slack or Discord in two steps. Both end outside the dialog (the browser, then main), so
 * the step follows the first workspace's state: no workspace is step 1, a workspace with no
 * orchestrator is step 2, and one with an orchestrator is done.
 */
export function SlackConnectDialog(props: {
  /** Slack when absent. */
  platform?: MessagingPlatform | undefined;
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
  const text = () => messagingPlatformText(props.platform);
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
        return { title: t(text().connectTitle), description: t(text().connectDescription) };
      case 1:
        return {
          title: t(text().agentStepTitle),
          description: t(text().agentStepDescription, { workspace: workspace() }),
        };
      case 2:
        return {
          title: t(text().doneTitle, { workspace: workspace() }),
          description: t(text().doneDescription),
        };
    }
  };
  const steps = () => [t(text().stepWorkspace), t(text().stepAgent)];
  return (
    <WizardDialog
      open={props.open}
      closeLabel={t(text().close)}
      onClose={props.onClose}
      logo={<MessagingMark platform={props.platform} />}
      link={link()}
      title={copy().title}
      description={copy().description}
      stepper={<Stepper steps={steps()} current={step()} label={t(text().connect)} />}
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
              {t(text().connectInApp)}
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
                {t(text().addAgent)}
              </Button>
            )}
          </Match>
          <Match when={step() === 2}>
            <Button type="button" size="sm" onClick={props.onClose}>
              {t(text().done)}
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
                  {t(text().connectStepBrowser)}
                </li>
                <li>
                  <span class="slack-checklist-dot" aria-hidden="true" />
                  {t(text().connectStepAllow)}
                </li>
                <li>
                  <span class="slack-checklist-dot" aria-hidden="true" />
                  {t(text().connectStepReturn)}
                </li>
              </ol>
            }
          >
            <div class="slack-waiting" aria-live="polite">
              <Spinner size="sm" />
              <Text variant="caption" tone="muted">
                {t(text().connectWaiting)}
              </Text>
            </div>
          </Show>
        </Match>
        <Match when={step() === 1}>
          <div class="slack-orchestrator-card">
            <OrchestratorFace platform={props.platform} size="lg" />
            <div class="slack-integration-stack">
              <Text as="span" variant="label">
                {t(text().orchestratorName)}
              </Text>
              <Text as="span" variant="caption" tone="muted">
                {t(text().orchestratorRole)}
              </Text>
            </div>
          </div>
          <ol class="slack-checklist">
            <li data-state="done">
              <Check size={14} aria-hidden="true" />
              {t(text().orchestratorDoesReceive)}
            </li>
            <li data-state="done">
              <Check size={14} aria-hidden="true" />
              {t(text().orchestratorDoesDelegate)}
            </li>
            <li data-state="done">
              <Check size={14} aria-hidden="true" />
              {t(text().orchestratorDoesAnswer)}
            </li>
          </ol>
          <Show when={props.models}>
            {(models) => (
              <Show when={choice()}>
                {(current) => (
                  <div class="slack-orchestrator-model">
                    <Text as="span" variant="label-sm">
                      {t(text().orchestratorModel)}
                    </Text>
                    <ProviderModelPicker
                      variant="field"
                      ariaLabel={t(text().orchestratorModel)}
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
  platform?: MessagingPlatform | undefined;
  connection: MessagingConnection | null;
  onConfirm: (workspaceId: string) => void;
  onClose: () => void;
}) {
  const { t } = useText();
  const text = () => messagingPlatformText(props.platform);
  const workspace = () => props.connection?.workspaceName ?? "";
  return (
    <WizardDialog
      open={props.connection !== null}
      closeLabel={t(text().close)}
      onClose={props.onClose}
      logo={<MessagingMark platform={props.platform} />}
      link="broken"
      title={t(text().disconnectTitle, { workspace: workspace() })}
      description={t(text().disconnectDescription, { workspace: workspace() })}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={props.onClose}>
            {t(text().keep)}
          </Button>
          <Show when={props.connection}>
            {(connection) => (
              <Button
                type="button"
                variant="destructive"
                data-cuelume-tap="close"
                data-cuelume-emphasis="strong"
                onClick={() => props.onConfirm(connection().workspaceId)}
              >
                <Link2Off aria-hidden="true" />
                {t(text().disconnectWorkspace)}
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
          {t(text().disconnectEffect, { workspace: workspace() })}
        </li>
        <li data-tone="success">
          <span class="slack-effect-icon" aria-hidden="true">
            <Check />
          </span>
          {t(text().removeEffectKept)}
        </li>
      </ul>
    </WizardDialog>
  );
}
