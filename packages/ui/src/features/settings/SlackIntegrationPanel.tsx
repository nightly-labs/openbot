import type { MessagingConnection, SlackWorkspace } from "@openbot/contracts/ipc";
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
  Hash,
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
import { createEffect, createMemo, createStore, For, Match, Show, Switch } from "solid-js";
import { useText } from "../../text";
import { AgentAvatar } from "../agents/AgentAvatar";
import {
  DetailHeader,
  type IntegrationStatus,
  LogoTile,
  SlackMark,
  StatusPill,
  Stepper,
  WizardDialog,
  type WizardLink,
} from "./IntegrationLayout";
import type { IntegrationAgent } from "./IntegrationsHub";

export type SlackIntegrationAgent = IntegrationAgent & { title: string };

export interface SlackIntegrationPanelProps {
  /** Every agent on this computer. An agent without a connection shows as not added. */
  agents: SlackIntegrationAgent[];
  connections: MessagingConnection[];
  workspaces: SlackWorkspace[];
  /** True while an action runs. Every button waits for it. */
  busy: boolean;
  onConnectWorkspace: () => void;
  onDisconnectWorkspace: (workspaceId: string) => void;
  onCreateApp: (agentId: string, workspaceId: string) => void;
  onOpenInstall: (agentId: string) => void;
  onReconnect: (agentId: string) => void;
  onSetEnabled: (agentId: string, enabled: boolean) => void;
  onRemove: (agentId: string) => void;
}

/** What a row can do. `none` is an agent with no Slack app, including one whose app was removed. */
type RowKind = "live" | "setup" | "paused" | "attention" | "none";

function rowKind(connection: MessagingConnection | undefined): RowKind {
  if (!connection || connection.credentials === "missing") return "none";
  switch (connection.state) {
    case "connected":
      return "live";
    case "paused":
      return "paused";
    case "connecting":
    case "reconnecting":
    case "rate_limited":
    case "awaiting_install":
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
  none: "unavailable",
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
  awaiting_install: "messaging.state.awaiting_install",
  relay_unavailable: "messaging.state.relay_unavailable",
} as const satisfies Record<MessagingConnection["state"], AppTextKey>;

const STATE_HELP: Partial<Record<MessagingConnection["state"], AppTextKey>> = {
  invalid_token: "messaging.help.invalid_token",
  secret_storage_unavailable: "messaging.help.secret_storage_unavailable",
  relay_unavailable: "messaging.help.relay_unavailable",
  awaiting_install: "messaging.help.awaiting_install",
};

/** The connections that have a Slack app: the agents that are in Slack. */
export function slackMembers(connections: readonly MessagingConnection[]): MessagingConnection[] {
  return connections.filter((connection) => rowKind(connection) !== "none");
}

/** The state of the whole Slack integration, for the page header and the Connectors list. */
export function slackIntegrationState(
  connections: readonly MessagingConnection[],
  workspaces: readonly SlackWorkspace[],
): { status: IntegrationStatus; label: AppTextKey; attention: number } {
  const attention = connections.filter((connection) => rowKind(connection) === "attention").length;
  if (attention > 0) return { status: "attention", label: "connector.slack.statusAttention", attention };
  if (workspaces.length === 0 && slackMembers(connections).length === 0)
    return { status: "idle", label: "connector.slack.statusNotSetUp", attention };
  return { status: "connected", label: "connector.slack.statusConnected", attention };
}

/**
 * Server settings > Connectors > Slack. OpenBot creates one Slack app for each agent, in the
 * workspace that this computer connected. No token reaches this component.
 */
export function SlackIntegrationPanel(props: SlackIntegrationPanelProps) {
  const { t } = useText();
  const [dialogs, setDialogs] = createStore<{
    addOpen: boolean;
    addAgentId: string | null;
    removeAgentId: string | null;
  }>({ addOpen: false, addAgentId: null, removeAgentId: null });
  const byAgent = createMemo(() => new Map(props.connections.map((connection) => [connection.agentId, connection])));
  /** An agent is always added to the first workspace, as the host creates one app per agent. */
  const workspace = () => props.workspaces[0] ?? null;
  const state = () => slackIntegrationState(props.connections, props.workspaces);
  const liveCount = () => props.connections.filter((connection) => rowKind(connection) === "live").length;
  const memberCount = () => slackMembers(props.connections).length;
  const removing = () => props.agents.find((agent) => agent.id === dialogs.removeAgentId) ?? null;

  const openAdd = (agentId: string | null) =>
    setDialogs((draft) => {
      draft.addOpen = true;
      draft.addAgentId = agentId;
    });

  return (
    <div class="slack-integration">
      <DetailHeader
        logo={<SlackMark />}
        name={t("connector.slack.title")}
        status={state().status}
        statusLabel={t(state().label)}
        subtitle={t("connector.slack.description")}
        actions={
          <Show
            when={workspace()}
            fallback={
              <Button type="button" size="sm" loading={props.busy} onClick={props.onConnectWorkspace}>
                {t("connector.slack.connect")}
              </Button>
            }
          >
            <Button type="button" size="sm" disabled={props.busy} onClick={() => openAdd(null)}>
              {t("connector.slack.addAgent")}
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
            each={props.workspaces}
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
            {(connected) => (
              <Item class="settings-modal-row">
                <ItemMedia>
                  <LogoTile>
                    <SlackMark />
                  </LogoTile>
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>{connected.name}</ItemTitle>
                  <ItemDescription>{t("connector.slack.workspaceDescription")}</ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={props.busy}
                    onClick={() => props.onDisconnectWorkspace(connected.workspaceId)}
                  >
                    {t("connector.slack.disconnectWorkspace")}
                  </Button>
                </ItemActions>
              </Item>
            )}
          </For>
        </ItemGroup>
      </SettingsSection>

      <Show when={workspace() || memberCount() > 0}>
        <SettingsSection
          title={t("connector.slack.agentsTitle")}
          description={
            memberCount() > 0
              ? t("connector.slack.agentsDescription", { count: memberCount(), live: liveCount() })
              : t("connector.slack.agentsNone")
          }
        >
          <AgentTable
            agents={props.agents}
            connections={byAgent()}
            canAdd={workspace() !== null}
            busy={props.busy}
            onAdd={openAdd}
            onOpenInstall={props.onOpenInstall}
            onReconnect={props.onReconnect}
            onSetEnabled={props.onSetEnabled}
            onRemove={(agentId) =>
              setDialogs((draft) => {
                draft.removeAgentId = agentId;
              })
            }
          />
          <Text class="slack-integration-note" variant="caption" tone="muted">
            {t("connector.slack.limit")}
          </Text>
        </SettingsSection>
        <Text class="slack-integration-note" variant="caption" tone="muted">
          {t("connector.slack.warning")}
        </Text>
      </Show>

      <Show when={workspace()}>
        {(target) => (
          <SlackAddAgentDialog
            open={dialogs.addOpen}
            initialAgentId={dialogs.addAgentId}
            agents={props.agents}
            connections={byAgent()}
            workspace={target()}
            busy={props.busy}
            onCreate={(agentId) => props.onCreateApp(agentId, target().workspaceId)}
            onOpenInstall={props.onOpenInstall}
            onClose={() =>
              setDialogs((draft) => {
                draft.addOpen = false;
              })
            }
          />
        )}
      </Show>
      <RemoveDialog
        agent={removing()}
        onConfirm={(agentId) => {
          setDialogs((draft) => {
            draft.removeAgentId = null;
          });
          props.onRemove(agentId);
        }}
        onClose={() =>
          setDialogs((draft) => {
            draft.removeAgentId = null;
          })
        }
      />
    </div>
  );
}

function AgentFace(props: { agent: IntegrationAgent; size?: "sm" | "md" }) {
  return (
    <span class="integrations-agent-face" data-size={props.size ?? "md"}>
      <AgentAvatar agent={props.agent} motion="idle" />
    </span>
  );
}

function AgentTable(props: {
  agents: SlackIntegrationAgent[];
  connections: ReadonlyMap<string, MessagingConnection>;
  canAdd: boolean;
  busy: boolean;
  onAdd: (agentId: string) => void;
  onOpenInstall: (agentId: string) => void;
  onReconnect: (agentId: string) => void;
  onSetEnabled: (agentId: string, enabled: boolean) => void;
  onRemove: (agentId: string) => void;
}) {
  const { t, format } = useText();
  // Agents in Slack first, in the order of the agent list.
  const rows = () =>
    [...props.agents].sort(
      (left, right) =>
        Number(rowKind(props.connections.get(left.id)) === "none") -
        Number(rowKind(props.connections.get(right.id)) === "none"),
    );
  return (
    <div class="slack-integration-table-wrap">
      <table class="slack-integration-table">
        <caption class="sr-only">{t("connector.slack.tableCaption")}</caption>
        <thead>
          <tr>
            <th scope="col">{t("connector.slack.columnAgent")}</th>
            <th scope="col">{t("connector.slack.columnStatus")}</th>
            <th scope="col">
              <span class="sr-only">{t("connector.slack.columnActions")}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <For each={rows()}>
            {(agent) => {
              const connection = () => props.connections.get(agent.id);
              const kind = () => rowKind(connection());
              const note = () => {
                const current = connection();
                if (!current || kind() === "none") return null;
                if (current.missingScopes.length > 0)
                  return t("connector.slack.missingScopes", { scopes: format.list(current.missingScopes) });
                if (current.retryAt)
                  return t("connector.slack.retryAt", {
                    time: format.date(new Date(current.retryAt), { hour: "numeric", minute: "2-digit" }),
                  });
                const help = STATE_HELP[current.state];
                return help ? t(help) : null;
              };
              return (
                <tr data-status={kind()}>
                  <th scope="row">
                    <span class="slack-integration-agent">
                      <AgentFace agent={agent} size="sm" />
                      <span class="slack-integration-stack">
                        <Text as="span" variant="label-sm">
                          {agent.name}
                        </Text>
                        <Text as="span" variant="caption" tone="muted">
                          {kind() === "none"
                            ? t("connector.slack.notAdded")
                            : (connection()?.workspaceName ?? t("connector.slack.title"))}
                        </Text>
                      </span>
                    </span>
                  </th>
                  <td>
                    <span class="slack-integration-stack">
                      <StatusPill
                        status={ROW_STATUS[kind()]}
                        label={
                          kind() === "none"
                            ? t("connector.slack.statusNotAdded")
                            : t(STATE_LABEL[connection()?.state ?? "paused"])
                        }
                      />
                      <Show when={note()}>
                        {(text) => (
                          <Text as="span" variant="caption" tone="muted">
                            {text()}
                          </Text>
                        )}
                      </Show>
                    </span>
                  </td>
                  <td class="slack-integration-actions">
                    <RowActions
                      name={agent.name}
                      kind={kind()}
                      awaitingInstall={connection()?.state === "awaiting_install"}
                      canAdd={props.canAdd}
                      busy={props.busy}
                      onAdd={() => props.onAdd(agent.id)}
                      onOpenInstall={() => props.onOpenInstall(agent.id)}
                      onReconnect={() => props.onReconnect(agent.id)}
                      onSetEnabled={(enabled) => props.onSetEnabled(agent.id, enabled)}
                      onRemove={() => props.onRemove(agent.id)}
                    />
                  </td>
                </tr>
              );
            }}
          </For>
        </tbody>
      </table>
    </div>
  );
}

function RowActions(props: {
  name: string;
  kind: RowKind;
  awaitingInstall: boolean;
  canAdd: boolean;
  busy: boolean;
  onAdd: () => void;
  onOpenInstall: () => void;
  onReconnect: () => void;
  onSetEnabled: (enabled: boolean) => void;
  onRemove: () => void;
}) {
  const { t } = useText();
  const label = (action: string) => t("connector.slack.rowAction", { action, name: props.name });
  const action = (text: string, onClick: () => void, variant: "outline" | "ghost" = "ghost") => (
    <Button type="button" size="xs" variant={variant} disabled={props.busy} aria-label={label(text)} onClick={onClick}>
      {text}
    </Button>
  );
  return (
    <Switch>
      <Match when={props.kind === "none"}>
        <Show when={props.canAdd}>{action(t("connector.slack.addToSlack"), props.onAdd, "outline")}</Show>
      </Match>
      <Match when={props.kind !== "none"}>
        <span class="slack-integration-row-actions">
          <Switch>
            <Match when={props.awaitingInstall}>
              {action(t("connector.slack.continueInstall"), props.onOpenInstall, "outline")}
            </Match>
            <Match when={props.kind === "attention"}>
              {action(t("connector.slack.reconnect"), props.onReconnect, "outline")}
            </Match>
            <Match when={props.kind === "paused"}>
              {action(t("connector.slack.resume"), () => props.onSetEnabled(true))}
            </Match>
            <Match when={props.kind === "live" || props.kind === "setup"}>
              {action(t("connector.slack.pause"), () => props.onSetEnabled(false))}
            </Match>
          </Switch>
          <Button
            type="button"
            size="xs"
            variant="destructive-ghost"
            disabled={props.busy}
            aria-label={label(t("connector.slack.remove"))}
            onClick={props.onRemove}
          >
            {t("connector.slack.remove")}
          </Button>
        </span>
      </Match>
    </Switch>
  );
}

/** How the agent's app looks in a Slack channel: its name, its picture and the app label. */
function SlackMessagePreview(props: { agent: IntegrationAgent }) {
  const { t } = useText();
  return (
    <figure class="slack-preview" aria-label={t("connector.slack.previewLabel", { name: props.agent.name })}>
      <div class="slack-preview-channel">
        <Hash size={14} aria-hidden="true" />
        <Text as="span" variant="label-sm">
          {t("connector.slack.previewChannel")}
        </Text>
      </div>
      <div class="slack-preview-message">
        <span class="slack-preview-avatar">
          <AgentAvatar agent={props.agent} motion="idle" />
        </span>
        <div class="slack-preview-body">
          <div class="slack-preview-meta">
            <Text as="span" variant="label">
              {props.agent.name}
            </Text>
            <span class="slack-preview-app">{t("connector.slack.previewApp")}</span>
          </div>
          <Text variant="body-sm">{t("connector.slack.previewMessage", { name: props.agent.name })}</Text>
        </div>
      </div>
    </figure>
  );
}

/** 0 to 2 are the user's steps. 3 waits for the install in Slack, and 4 is done. */
type AddStep = 0 | 1 | 2 | 3 | 4;

/**
 * Adds one agent. The first three steps are local; the last two follow the agent's connection, so
 * an install that ends in the browser moves the dialog on by itself.
 */
export function SlackAddAgentDialog(props: {
  open: boolean;
  initialAgentId: string | null;
  agents: SlackIntegrationAgent[];
  connections: ReadonlyMap<string, MessagingConnection>;
  workspace: SlackWorkspace;
  busy: boolean;
  onCreate: (agentId: string) => void;
  onOpenInstall: (agentId: string) => void;
  onClose: () => void;
}) {
  const { t } = useText();
  const [local, setLocal] = createStore<{ step: 0 | 1 | 2; agentId: string | null }>({ step: 0, agentId: null });
  createEffect(
    () => props.open,
    (open) => {
      if (!open) return;
      setLocal((draft) => {
        draft.agentId = props.initialAgentId;
        // An agent chosen on its row skips the picker.
        draft.step = props.initialAgentId ? 1 : 0;
      });
    },
  );
  const added = (agentId: string) => rowKind(props.connections.get(agentId)) !== "none";
  const agent = () => props.agents.find((candidate) => candidate.id === local.agentId) ?? null;
  const step = (): AddStep => {
    const connection = local.agentId ? props.connections.get(local.agentId) : undefined;
    if (rowKind(connection) === "none") return local.step;
    return connection?.state === "awaiting_install" ? 3 : 4;
  };
  const link = (): WizardLink => (step() === 4 ? "connected" : "connecting");
  const name = () => agent()?.name ?? "";
  const copy = () => {
    switch (step()) {
      case 0:
        return { title: t("connector.slack.pickTitle"), description: t("connector.slack.pickDescription") };
      case 1:
        return {
          title: t("connector.slack.previewTitle", { name: name() }),
          description: t("connector.slack.previewDescription"),
        };
      case 2:
        return { title: t("connector.slack.createTitle"), description: t("connector.slack.createDescription") };
      case 3:
        return { title: t("connector.slack.installTitle"), description: t("connector.slack.installDescription") };
      case 4:
        return {
          title: t("connector.slack.doneTitle", { name: name() }),
          description: t("connector.slack.doneDescription", { name: name() }),
        };
    }
  };
  const steps = () => [
    t("connector.slack.stepAgent"),
    t("connector.slack.stepPreview"),
    t("connector.slack.stepCreate"),
    t("connector.slack.stepInstall"),
  ];
  const back = () =>
    setLocal((draft) => {
      draft.step = draft.step === 2 ? 1 : 0;
    });
  const next = () =>
    setLocal((draft) => {
      draft.step = draft.step === 0 ? 1 : 2;
    });
  const backButton = (
    <Button type="button" size="sm" variant="ghost" onClick={back}>
      {t("connector.slack.back")}
    </Button>
  );
  return (
    <WizardDialog
      open={props.open}
      closeLabel={t("connector.slack.close")}
      onClose={props.onClose}
      logo={<SlackMark />}
      link={link()}
      title={copy().title}
      description={copy().description}
      stepper={<Stepper steps={steps()} current={step()} label={t("connector.slack.addAgent")} />}
      footer={
        <Switch>
          <Match when={step() === 0}>
            <Button type="button" size="sm" disabled={!agent()} onClick={next}>
              {t("connector.slack.continue")}
            </Button>
          </Match>
          <Match when={step() === 1}>
            {backButton}
            <Button type="button" size="sm" onClick={next}>
              {t("connector.slack.continue")}
            </Button>
          </Match>
          <Match when={step() === 2 && agent()}>
            {(current) => (
              <>
                {backButton}
                <Button type="button" size="sm" loading={props.busy} onClick={() => props.onCreate(current().id)}>
                  <ExternalLink size={14} aria-hidden="true" />
                  {t("connector.slack.createInSlack")}
                </Button>
              </>
            )}
          </Match>
          <Match when={step() === 3 && agent()}>
            {(current) => (
              <Button type="button" size="sm" disabled={props.busy} onClick={() => props.onOpenInstall(current().id)}>
                <ExternalLink size={14} aria-hidden="true" />
                {t("connector.slack.openSlack")}
              </Button>
            )}
          </Match>
          <Match when={step() === 4}>
            <Button type="button" size="sm" onClick={props.onClose}>
              {t("connector.slack.done")}
            </Button>
          </Match>
        </Switch>
      }
    >
      <Switch>
        <Match when={step() === 0}>
          <fieldset class="slack-agent-picker">
            <legend class="sr-only">{t("connector.slack.pickLegend")}</legend>
            <For each={props.agents}>
              {(candidate) => (
                <Button
                  type="button"
                  variant="outline"
                  class="slack-agent-option"
                  aria-pressed={local.agentId === candidate.id ? "true" : "false"}
                  disabled={added(candidate.id)}
                  onClick={() =>
                    setLocal((draft) => {
                      draft.agentId = candidate.id;
                    })
                  }
                >
                  <AgentFace agent={candidate} />
                  <Text as="span" variant="label-sm" truncate>
                    {candidate.name}
                  </Text>
                  <Text as="span" variant="caption" tone="muted" truncate>
                    {added(candidate.id) ? t("connector.slack.alreadyAdded") : candidate.title}
                  </Text>
                </Button>
              )}
            </For>
          </fieldset>
        </Match>
        <Match when={(step() === 1 || step() === 4) && agent()}>
          {(current) => <SlackMessagePreview agent={current()} />}
        </Match>
        <Match when={step() === 2}>
          <ol class="slack-checklist">
            <li data-state="done">
              <Check size={14} aria-hidden="true" />
              {t("connector.slack.createIdentity", { name: name() })}
            </li>
            <li data-state="done">
              <Check size={14} aria-hidden="true" />
              {t("connector.slack.createScopes")}
            </li>
            <li>
              <span class="slack-checklist-dot" aria-hidden="true" />
              {t("connector.slack.createConfirm")}
            </li>
          </ol>
        </Match>
        <Match when={step() === 3}>
          <div class="slack-waiting" aria-live="polite">
            <Spinner size="sm" />
            <Text variant="caption" tone="muted">
              {t("connector.slack.installWaiting", { workspace: props.workspace.name })}
            </Text>
          </div>
        </Match>
      </Switch>
    </WizardDialog>
  );
}

function RemoveDialog(props: {
  agent: IntegrationAgent | null;
  onConfirm: (agentId: string) => void;
  onClose: () => void;
}) {
  const { t } = useText();
  const name = () => props.agent?.name ?? "";
  return (
    <WizardDialog
      open={props.agent !== null}
      closeLabel={t("connector.slack.close")}
      onClose={props.onClose}
      logo={<SlackMark />}
      link="broken"
      title={t("connector.slack.removeTitle", { name: name() })}
      description={t("connector.slack.removeDescription", { name: name() })}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={props.onClose}>
            {t("connector.slack.keep")}
          </Button>
          <Show when={props.agent}>
            {(agent) => (
              <Button type="button" variant="destructive" onClick={() => props.onConfirm(agent().id)}>
                <Link2Off aria-hidden="true" />
                {t("connector.slack.remove")}
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
          {t("connector.slack.removeEffectApp", { name: name() })}
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
