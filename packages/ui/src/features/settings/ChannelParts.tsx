/**
 * The parts that the chat channel pages share: Slack, Discord and Telegram. Each page connects places
 * where people talk to OpenBot (a workspace, a Discord server, a chat), and one orchestrator agent
 * answers there. The pages differ only in how a place connects and in their own extra sections.
 */

import type {
  AgentModelId,
  AgentProviderId,
  AgentStatus,
  AvatarHue,
  ClientAgentModelOption,
  CustomAgentSummary,
  CustomProviderSummary,
  MessagingConnection,
  MessagingPlatform,
} from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import {
  Alert,
  AlertContent,
  AlertDescription,
  AlertIcon,
  AlertTitle,
  Button,
  Check,
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
  Trash2,
  TriangleAlert,
} from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { For, Match, Show, Switch } from "solid-js";
import { ProviderModelPicker } from "../../components/ProviderModelPicker";
import { useText } from "../../text";
import { AgentAvatar } from "../agents/AgentAvatar";
import {
  DangerZone,
  type IntegrationAgent,
  IntegrationPage,
  type IntegrationPageSlots,
  type IntegrationStatus,
  LogoTile,
  WizardDialog,
} from "./IntegrationLayout";

/** An agent as a channel page shows it: its face, its name and its title. */
export type ChannelAgent = IntegrationAgent & { title: string };

/** The model of the orchestrator that the user picks in the connect dialog. */
export interface ChannelOrchestratorChoice {
  provider: AgentProviderId;
  model: AgentModelId;
}

/** The catalog behind the model picker. Absent, the orchestrator starts on a new agent's default. */
export interface ChannelOrchestratorModels {
  modelOptions: ClientAgentModelOption[];
  agentStatus: AgentStatus;
  initial: ChannelOrchestratorChoice | null;
  customProviders?: readonly CustomProviderSummary[];
  customAgents?: readonly CustomAgentSummary[];
}

/** The seed and hue of an orchestrator's face before the agent exists. */
export interface ChannelAvatar {
  avatarSeed: string;
  avatarHue: AvatarHue;
}

/**
 * The catalog keys that the shared parts read. Each platform gives its own. A text with a placeholder
 * that differs between platforms, such as `{workspace}` or `{chat}`, comes from the page as a string.
 */
export interface ChannelText {
  title: AppTextKey;
  description: AppTextKey;
  connect: AppTextKey;
  attentionTitle: `connector.${MessagingPlatform}.attentionTitle`;
  attentionDescription: AppTextKey;
  disconnectAllTitle: AppTextKey;
  /** Disconnect: one place, or every place in the danger zone. */
  disconnect: AppTextKey;
  reconnect: AppTextKey;
  pause: AppTextKey;
  resume: AppTextKey;
  rowAction: `connector.${MessagingPlatform}.rowAction`;
  addAgent: AppTextKey;
  orchestratorTitle: AppTextKey;
  orchestratorDescription: AppTextKey;
  orchestratorNone: AppTextKey;
  orchestratorNoneDescription: AppTextKey;
  /** The last line of the orchestrator card: how people reach OpenBot. */
  note: AppTextKey;
  connectStepBrowser: AppTextKey;
  connectStepAllow: AppTextKey;
  connectStepReturn: AppTextKey;
  connectWaiting: AppTextKey;
  orchestratorName: AppTextKey;
  orchestratorRole: AppTextKey;
  orchestratorDoesReceive: AppTextKey;
  orchestratorDoesDelegate: AppTextKey;
  orchestratorDoesAnswer: AppTextKey;
  orchestratorModel: AppTextKey;
  removeEffectKept: AppTextKey;
  removeEffectDeleted: AppTextKey;
  keep: AppTextKey;
  close: AppTextKey;
}

/** What a connection row can do. */
export type ChannelRowKind = "live" | "setup" | "paused" | "attention";

export function channelRowKind(connection: MessagingConnection): ChannelRowKind {
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

/** The state of a whole channel integration, for the page header and the Marketplace. */
export interface ChannelState {
  status: IntegrationStatus;
  label: AppTextKey;
  attention: number;
}

/**
 * The shell of a channel page. Not set up, the header has the only step: Connect. Set up, each section
 * has its own action, and the danger zone disconnects every place.
 */
export function ChannelPage(
  props: IntegrationPageSlots & {
    text: ChannelText;
    logo: JSX.Element;
    state: ChannelState;
    connections: readonly MessagingConnection[];
    /** True when no read of the connections worked. The page then offers no connect. */
    unknown: boolean;
    busy: boolean;
    loadError?: string | null | undefined;
    onRetry?: (() => void) | undefined;
    onConnect: () => void;
    /** A step that no section holds, in the header after the page is set up. */
    headerAction?: JSX.Element;
    disconnectAllSummary: string;
    onDisconnectAll: () => void;
    /** The sections of a page that is set up. */
    sections: JSX.Element;
    /** The dialogs. They show in every state. */
    children: JSX.Element;
  },
) {
  const { t } = useText();
  const setUp = () => props.connections.length > 0;
  return (
    <IntegrationPage
      class="channel-page"
      logo={props.logo}
      name={t(props.text.title)}
      status={props.state.status}
      statusLabel={t(props.state.label)}
      subtitle={t(props.text.description)}
      actions={
        <Show when={!props.unknown}>
          <Show when={!setUp()} fallback={props.headerAction}>
            <Button type="button" size="sm" disabled={props.busy} onClick={props.onConnect}>
              {t(props.text.connect)}
            </Button>
          </Show>
        </Show>
      }
      readError={props.loadError}
      onRetry={props.onRetry}
      alert={
        <Show when={props.state.attention > 0}>
          <Alert tone="warning" role="alert">
            <AlertIcon>
              <TriangleAlert />
            </AlertIcon>
            <AlertContent>
              <AlertTitle>{t(props.text.attentionTitle, { count: props.state.attention })}</AlertTitle>
              <AlertDescription>{t(props.text.attentionDescription)}</AlertDescription>
            </AlertContent>
          </Alert>
        </Show>
      }
      tagline={props.tagline}
      intro={props.intro}
      details={props.details}
      danger={
        <Show when={setUp()}>
          <DangerZone
            title={t(props.text.disconnectAllTitle)}
            description={props.disconnectAllSummary}
            action={t(props.text.disconnect)}
            busy={props.busy}
            confirm
            onAction={props.onDisconnectAll}
          />
        </Show>
      }
    >
      <Show when={setUp()}>{props.sections}</Show>
      {props.children}
    </IntegrationPage>
  );
}

/** One connected place: its logo, its name, what it needs, and its actions. */
export function ChannelConnectionRow(props: {
  text: ChannelText;
  logo: JSX.Element;
  connection: MessagingConnection;
  /** What the place does, or what to do to fix it. */
  note: string;
  busy: boolean;
  /** False when only a new connection brings the place back. */
  canReconnect?: boolean | undefined;
  onReconnect: () => void;
  onSetEnabled: (enabled: boolean) => void;
  onDisconnect: () => void;
}) {
  const { t } = useText();
  const kind = () => channelRowKind(props.connection);
  const label = (action: string) => t(props.text.rowAction, { action, name: props.connection.workspaceName });
  const action = (text: string, onClick: () => void) => (
    <Button type="button" size="sm" variant="outline" disabled={props.busy} aria-label={label(text)} onClick={onClick}>
      {text}
    </Button>
  );
  return (
    <Item class="settings-modal-row" data-status={kind()}>
      <ItemMedia>
        <LogoTile>{props.logo}</LogoTile>
      </ItemMedia>
      <ItemContent>
        <ItemTitle>{props.connection.workspaceName}</ItemTitle>
        <ItemDescription>{props.note}</ItemDescription>
      </ItemContent>
      <ItemActions>
        <Switch>
          <Match when={kind() === "attention" && props.canReconnect !== false}>
            {action(t(props.text.reconnect), props.onReconnect)}
          </Match>
          <Match when={kind() === "paused"}>{action(t(props.text.resume), () => props.onSetEnabled(true))}</Match>
          <Match when={kind() === "live"}>{action(t(props.text.pause), () => props.onSetEnabled(false))}</Match>
        </Switch>
        <Button
          type="button"
          size="sm"
          variant="destructive-ghost"
          disabled={props.busy}
          aria-label={label(t(props.text.disconnect))}
          onClick={props.onDisconnect}
        >
          {t(props.text.disconnect)}
        </Button>
      </ItemActions>
    </Item>
  );
}

/** The face of an orchestrator that does not exist yet. */
function ChannelOrchestratorFace(props: { avatar: ChannelAvatar; size?: "md" | "lg" }) {
  return (
    <span class="integrations-agent-face" data-size={props.size ?? "md"}>
      <AgentAvatar seed={props.avatar.avatarSeed} hue={props.avatar.avatarHue} motion="idle" />
    </span>
  );
}

/**
 * The orchestrators of a channel. With none, the card holds the step that adds one. The last line says
 * how people reach OpenBot.
 */
export function ChannelOrchestratorSection(props: {
  text: ChannelText;
  avatar: ChannelAvatar;
  agents: readonly ChannelAgent[];
  busy: boolean;
  onAddAgent: () => void;
}) {
  const { t } = useText();
  return (
    <SettingsSection title={t(props.text.orchestratorTitle)} description={t(props.text.orchestratorDescription)}>
      <ItemGroup class="settings-modal-card">
        <For each={props.agents}>
          {(agent) => (
            <Item class="settings-modal-row">
              <ItemMedia>
                <span class="integrations-agent-face" data-size="md">
                  <AgentAvatar agent={agent} motion="idle" />
                </span>
              </ItemMedia>
              <ItemContent>
                <ItemTitle>{agent.name}</ItemTitle>
                <ItemDescription>{agent.title}</ItemDescription>
              </ItemContent>
            </Item>
          )}
        </For>
        <Show when={props.agents.length === 0}>
          <Item class="settings-modal-row">
            <ItemMedia>
              <ChannelOrchestratorFace avatar={props.avatar} />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>{t(props.text.orchestratorNone)}</ItemTitle>
              <ItemDescription>{t(props.text.orchestratorNoneDescription)}</ItemDescription>
            </ItemContent>
            <ItemActions>
              <Button type="button" size="sm" variant="outline" disabled={props.busy} onClick={props.onAddAgent}>
                {t(props.text.addAgent)}
              </Button>
            </ItemActions>
          </Item>
        </Show>
        <Text class="integration-card-note" variant="caption" tone="muted">
          {t(props.text.note)}
        </Text>
      </ItemGroup>
    </SettingsSection>
  );
}

/** The first step of a connect dialog: what happens in the browser, then the wait for it. */
export function ChannelConnectChecklist(props: { text: ChannelText; waiting: boolean }) {
  const { t } = useText();
  return (
    <Show
      when={props.waiting}
      fallback={
        <ol class="channel-checklist">
          <For each={[props.text.connectStepBrowser, props.text.connectStepAllow, props.text.connectStepReturn]}>
            {(step) => (
              <li>
                <span class="channel-checklist-dot" aria-hidden="true" />
                {t(step)}
              </li>
            )}
          </For>
        </ol>
      }
    >
      <div class="channel-waiting" aria-live="polite">
        <Spinner size="sm" />
        <Text variant="caption" tone="muted">
          {t(props.text.connectWaiting)}
        </Text>
      </div>
    </Show>
  );
}

/** The second step of a connect dialog: the orchestrator that it adds, what it does, and its model. */
export function ChannelOrchestratorStep(props: {
  text: ChannelText;
  avatar: ChannelAvatar;
  models?: ChannelOrchestratorModels | undefined;
  choice: ChannelOrchestratorChoice | null;
  busy: boolean;
  onChoose: (choice: ChannelOrchestratorChoice) => void;
}) {
  const { t } = useText();
  return (
    <>
      <div class="channel-orchestrator-card">
        <ChannelOrchestratorFace avatar={props.avatar} size="lg" />
        <div class="channel-stack">
          <Text as="span" variant="label">
            {t(props.text.orchestratorName)}
          </Text>
          <Text as="span" variant="caption" tone="muted">
            {t(props.text.orchestratorRole)}
          </Text>
        </div>
      </div>
      <ol class="channel-checklist">
        <For
          each={[
            props.text.orchestratorDoesReceive,
            props.text.orchestratorDoesDelegate,
            props.text.orchestratorDoesAnswer,
          ]}
        >
          {(line) => (
            <li data-state="done">
              <Check size={14} aria-hidden="true" />
              {t(line)}
            </li>
          )}
        </For>
      </ol>
      <Show when={props.models}>
        {(models) => (
          <Show when={props.choice}>
            {(current) => (
              <div class="channel-orchestrator-model">
                <Text as="span" variant="label-sm">
                  {t(props.text.orchestratorModel)}
                </Text>
                <ProviderModelPicker
                  variant="field"
                  ariaLabel={t(props.text.orchestratorModel)}
                  provider={current().provider}
                  value={current().model}
                  modelOptions={models().modelOptions}
                  agentStatus={models().agentStatus}
                  customProviders={models().customProviders}
                  customAgents={models().customAgents}
                  disabled={props.busy}
                  onChange={(model, provider) => props.onChoose({ provider, model })}
                />
              </div>
            )}
          </Show>
        )}
      </Show>
    </>
  );
}

/** Asks before one place disconnects, and says what goes with it. */
export function ChannelDisconnectDialog(props: {
  text: ChannelText;
  logo: JSX.Element;
  /** The place; the dialog is open while it is set. */
  connection: MessagingConnection | null;
  title: string;
  description: string;
  /** What people in the place lose. */
  effect: string;
  /** No other place uses the orchestrator, so it is deleted too. */
  deletesOrchestrator: boolean;
  onConfirm: (workspaceId: string) => void;
  onClose: () => void;
}) {
  const { t } = useText();
  return (
    <WizardDialog
      open={props.connection !== null}
      closeLabel={t(props.text.close)}
      onClose={props.onClose}
      logo={props.logo}
      link="broken"
      title={props.title}
      description={props.description}
      footer={
        <>
          <Button type="button" size="sm" variant="ghost" onClick={props.onClose}>
            {t(props.text.keep)}
          </Button>
          <Show when={props.connection}>
            {(connection) => (
              <Button
                type="button"
                size="sm"
                variant="destructive"
                class="integration-confirm"
                data-cuelume-tap="close"
                data-cuelume-emphasis="strong"
                onClick={() => props.onConfirm(connection().workspaceId)}
              >
                <Link2Off aria-hidden="true" />
                {t(props.text.disconnect)}
              </Button>
            )}
          </Show>
        </>
      }
    >
      <ul class="integration-effects">
        <li data-tone="danger">
          <span class="integration-effect-icon" aria-hidden="true">
            <Link2Off />
          </span>
          {props.effect}
        </li>
        <Show
          when={props.deletesOrchestrator}
          fallback={
            <li data-tone="success">
              <span class="integration-effect-icon" aria-hidden="true">
                <Check />
              </span>
              {t(props.text.removeEffectKept)}
            </li>
          }
        >
          <li data-tone="danger">
            <span class="integration-effect-icon" aria-hidden="true">
              <Trash2 />
            </span>
            {t(props.text.removeEffectDeleted)}
          </li>
        </Show>
      </ul>
    </WizardDialog>
  );
}
