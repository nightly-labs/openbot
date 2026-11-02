import type { ConnectTelegramChatInput, MessagingConnection } from "@openbot/contracts/ipc";
import { TELEGRAM_ORCHESTRATOR_AVATAR } from "@openbot/contracts/telegram-app";
import type { AppTextKey } from "@openbot/i18n";
import { Button, ExternalLink, ItemGroup, SettingsSection } from "@openbot/ui";
import { createEffect, createSignal, For, Match, Switch } from "solid-js";
import { useText } from "../../text";
import { TelegramMark } from "./brand-marks";
import {
  type ChannelAgent,
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
} from "./ChannelParts";
import { type IntegrationPageSlots, Stepper, UNKNOWN_STATUS, WizardDialog, type WizardLink } from "./IntegrationLayout";
import { messagingStateUnknown } from "./SlackIntegrationPanel";

export type TelegramIntegrationAgent = ChannelAgent;
/** The model of the Telegram Orchestrator that the user picks in the connect dialog. */
export type TelegramOrchestratorChoice = ChannelOrchestratorChoice;
/** The catalog behind the model picker. Absent, the orchestrator starts on a new agent's default. */
export type TelegramOrchestratorModels = ChannelOrchestratorModels;
export type TelegramChatPlace = ConnectTelegramChatInput["place"];

export interface TelegramIntegrationPanelProps extends IntegrationPageSlots {
  /** Every agent on this computer. */
  agents: TelegramIntegrationAgent[];
  /** The linked Telegram chats. */
  connections: MessagingConnection[];
  /** True while an action runs. Every button waits for it. */
  busy: boolean;
  models?: TelegramOrchestratorModels | undefined;
  /** Resolves `false` when the link did not open, so nothing waits for Telegram. */
  onConnectChat: (place: TelegramChatPlace) => Promise<boolean>;
  onDisconnectChat: (workspaceId: string) => void;
  /** Disconnects every chat. */
  onDisconnectAll: () => void;
  onReconnect: (workspaceId: string) => void;
  onSetEnabled: (workspaceId: string, enabled: boolean) => void;
  onAddOrchestrator: (choice: TelegramOrchestratorChoice | null) => void;
  /** The joined server's name, when the chats are that server's and not this computer's. */
  hostName?: string | undefined;
  /**
   * Why the last read of the chats failed. `connections` are from an earlier read; with none, the
   * state is not known, so the page shows the reason and Retry and offers no connect.
   */
  loadError?: string | null | undefined;
  /** Reads the chats again. */
  onRetry?: (() => void) | undefined;
}

const TELEGRAM_TEXT = {
  title: "connector.telegram.title",
  description: "connector.telegram.description",
  connect: "connector.telegram.connect",
  attentionTitle: "connector.telegram.attentionTitle",
  attentionDescription: "connector.telegram.attentionDescription",
  disconnectAllTitle: "connector.telegram.disconnectAllTitle",
  disconnect: "connector.telegram.disconnectChat",
  reconnect: "connector.telegram.reconnect",
  pause: "connector.telegram.pause",
  resume: "connector.telegram.resume",
  rowAction: "connector.telegram.rowAction",
  addAgent: "connector.telegram.addAgent",
  orchestratorTitle: "connector.telegram.orchestratorTitle",
  orchestratorDescription: "connector.telegram.orchestratorDescription",
  orchestratorNone: "connector.telegram.orchestratorNone",
  orchestratorNoneDescription: "connector.telegram.orchestratorNoneDescription",
  note: "connector.telegram.mentionNote",
  connectStepBrowser: "connector.telegram.connectStepBrowser",
  connectStepAllow: "connector.telegram.connectStepPick",
  connectStepReturn: "connector.telegram.connectStepReturn",
  connectWaiting: "connector.telegram.connectWaiting",
  orchestratorName: "connector.telegram.orchestratorName",
  orchestratorRole: "connector.telegram.orchestratorRole",
  orchestratorDoesReceive: "connector.telegram.orchestratorDoesReceive",
  orchestratorDoesDelegate: "connector.telegram.orchestratorDoesDelegate",
  orchestratorDoesAnswer: "connector.telegram.orchestratorDoesAnswer",
  orchestratorModel: "connector.telegram.orchestratorModel",
  removeEffectKept: "connector.telegram.removeEffectKept",
  removeEffectDeleted: "connector.telegram.removeEffectDeleted",
  keep: "connector.telegram.keep",
  close: "connector.telegram.close",
} as const satisfies ChannelText;

const STATE_HELP: Partial<Record<MessagingConnection["state"], AppTextKey>> = {
  removed: "connector.telegram.helpRemoved",
  relay_unavailable: "connector.telegram.helpRelayUnavailable",
  invalid_token: "connector.telegram.helpError",
  secret_storage_unavailable: "connector.telegram.helpError",
  error: "connector.telegram.helpError",
};

/** Telegram gives a group, a supergroup and a channel a negative ID, and a direct chat a positive one. */
function isGroupChat(connection: MessagingConnection): boolean {
  return connection.workspaceId.startsWith("-");
}

/** The one orchestrator agent of all Telegram chats, when it still exists. */
export function telegramOrchestrator<Agent extends { id: string }>(
  connections: readonly MessagingConnection[],
  agents: readonly Agent[],
): Agent | null {
  for (const connection of connections) {
    const agent = agents.find((candidate) => candidate.id === connection.orchestratorAgentId);
    if (agent) return agent;
  }
  return null;
}

/** The state of the whole Telegram integration, for the page header and the Marketplace. */
export function telegramIntegrationState(
  connections: readonly MessagingConnection[],
  agents: readonly { id: string }[],
  loadError?: string | null,
): ChannelState {
  if (messagingStateUnknown({ connections, loadError })) return { ...UNKNOWN_STATUS, attention: 0 };
  const orchestrator = telegramOrchestrator(connections, agents);
  const attention = connections.filter(
    (connection) => channelRowKind(connection) === "attention" || !orchestrator,
  ).length;
  if (attention > 0) return { status: "attention", label: "connector.telegram.statusAttention", attention };
  if (connections.length === 0) return { status: "idle", label: "marketplace.app.notConnected", attention };
  return { status: "connected", label: "connector.telegram.statusConnected", attention };
}

/** Where the connect dialog starts: at the chat link, or at the orchestrator of the linked chats. */
type DialogStart = "chat" | "agent";

/**
 * Marketplace > Apps > Telegram. Each chat adds the one OpenBot bot, and one Telegram
 * Orchestrator agent receives the messages of all chats, asks the team and answers. A chat links in
 * Telegram, so the chat list follows the connections that the caller reads again.
 */
export function TelegramIntegrationPanel(props: TelegramIntegrationPanelProps) {
  const { t, format } = useText();
  const [dialogOpen, setDialogOpen] = createSignal(false);
  /** Kept after the dialog closes, so its last step stays while it closes. */
  const [dialogStart, setDialogStart] = createSignal<DialogStart>("chat");
  const [disconnecting, setDisconnecting] = createSignal<MessagingConnection | null>(null);
  const orchestrator = () => telegramOrchestrator(props.connections, props.agents);
  /** Disconnecting every chat deletes the orchestrator too: no chat uses it after. */
  const disconnectAllSummary = () =>
    t(
      orchestrator() === null
        ? "connector.telegram.disconnectAllSummary"
        : "connector.telegram.disconnectAllSummaryOrchestrator",
    );
  const note = (connection: MessagingConnection) => {
    if (connection.retryAt)
      return t("connector.telegram.retryAt", {
        time: format.date(new Date(connection.retryAt), { hour: "numeric", minute: "2-digit" }),
      });
    if (connection.state === "relay_unavailable" && props.hostName)
      return t("connector.telegram.helpRelayUnavailableHost", { host: props.hostName });
    const help = STATE_HELP[connection.state];
    if (help) return t(help);
    return isGroupChat(connection)
      ? t("connector.telegram.groupDescription")
      : t("connector.telegram.directDescription");
  };
  const disconnectingName = () => disconnecting()?.workspaceName ?? "";
  const openDialog = (start: DialogStart) => {
    setDialogStart(start);
    setDialogOpen(true);
  };

  return (
    <ChannelPage
      text={TELEGRAM_TEXT}
      logo={<TelegramMark />}
      state={telegramIntegrationState(props.connections, props.agents, props.loadError)}
      connections={props.connections}
      unknown={messagingStateUnknown(props)}
      busy={props.busy}
      loadError={props.loadError}
      onRetry={props.onRetry}
      onConnect={() => openDialog("chat")}
      disconnectAllSummary={disconnectAllSummary()}
      onDisconnectAll={props.onDisconnectAll}
      tagline={props.tagline}
      intro={props.intro}
      details={props.details}
      sections={
        <>
          <SettingsSection
            title={t("connector.telegram.chatsTitle")}
            actions={
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={props.busy}
                onClick={() => openDialog("chat")}
              >
                {t("connector.telegram.linkChat")}
              </Button>
            }
          >
            <ItemGroup class="settings-modal-card">
              <For each={props.connections}>
                {(connection) => (
                  <ChannelConnectionRow
                    text={TELEGRAM_TEXT}
                    logo={<TelegramMark />}
                    connection={connection}
                    note={note(connection)}
                    busy={props.busy}
                    // A removed chat is unlinked from this computer. Only a new link with the bot brings it back.
                    canReconnect={connection.state !== "removed"}
                    onReconnect={() => props.onReconnect(connection.workspaceId)}
                    onSetEnabled={(enabled) => props.onSetEnabled(connection.workspaceId, enabled)}
                    onDisconnect={() => setDisconnecting(connection)}
                  />
                )}
              </For>
            </ItemGroup>
          </SettingsSection>

          <ChannelOrchestratorSection
            text={TELEGRAM_TEXT}
            avatar={TELEGRAM_ORCHESTRATOR_AVATAR}
            agents={orchestratorList(orchestrator())}
            busy={props.busy}
            onAddAgent={() => openDialog("agent")}
          />
        </>
      }
    >
      <TelegramConnectDialog
        open={dialogOpen()}
        start={dialogStart()}
        connections={props.connections}
        agents={props.agents}
        busy={props.busy}
        models={props.models}
        onConnectChat={props.onConnectChat}
        onAddOrchestrator={props.onAddOrchestrator}
        onClose={() => setDialogOpen(false)}
      />
      <ChannelDisconnectDialog
        text={TELEGRAM_TEXT}
        logo={<TelegramMark />}
        connection={disconnecting()}
        title={t("connector.telegram.disconnectTitle", { chat: disconnectingName() })}
        description={t("connector.telegram.leaveDescription", { chat: disconnectingName() })}
        effect={t("connector.telegram.disconnectEffect", { chat: disconnectingName() })}
        // The last linked chat: its disconnect deletes the Telegram Orchestrator.
        deletesOrchestrator={props.connections.length === 1 && orchestrator() !== null}
        onConfirm={(workspaceId) => {
          setDisconnecting(null);
          props.onDisconnectChat(workspaceId);
        }}
        onClose={() => setDisconnecting(null)}
      />
    </ChannelPage>
  );
}

function orchestratorList(agent: TelegramIntegrationAgent | null): TelegramIntegrationAgent[] {
  return agent ? [agent] : [];
}

/** 0 links a chat, 1 adds the orchestrator, and 2 is done. */
type ConnectStep = 0 | 1 | 2;

/**
 * Connects Telegram in two steps. The chat links in Telegram, outside the dialog, so the step follows
 * the connections. From `start` "chat", the dialog waits for a chat that was not there when it opened;
 * from "agent", it adds the orchestrator of the chats that are linked. With a chat and the orchestrator,
 * it is done. The orchestrator shows only on a chat, so the chat comes first.
 */
export function TelegramConnectDialog(props: {
  open: boolean;
  start: DialogStart;
  connections: readonly MessagingConnection[];
  agents: readonly { id: string }[];
  busy: boolean;
  models?: TelegramOrchestratorModels | undefined;
  onConnectChat: (place: TelegramChatPlace) => Promise<boolean>;
  onAddOrchestrator: (choice: TelegramOrchestratorChoice | null) => void;
  onClose: () => void;
}) {
  const { t } = useText();
  const [waiting, setWaiting] = createSignal(false);
  const [choice, setChoice] = createSignal<TelegramOrchestratorChoice | null>(null);
  /** The chats when the dialog opened. A chat that is not in it is the one that the user just linked. */
  const [before, setBefore] = createSignal<ReadonlySet<string>>(new Set());
  createEffect(
    () => props.open,
    (open) => {
      if (!open) return;
      setWaiting(false);
      setChoice(props.models?.initial ?? null);
      setBefore(new Set(props.connections.map((connection) => connection.workspaceId)));
    },
  );
  const linked = () => props.connections.find((connection) => !before().has(connection.workspaceId)) ?? null;
  /** The chat that the dialog is about: the new one, or the first one for the orchestrator. */
  const current = () => linked() ?? (props.start === "agent" ? (props.connections[0] ?? null) : null);
  const step = (): ConnectStep => {
    if (!current()) return 0;
    return telegramOrchestrator(props.connections, props.agents) ? 2 : 1;
  };
  const dialogLink = (): WizardLink => (step() === 2 ? "connected" : "connecting");
  const chat = () => current()?.workspaceName ?? "";
  const copy = () => {
    switch (step()) {
      case 0:
        return { title: t("connector.telegram.connectTitle"), description: t("connector.telegram.connectDescription") };
      case 1:
        return {
          title: t("connector.telegram.agentStepTitle"),
          description: t("connector.telegram.agentStepDescription", { chat: chat() }),
        };
      case 2:
        return {
          title: t("connector.telegram.doneTitle", { chat: chat() }),
          description: t("connector.telegram.mentionNote"),
        };
    }
  };
  const steps = () => [t("connector.telegram.stepChat"), t("connector.telegram.stepAgent")];
  const connect = (place: TelegramChatPlace) => {
    setWaiting(true);
    void props.onConnectChat(place).then((opened) => {
      if (!opened) setWaiting(false);
    });
  };
  return (
    <WizardDialog
      open={props.open}
      closeLabel={t("connector.telegram.close")}
      onClose={props.onClose}
      logo={<TelegramMark />}
      link={dialogLink()}
      title={copy().title}
      description={copy().description}
      stepper={<Stepper steps={steps()} current={step()} label={t("connector.telegram.connect")} />}
      footer={
        <Switch>
          <Match when={step() === 0}>
            <Button type="button" size="sm" variant="outline" loading={props.busy} onClick={() => connect("direct")}>
              <ExternalLink size={14} aria-hidden="true" />
              {t("connector.telegram.openDirectChat")}
            </Button>
            <Button type="button" size="sm" loading={props.busy} onClick={() => connect("group")}>
              <ExternalLink size={14} aria-hidden="true" />
              {t("connector.telegram.addToGroup")}
            </Button>
          </Match>
          <Match when={step() === 1}>
            <Button type="button" size="sm" loading={props.busy} onClick={() => props.onAddOrchestrator(choice())}>
              {t("connector.telegram.addAgent")}
            </Button>
          </Match>
          <Match when={step() === 2}>
            <Button type="button" size="sm" onClick={props.onClose}>
              {t("connector.telegram.done")}
            </Button>
          </Match>
        </Switch>
      }
    >
      <Switch>
        <Match when={step() === 0}>
          <ChannelConnectChecklist text={TELEGRAM_TEXT} waiting={waiting()} />
        </Match>
        <Match when={step() === 1}>
          <ChannelOrchestratorStep
            text={TELEGRAM_TEXT}
            avatar={TELEGRAM_ORCHESTRATOR_AVATAR}
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
