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

export type ChannelAgent = IntegrationAgent & { title: string };

export interface ChannelOrchestratorChoice {
  provider: AgentProviderId;
  model: AgentModelId;
}

export interface ChannelOrchestratorModels {
  modelOptions: ClientAgentModelOption[];
  agentStatus: AgentStatus;
  initial: ChannelOrchestratorChoice | null;
  customProviders?: readonly CustomProviderSummary[];
  customAgents?: readonly CustomAgentSummary[];
  onOpenModelPicker?: (() => void) | undefined;
}

export interface ChannelAvatar {
  avatarSeed: string;
  avatarHue: AvatarHue;
}

export interface ChannelText {
  title: AppTextKey;
  description: AppTextKey;
  connect: AppTextKey;
  attentionTitle: `connector.${MessagingPlatform}.attentionTitle`;
  attentionDescription: AppTextKey;
  disconnectAllTitle: AppTextKey;
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

export interface ChannelState {
  status: IntegrationStatus;
  label: AppTextKey;
  attention: number;
}

export function pausedChannelState(connections: readonly MessagingConnection[]): ChannelState | null {
  if (connections.length === 0 || connections.some((connection) => channelRowKind(connection) !== "paused"))
    return null;
  return { status: "attention", label: "marketplace.app.paused", attention: 0 };
}

export function ChannelPage(
  props: IntegrationPageSlots & {
    text: ChannelText;
    logo: JSX.Element;
    state: ChannelState;
    connections: readonly MessagingConnection[];
    unknown: boolean;
    busy: boolean;
    loadError?: string | null | undefined;
    onRetry?: (() => void) | undefined;
    onConnect: () => void;
    headerAction?: JSX.Element;
    disconnectAllSummary: string;
    onDisconnectAll: () => void;
    sections: JSX.Element;
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

export function ChannelConnectionRow(props: {
  text: ChannelText;
  logo: JSX.Element;
  connection: MessagingConnection;
  note: string;
  busy: boolean;
  canReconnect?: boolean | undefined;
  action?: JSX.Element;
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
        {props.action}
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

function ChannelOrchestratorFace(props: { avatar: ChannelAvatar; size?: "md" | "lg" }) {
  return (
    <span class="integrations-agent-face" data-size={props.size ?? "md"}>
      <AgentAvatar seed={props.avatar.avatarSeed} hue={props.avatar.avatarHue} motion="idle" />
    </span>
  );
}

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
                  onOpen={models().onOpenModelPicker}
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

export function ChannelDisconnectDialog(props: {
  text: ChannelText;
  logo: JSX.Element;
  connection: MessagingConnection | null;
  title: string;
  description: string;
  effect: string;
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
