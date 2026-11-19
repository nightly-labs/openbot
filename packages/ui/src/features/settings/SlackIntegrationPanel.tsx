import { DISCORD_ORCHESTRATOR_AVATAR } from "@openbot/contracts/discord-app";
import type { MessagingConnection, MessagingPlatform, MessagingRole } from "@openbot/contracts/ipc";
import { MESSAGING_LIMITS } from "@openbot/contracts/ipc";
import { SLACK_ORCHESTRATOR_AVATAR } from "@openbot/contracts/slack-app";
import type { AppMessages, AppTextKey } from "@openbot/i18n";
import {
  Button,
  Checkbox,
  ExternalLink,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
  SettingsSection,
  Spinner,
  Text,
} from "@openbot/ui";
import { createEffect, createSignal, createStore, createUniqueId, For, Match, Show, Switch } from "solid-js";
import { useText } from "../../text";
import { DiscordTile, SlackTile } from "./brand-marks";
import {
  type ChannelAgent,
  type ChannelAvatar,
  ChannelConnectChecklist,
  ChannelConnectionRow,
  ChannelDisconnectDialog,
  type ChannelOrchestratorChoice,
  type ChannelOrchestratorModels,
  ChannelOrchestratorSection,
  ChannelOrchestratorStep,
  ChannelPage,
  type ChannelState,
  type ChannelText,
  channelRowKind,
  pausedChannelState,
} from "./ChannelParts";
import {
  type IntegrationPageSlots,
  LogoTile,
  ReadFailedAlert,
  Stepper,
  UNKNOWN_STATUS,
  WizardDialog,
  type WizardLink,
} from "./IntegrationLayout";

export type SlackIntegrationAgent = ChannelAgent;

export type SlackOrchestratorChoice = ChannelOrchestratorChoice;

export type SlackOrchestratorModels = ChannelOrchestratorModels;

export interface DiscordAccessControl {
  allowed: (workspaceId: string) => readonly MessagingRole[] | null;
  loadRoles: (workspaceId: string) => Promise<readonly MessagingRole[]>;
  onSave: (workspaceId: string, roles: MessagingRole[]) => void;
  unsupported?: boolean | undefined;
}

export interface SlackIntegrationPanelProps extends IntegrationPageSlots {
  platform?: WorkspacePlatform | undefined;
  agents: SlackIntegrationAgent[];
  connections: MessagingConnection[];
  busy: boolean;
  models?: SlackOrchestratorModels | undefined;
  onConnectWorkspace: () => void;
  onDisconnectWorkspace: (workspaceId: string) => void;
  onDisconnectAll: () => void;
  onReconnect: (workspaceId: string) => void;
  onSetEnabled: (workspaceId: string, enabled: boolean) => void;
  onAddOrchestrator: (workspaceId: string, choice: SlackOrchestratorChoice | null) => void;
  hostName?: string | undefined;
  loadError?: string | null | undefined;
  onRetry?: (() => void) | undefined;
  access?: DiscordAccessControl | undefined;
}

export type WorkspacePlatform = Exclude<MessagingPlatform, "telegram" | "whatsapp">;

const STATE_HELP: Record<WorkspacePlatform, Partial<Record<MessagingConnection["state"], AppTextKey>>> = {
  slack: {
    invalid_token: "messaging.help.invalid_token",
    secret_storage_unavailable: "messaging.help.secret_storage_unavailable",
    relay_unavailable: "messaging.help.relay_unavailable",
    not_linked: "messaging.help.not_linked",
  },
  discord: {
    invalid_token: "messaging.discordHelp.invalid_token",
    secret_storage_unavailable: "messaging.discordHelp.secret_storage_unavailable",
    relay_unavailable: "messaging.discordHelp.relay_unavailable",
    not_linked: "messaging.discordHelp.not_linked",
  },
};

const SLACK_TEXT = {
  title: "connector.slack.title",
  description: "connector.slack.description",
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
  disconnect: "connector.slack.disconnectWorkspace",
  missingScopes: "connector.slack.missingScopes",
  retryAt: "connector.slack.retryAt",
  reconnect: "connector.slack.reconnect",
  pause: "connector.slack.pause",
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
  disconnectDescriptionHost: "connector.slack.disconnectDescriptionHost",
  disconnectEffect: "connector.slack.disconnectEffect",
  removeEffectKept: "connector.slack.removeEffectKept",
  removeEffectDeleted: "connector.slack.removeEffectDeleted",
  keep: "connector.slack.keep",
  close: "connector.slack.close",
  addWorkspace: "connector.slack.addWorkspace",
  limitReached: "connector.slack.limitReached",
  summaryMany: "connector.slack.summaryMany",
  disconnectAllTitle: "connector.slack.disconnectAllTitle",
  disconnectAllSummary: "connector.slack.disconnectAllSummary",
  disconnectAllSummaryOrchestrator: "connector.slack.disconnectAllSummaryOrchestrator",
} as const satisfies ChannelText & Record<string, keyof AppMessages>;

const DISCORD_TEXT = {
  title: "connector.discord.title",
  description: "connector.discord.description",
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
  disconnect: "connector.discord.disconnectWorkspace",
  missingScopes: "connector.discord.missingScopes",
  retryAt: "connector.discord.retryAt",
  reconnect: "connector.discord.reconnect",
  pause: "connector.discord.pause",
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
  disconnectDescriptionHost: "connector.discord.disconnectDescriptionHost",
  disconnectEffect: "connector.discord.disconnectEffect",
  removeEffectKept: "connector.discord.removeEffectKept",
  removeEffectDeleted: "connector.discord.removeEffectDeleted",
  keep: "connector.discord.keep",
  close: "connector.discord.close",
  addWorkspace: "connector.discord.addWorkspace",
  limitReached: "connector.discord.limitReached",
  summaryMany: "connector.discord.summaryMany",
  disconnectAllTitle: "connector.discord.disconnectAllTitle",
  disconnectAllSummary: "connector.discord.disconnectAllSummary",
  disconnectAllSummaryOrchestrator: "connector.discord.disconnectAllSummaryOrchestrator",
} as const satisfies Record<keyof typeof SLACK_TEXT, keyof AppMessages>;

export function messagingPlatformText(platform: WorkspacePlatform = "slack") {
  return platform === "discord" ? DISCORD_TEXT : SLACK_TEXT;
}

const ORCHESTRATOR_AVATAR = {
  slack: SLACK_ORCHESTRATOR_AVATAR,
  discord: DISCORD_ORCHESTRATOR_AVATAR,
} as const satisfies Record<WorkspacePlatform, ChannelAvatar>;

export function MessagingMark(props: { platform?: WorkspacePlatform | undefined }) {
  return (
    <Show when={props.platform === "discord"} fallback={<SlackTile />}>
      <DiscordTile />
    </Show>
  );
}

export function slackOrchestrator<Agent extends { id: string }>(
  connection: MessagingConnection,
  agents: readonly Agent[],
): Agent | null {
  return agents.find((agent) => agent.id === connection.orchestratorAgentId) ?? null;
}

export function messagingStateUnknown(props: {
  connections: readonly MessagingConnection[];
  loadError?: string | null | undefined;
}): boolean {
  return Boolean(props.loadError) && props.connections.length === 0;
}

export function slackIntegrationState(
  connections: readonly MessagingConnection[],
  agents: readonly { id: string }[],
  platform: WorkspacePlatform = "slack",
  loadError?: string | null,
): ChannelState {
  if (messagingStateUnknown({ connections, loadError })) return { ...UNKNOWN_STATUS, attention: 0 };
  const text = messagingPlatformText(platform);
  const attention = connections.filter(
    (connection) => channelRowKind(connection) === "attention" || !slackOrchestrator(connection, agents),
  ).length;
  if (attention > 0) return { status: "attention", label: text.statusAttention, attention };
  if (connections.length === 0) return { status: "idle", label: "marketplace.app.notConnected", attention };
  return pausedChannelState(connections) ?? { status: "connected", label: text.statusConnected, attention };
}

type DialogTarget = { kind: "new"; before: ReadonlySet<string> } | { kind: "existing"; workspaceId: string };

export function SlackIntegrationPanel(props: SlackIntegrationPanelProps) {
  const { t, format } = useText();
  const [target, setTarget] = createSignal<DialogTarget | null>(null);
  const [disconnecting, setDisconnecting] = createSignal<MessagingConnection | null>(null);
  const [choosingRoles, setChoosingRoles] = createSignal<MessagingConnection | null>(null);
  const text = () => messagingPlatformText(props.platform);
  const avatar = () => ORCHESTRATOR_AVATAR[props.platform ?? "slack"];
  const state = () => slackIntegrationState(props.connections, props.agents, props.platform, props.loadError);
  const access = () => (props.platform === "discord" ? props.access : undefined);
  const needsAgent = () => props.connections.find((connection) => !slackOrchestrator(connection, props.agents)) ?? null;
  const atLimit = () => props.connections.length >= MESSAGING_LIMITS.connections;
  const openNew = () =>
    setTarget({ kind: "new", before: new Set(props.connections.map((connection) => connection.workspaceId)) });
  const openAddAgent = () => {
    const connection = needsAgent();
    if (connection) setTarget({ kind: "existing", workspaceId: connection.workspaceId });
  };
  const dialogConnection = () => {
    const current = target();
    if (!current) return null;
    const found =
      current.kind === "existing"
        ? props.connections.find((connection) => connection.workspaceId === current.workspaceId)
        : props.connections.find((connection) => !current.before.has(connection.workspaceId));
    return found ?? null;
  };
  const orchestrators = () => [
    ...new Map(
      props.connections.flatMap((connection) => {
        const agent = slackOrchestrator(connection, props.agents);
        return agent ? [[agent.id, agent] as const] : [];
      }),
    ).values(),
  ];
  const disconnectDeletesOrchestrator = () => {
    const connection = disconnecting();
    const agent = connection ? slackOrchestrator(connection, props.agents) : null;
    return (
      agent !== null &&
      !props.connections.some(
        (other) => other.workspaceId !== connection?.workspaceId && other.orchestratorAgentId === agent.id,
      )
    );
  };
  const disconnectAllSummary = () =>
    t(orchestrators().length > 0 ? text().disconnectAllSummaryOrchestrator : text().disconnectAllSummary);
  const note = (connection: MessagingConnection) => {
    if (connection.missingScopes.length > 0)
      return t(text().missingScopes, { scopes: format.list(connection.missingScopes) });
    if (connection.retryAt)
      return t(text().retryAt, {
        time: format.date(new Date(connection.retryAt), { hour: "numeric", minute: "2-digit" }),
      });
    const help = STATE_HELP[props.platform ?? "slack"][connection.state];
    return help ? t(help) : t(text().workspaceDescription);
  };
  const disconnectingName = () => disconnecting()?.workspaceName ?? "";
  const disconnectDescription = () =>
    props.hostName
      ? t(text().disconnectDescriptionHost, { workspace: disconnectingName(), host: props.hostName })
      : t(text().disconnectDescription, { workspace: disconnectingName() });

  return (
    <ChannelPage
      text={text()}
      logo={<MessagingMark platform={props.platform} />}
      state={state()}
      connections={props.connections}
      unknown={messagingStateUnknown(props)}
      busy={props.busy}
      loadError={props.loadError}
      onRetry={props.onRetry}
      onConnect={openNew}
      headerAction={
        <Show when={orchestrators().length > 0 && needsAgent()}>
          <Button type="button" size="sm" disabled={props.busy} onClick={openAddAgent}>
            {t(text().addAgent)}
          </Button>
        </Show>
      }
      disconnectAllSummary={disconnectAllSummary()}
      onDisconnectAll={props.onDisconnectAll}
      tagline={props.tagline}
      intro={props.intro}
      details={props.details}
      sections={
        <>
          <SettingsSection
            title={t(text().workspaceTitle)}
            actions={
              <Button type="button" size="sm" variant="outline" disabled={props.busy || atLimit()} onClick={openNew}>
                {t(text().addWorkspace)}
              </Button>
            }
          >
            <ItemGroup class="settings-modal-card">
              <For each={props.connections}>
                {(connection) => (
                  <ChannelConnectionRow
                    text={text()}
                    logo={<MessagingMark platform={props.platform} />}
                    connection={connection}
                    note={note(connection)}
                    busy={props.busy}
                    onReconnect={() => props.onReconnect(connection.workspaceId)}
                    onSetEnabled={(enabled) => props.onSetEnabled(connection.workspaceId, enabled)}
                    onDisconnect={() => setDisconnecting(connection)}
                  />
                )}
              </For>
              <Show when={atLimit()}>
                <Text class="integration-card-note" variant="caption" tone="muted">
                  {t(text().limitReached, { count: MESSAGING_LIMITS.connections })}
                </Text>
              </Show>
            </ItemGroup>
          </SettingsSection>

          <ChannelOrchestratorSection
            text={text()}
            avatar={avatar()}
            agents={orchestrators()}
            busy={props.busy}
            onAddAgent={openAddAgent}
          />

          <Show when={access()}>
            {(control) => (
              <SettingsSection
                title={t("connector.discord.accessTitle")}
                description={t("connector.discord.accessDescription")}
              >
                <ItemGroup class="settings-modal-card">
                  <For each={props.connections}>
                    {(connection) => (
                      <AccessRow
                        connection={connection}
                        access={control()}
                        hostName={props.hostName}
                        busy={props.busy}
                        onChoose={() => setChoosingRoles(connection)}
                      />
                    )}
                  </For>
                </ItemGroup>
              </SettingsSection>
            )}
          </Show>
        </>
      }
    >
      <SlackConnectDialog
        platform={props.platform}
        open={target() !== null}
        connection={dialogConnection()}
        agents={props.agents}
        busy={props.busy}
        models={props.models}
        onConnectWorkspace={props.onConnectWorkspace}
        onAddOrchestrator={props.onAddOrchestrator}
        onClose={() => setTarget(null)}
      />
      <Show when={access()}>
        {(control) => (
          <RolesDialog
            connection={choosingRoles()}
            access={control()}
            busy={props.busy}
            onClose={() => setChoosingRoles(null)}
          />
        )}
      </Show>
      <ChannelDisconnectDialog
        text={text()}
        logo={<MessagingMark platform={props.platform} />}
        connection={disconnecting()}
        title={t(text().disconnectTitle, { workspace: disconnectingName() })}
        description={disconnectDescription()}
        effect={t(text().disconnectEffect, { workspace: disconnectingName() })}
        deletesOrchestrator={disconnectDeletesOrchestrator()}
        onConfirm={(workspaceId) => {
          setDisconnecting(null);
          props.onDisconnectWorkspace(workspaceId);
        }}
        onClose={() => setDisconnecting(null)}
      />
    </ChannelPage>
  );
}

function AccessRow(props: {
  connection: MessagingConnection;
  access: DiscordAccessControl;
  hostName?: string | undefined;
  busy: boolean;
  onChoose: () => void;
}) {
  const { t, format } = useText();
  const allowed = () => props.access.allowed(props.connection.workspaceId);
  const everyone = () => props.access.unsupported === true || allowed()?.length === 0;
  const summary = () => {
    const roles = allowed();
    if (everyone()) return t("connector.discord.accessEveryone");
    if (roles === null) return t("connector.discord.accessLoading");
    return t("connector.discord.accessRoles", { roles: format.list(roles.map((role) => role.name)) });
  };
  const choose = () => t("connector.discord.accessChoose");
  return (
    <Item class="settings-modal-row">
      <ItemMedia>
        <LogoTile>
          <MessagingMark platform="discord" />
        </LogoTile>
      </ItemMedia>
      <ItemContent>
        <ItemTitle>{props.connection.workspaceName}</ItemTitle>
        <ItemDescription>{summary()}</ItemDescription>
        <Switch>
          <Match when={props.access.unsupported}>
            <ItemDescription>{t("connector.discord.accessHostUpdate", { host: props.hostName ?? "" })}</ItemDescription>
          </Match>
          <Match when={everyone()}>
            <ItemDescription>{t("connector.discord.accessEveryoneDescription")}</ItemDescription>
          </Match>
        </Switch>
      </ItemContent>
      <Show when={!props.access.unsupported}>
        <ItemActions>
          <Show when={allowed() === null}>
            <Spinner size="sm" />
          </Show>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={props.busy || allowed() === null}
            aria-label={t("connector.discord.rowAction", { action: choose(), name: props.connection.workspaceName })}
            onClick={props.onChoose}
          >
            {choose()}
          </Button>
        </ItemActions>
      </Show>
    </Item>
  );
}

function RolesDialog(props: {
  connection: MessagingConnection | null;
  access: DiscordAccessControl;
  busy: boolean;
  onClose: () => void;
}) {
  const { t, errorMessage } = useText();
  const id = createUniqueId();
  const [view, setView] = createStore<{
    status: "loading" | "ready" | "failed";
    roles: MessagingRole[];
    saved: MessagingRole[];
    selected: string[];
    error: string;
  }>({ status: "loading", roles: [], saved: [], selected: [], error: "" });
  let reads = 0;
  const load = (workspaceId: string) => {
    const read = ++reads;
    setView((draft) => {
      draft.status = "loading";
      draft.error = "";
    });
    void props.access.loadRoles(workspaceId).then(
      (roles) => {
        if (read !== reads) return;
        setView((draft) => {
          draft.status = "ready";
          draft.roles = roles.map((role) => ({ ...role }));
        });
      },
      (error: unknown) => {
        if (read !== reads) return;
        setView((draft) => {
          draft.status = "failed";
          draft.error = errorMessage(error, t("connector.discord.accessLoadFailed"));
        });
      },
    );
  };
  createEffect(
    () => props.connection?.workspaceId,
    (workspaceId) => {
      reads += 1;
      if (!workspaceId) return;
      const saved = props.access.allowed(workspaceId) ?? [];
      setView((draft) => {
        draft.roles = [];
        draft.saved = saved.map((role) => ({ ...role }));
        draft.selected = saved.map((role) => role.id);
      });
      load(workspaceId);
    },
  );
  const options = () => [
    ...view.roles.map((role) => ({ role, deleted: false })),
    ...view.saved
      .filter((role) => !view.roles.some((current) => current.id === role.id))
      .map((role) => ({ role, deleted: true })),
  ];
  const atCap = () => view.selected.length >= MESSAGING_LIMITS.allowedRoles;
  const toggle = (roleId: string, checked: boolean) =>
    setView((draft) => {
      draft.selected = checked
        ? [...draft.selected.filter((selected) => selected !== roleId), roleId]
        : draft.selected.filter((selected) => selected !== roleId);
    });
  const save = (workspaceId: string) => {
    const roles = options()
      .map((option) => option.role)
      .filter((role) => view.selected.includes(role.id))
      .map((role) => ({ id: role.id, name: role.name }));
    props.onClose();
    props.access.onSave(workspaceId, roles);
  };
  return (
    <WizardDialog
      open={props.connection !== null}
      closeLabel={t("connector.discord.close")}
      onClose={props.onClose}
      logo={<DiscordTile />}
      link="connected"
      title={t("connector.discord.accessDialogTitle", { workspace: props.connection?.workspaceName ?? "" })}
      description={t("connector.discord.accessDialogDescription")}
      footer={
        <>
          <Button type="button" size="sm" variant="ghost" onClick={props.onClose}>
            {t("common.cancel")}
          </Button>
          <Show when={props.connection}>
            {(connection) => (
              <Button
                type="button"
                size="sm"
                disabled={view.status !== "ready" || props.busy}
                onClick={() => save(connection().workspaceId)}
              >
                {t("connector.discord.accessSave")}
              </Button>
            )}
          </Show>
        </>
      }
    >
      <Switch
        fallback={
          <ul class="discord-roles" aria-label={t("connector.discord.accessTitle")}>
            <For each={options()}>
              {(option) => {
                const checked = () => view.selected.includes(option.role.id);
                return (
                  <li>
                    <label class="discord-role-row" for={`${id}-${option.role.id}`}>
                      <Checkbox
                        id={`${id}-${option.role.id}`}
                        checked={checked()}
                        disabled={!checked() && atCap()}
                        onChange={(event) => toggle(option.role.id, event.currentTarget.checked)}
                      />
                      <Text variant="body-sm" class="discord-role-name">
                        {option.deleted
                          ? t("connector.discord.accessRoleDeleted", { role: option.role.name })
                          : option.role.name}
                      </Text>
                    </label>
                  </li>
                );
              }}
            </For>
          </ul>
        }
      >
        <Match when={view.status === "loading"}>
          <div class="channel-waiting" aria-live="polite">
            <Spinner size="sm" />
            <Text variant="caption" tone="muted">
              {t("connector.discord.accessLoading")}
            </Text>
          </div>
        </Match>
        <Match when={view.status === "failed"}>
          <ReadFailedAlert
            message={view.error}
            onRetry={() => {
              const workspaceId = props.connection?.workspaceId;
              if (workspaceId) load(workspaceId);
            }}
          />
        </Match>
        <Match when={options().length === 0}>
          <Text variant="body-sm" tone="muted" role="status">
            {t("connector.discord.accessNoRoles")}
          </Text>
        </Match>
      </Switch>
    </WizardDialog>
  );
}

type ConnectStep = 0 | 1 | 2;

export function SlackConnectDialog(props: {
  platform?: WorkspacePlatform | undefined;
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
          <ChannelConnectChecklist text={text()} waiting={waiting()} />
        </Match>
        <Match when={step() === 1}>
          <ChannelOrchestratorStep
            text={text()}
            avatar={ORCHESTRATOR_AVATAR[props.platform ?? "slack"]}
            models={props.models}
            choice={choice()}
            busy={props.busy}
            onChoose={setChoice}
          />
        </Match>
      </Switch>
    </WizardDialog>
  );
}
