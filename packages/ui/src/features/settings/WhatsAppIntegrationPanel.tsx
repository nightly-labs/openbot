import type {
  MessagingConnection,
  StartWhatsAppLinkInput,
  WhatsAppAccount,
  WhatsAppGroup,
  WhatsAppLinkState,
  WhatsAppPairingRequest,
  WhatsAppSender,
} from "@openbot/contracts/ipc";
import { MESSAGING_LIMITS, parseWhatsAppPhoneNumber } from "@openbot/contracts/ipc";
import { WHATSAPP_ORCHESTRATOR_AVATAR } from "@openbot/contracts/whatsapp-app";
import type { AppTextKey } from "@openbot/i18n";
import {
  Alert,
  AlertContent,
  AlertDescription,
  AlertIcon,
  AlertTitle,
  Button,
  CopyButton,
  Field,
  Input,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
  OctagonX,
  QrCode,
  RadioGroup,
  SettingsSection,
  Spinner,
  SwitchField,
  Text,
  TriangleAlert,
  UserRound,
  UsersRound,
} from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createEffect, createSignal, createStore, For, Match, onCleanup, Show, Switch, untrack } from "solid-js";
import { useText } from "../../text";
import { WhatsAppMark } from "./brand-marks";
import {
  type ChannelAgent,
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
import {
  type IntegrationPageSlots,
  LogoTile,
  ReadFailedAlert,
  Stepper,
  UNKNOWN_STATUS,
  WizardDialog,
  type WizardLink,
} from "./IntegrationLayout";
import { messagingStateUnknown } from "./SlackIntegrationPanel";
import { telegramOrchestrator } from "./TelegramIntegrationPanel";

export type WhatsAppIntegrationAgent = ChannelAgent;
/** The model of the WhatsApp Orchestrator that the user picks in the link dialog. */
export type WhatsAppOrchestratorChoice = ChannelOrchestratorChoice;
/** The catalog behind the model picker. Absent, the orchestrator starts on a new agent's default. */
export type WhatsAppOrchestratorModels = ChannelOrchestratorModels;

/** No link runs. */
export const WHATSAPP_LINK_IDLE: WhatsAppLinkState = {
  status: "idle",
  qr: null,
  code: null,
  workspaceId: null,
  error: null,
};

export interface WhatsAppIntegrationPanelProps extends IntegrationPageSlots {
  /** Every agent on this computer. */
  agents: WhatsAppIntegrationAgent[];
  /** The linked WhatsApp numbers. */
  connections: MessagingConnection[];
  /** The settings of each linked number, by `workspaceId`. */
  accounts: WhatsAppAccount[];
  /** True while an action runs. Every button waits for it. */
  busy: boolean;
  models?: WhatsAppOrchestratorModels | undefined;
  /** The link that runs now. The caller reads it again while it waits for the phone. */
  link: WhatsAppLinkState;
  onStartLink: (input: StartWhatsAppLinkInput) => void;
  /** The link dialog closed. The caller cancels a link that did not end in `linked`. */
  onEndLink: () => void;
  onDisconnectNumber: (workspaceId: string) => void;
  /** Disconnects every number. */
  onDisconnectAll: () => void;
  onReconnect: (workspaceId: string) => void;
  onSetEnabled: (workspaceId: string, enabled: boolean) => void;
  onSetOwnNumber: (workspaceId: string, ownNumber: boolean) => void;
  onAddOrchestrator: (choice: WhatsAppOrchestratorChoice | null) => void;
  /** The groups of a linked number, to choose from. Rejects with the reason. */
  loadGroups: (workspaceId: string) => Promise<readonly WhatsAppGroup[]>;
  onAddSender: (workspaceId: string, sender: WhatsAppSender) => void;
  onRemoveSender: (workspaceId: string, senderId: string) => void;
  onAnswerRequest: (workspaceId: string, code: string, approve: boolean) => void;
  /**
   * Why the last read of the numbers failed. `connections` are from an earlier read; with none, the
   * state is not known, so the page shows the reason and Retry and offers no link.
   */
  loadError?: string | null | undefined;
  /** Reads the numbers again. */
  onRetry?: (() => void) | undefined;
}

const WHATSAPP_TEXT = {
  title: "connector.whatsapp.title",
  description: "connector.whatsapp.description",
  connect: "connector.whatsapp.connect",
  attentionTitle: "connector.whatsapp.attentionTitle",
  attentionDescription: "connector.whatsapp.attentionDescription",
  disconnectAllTitle: "connector.whatsapp.disconnectAllTitle",
  disconnect: "connector.whatsapp.disconnect",
  reconnect: "connector.whatsapp.reconnect",
  pause: "connector.whatsapp.pause",
  resume: "connector.whatsapp.resume",
  rowAction: "connector.whatsapp.rowAction",
  addAgent: "connector.whatsapp.addAgent",
  orchestratorTitle: "connector.whatsapp.orchestratorTitle",
  orchestratorDescription: "connector.whatsapp.orchestratorDescription",
  orchestratorNone: "connector.whatsapp.orchestratorNone",
  orchestratorNoneDescription: "connector.whatsapp.orchestratorNoneDescription",
  note: "connector.whatsapp.note",
  connectStepBrowser: "connector.whatsapp.connectStepOpen",
  connectStepAllow: "connector.whatsapp.connectStepDevices",
  connectStepReturn: "connector.whatsapp.connectStepScan",
  connectWaiting: "connector.whatsapp.connectWaiting",
  orchestratorName: "connector.whatsapp.orchestratorName",
  orchestratorRole: "connector.whatsapp.orchestratorRole",
  orchestratorDoesReceive: "connector.whatsapp.orchestratorDoesReceive",
  orchestratorDoesDelegate: "connector.whatsapp.orchestratorDoesDelegate",
  orchestratorDoesAnswer: "connector.whatsapp.orchestratorDoesAnswer",
  orchestratorModel: "connector.whatsapp.orchestratorModel",
  removeEffectKept: "connector.whatsapp.removeEffectKept",
  removeEffectDeleted: "connector.whatsapp.removeEffectDeleted",
  keep: "connector.whatsapp.keep",
  close: "connector.whatsapp.close",
} as const satisfies ChannelText;

const STATE_HELP: Partial<Record<MessagingConnection["state"], AppTextKey>> = {
  // WhatsApp removed the linked device: only a new link brings the number back.
  invalid_token: "connector.whatsapp.helpLoggedOut",
  secret_storage_unavailable: "connector.whatsapp.helpError",
  error: "connector.whatsapp.helpError",
};

const LINK_ERROR = {
  timeout: "connector.whatsapp.failedTimeout",
  refused: "connector.whatsapp.failedRefused",
  busy: "connector.whatsapp.failedBusy",
  unavailable: "connector.whatsapp.failedUnavailable",
} as const satisfies Record<NonNullable<WhatsAppLinkState["error"]>, AppTextKey>;

/** A WhatsApp number in digits, as people write it. */
function phoneNumber(digits: string): string {
  return `+${digits}`;
}

/** A phone number with only its country part and its last digits visible. */
function maskedNumber(digits: string): string {
  return `+${digits.slice(0, 2)} ••• ${digits.slice(-3)}`;
}

/** The pairing code in two groups of four, as WhatsApp shows the field for it. */
function groupedCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** The name of a linked number: its WhatsApp name, or the number. */
function numberName(connection: MessagingConnection): string {
  return connection.workspaceName || phoneNumber(connection.workspaceId);
}

/** The one orchestrator agent of all WhatsApp numbers, when it still exists. Telegram shares one in the same way. */
export const whatsappOrchestrator = telegramOrchestrator;

/** The state of the whole WhatsApp integration, for the page header and the Marketplace. */
export function whatsappIntegrationState(
  connections: readonly MessagingConnection[],
  agents: readonly { id: string }[],
  loadError?: string | null,
): ChannelState {
  if (messagingStateUnknown({ connections, loadError })) return { ...UNKNOWN_STATUS, attention: 0 };
  const orchestrator = whatsappOrchestrator(connections, agents);
  const attention = connections.filter(
    (connection) => channelRowKind(connection) === "attention" || !orchestrator,
  ).length;
  if (attention > 0) return { status: "attention", label: "connector.whatsapp.statusAttention", attention };
  if (connections.length === 0) return { status: "idle", label: "marketplace.app.notConnected", attention };
  return { status: "connected", label: "connector.whatsapp.statusConnected", attention };
}

/** Where the link dialog starts: at the number link, or at the orchestrator of the linked numbers. */
type DialogStart = "number" | "agent";

/**
 * Marketplace > Apps > WhatsApp. Each number links this computer as a device from WhatsApp on the
 * phone, and one WhatsApp Orchestrator agent receives the messages of all numbers, asks the team and
 * answers. Only the allowed contacts and groups reach it; on a number only for OpenBot, an unknown
 * person gets a code that the owner approves here.
 */
export function WhatsAppIntegrationPanel(props: WhatsAppIntegrationPanelProps) {
  const { t, format } = useText();
  const [dialogOpen, setDialogOpen] = createSignal(false);
  /** Kept after the dialog closes, so its last step stays while it closes. */
  const [dialogStart, setDialogStart] = createSignal<DialogStart>("number");
  const [disconnecting, setDisconnecting] = createSignal<MessagingConnection | null>(null);
  /** The number that the contact or group dialog adds to; each dialog is open while it is set. */
  const [addingContact, setAddingContact] = createSignal<string | null>(null);
  const [addingGroup, setAddingGroup] = createSignal<string | null>(null);
  const orchestrator = () => whatsappOrchestrator(props.connections, props.agents);
  const account = (workspaceId: string) => props.accounts.find((entry) => entry.workspaceId === workspaceId);
  /** The numbers whose settings are known, in the order of the number list. */
  const linked = () =>
    props.connections.flatMap((connection) => {
      const settings = account(connection.workspaceId);
      return settings ? [{ connection, account: settings }] : [];
    });
  const disconnectAllSummary = () =>
    t(
      orchestrator() === null
        ? "connector.whatsapp.disconnectAllSummary"
        : "connector.whatsapp.disconnectAllSummaryOrchestrator",
    );
  const note = (connection: MessagingConnection) => {
    if (connection.retryAt)
      return t("connector.whatsapp.retryAt", {
        time: format.date(new Date(connection.retryAt), { hour: "numeric", minute: "2-digit" }),
      });
    const help = STATE_HELP[connection.state];
    if (help) return t(help);
    return account(connection.workspaceId)?.ownNumber === false
      ? t("connector.whatsapp.dedicatedNote")
      : t("connector.whatsapp.ownNumberNote");
  };
  const rowLabel = (action: string, name: string) => t("connector.whatsapp.rowAction", { action, name });
  const disconnectingName = () => {
    const connection = disconnecting();
    return connection ? numberName(connection) : "";
  };
  const openDialog = (start: DialogStart) => {
    setDialogStart(start);
    setDialogOpen(true);
  };
  const closeDialog = () => {
    setDialogOpen(false);
    if (dialogStart() === "number") props.onEndLink();
  };
  // A page that goes away with the dialog open ends its link too: nothing reads it after.
  onCleanup(() => {
    if (dialogOpen() && dialogStart() === "number") props.onEndLink();
  });

  return (
    <ChannelPage
      text={WHATSAPP_TEXT}
      logo={<WhatsAppMark />}
      state={whatsappIntegrationState(props.connections, props.agents, props.loadError)}
      connections={props.connections}
      unknown={messagingStateUnknown(props)}
      busy={props.busy}
      loadError={props.loadError}
      onRetry={props.onRetry}
      onConnect={() => openDialog("number")}
      notice={
        <Alert tone="warning" report={false}>
          <AlertIcon>
            <TriangleAlert />
          </AlertIcon>
          <AlertContent>
            <AlertTitle>{t("connector.whatsapp.warningTitle")}</AlertTitle>
            <AlertDescription>{t("connector.whatsapp.warningDescription")}</AlertDescription>
          </AlertContent>
        </Alert>
      }
      disconnectAllSummary={disconnectAllSummary()}
      onDisconnectAll={props.onDisconnectAll}
      tagline={props.tagline}
      intro={props.intro}
      details={props.details}
      sections={
        <>
          <SettingsSection
            title={t("connector.whatsapp.numbersTitle")}
            actions={
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={props.busy}
                onClick={() => openDialog("number")}
              >
                {t("connector.whatsapp.linkNumber")}
              </Button>
            }
          >
            <ItemGroup class="settings-modal-card">
              <For each={props.connections}>
                {(connection) => (
                  <>
                    <ChannelConnectionRow
                      text={WHATSAPP_TEXT}
                      logo={<WhatsAppMark />}
                      connection={connection}
                      note={note(connection)}
                      busy={props.busy}
                      // WhatsApp removed the device. Only a new link from the phone brings the number back.
                      canReconnect={connection.state !== "invalid_token"}
                      action={
                        <Show when={connection.state === "invalid_token"}>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={props.busy}
                            aria-label={rowLabel(t("connector.whatsapp.linkAgain"), numberName(connection))}
                            onClick={() => openDialog("number")}
                          >
                            {t("connector.whatsapp.linkAgain")}
                          </Button>
                        </Show>
                      }
                      onReconnect={() => props.onReconnect(connection.workspaceId)}
                      onSetEnabled={(enabled) => props.onSetEnabled(connection.workspaceId, enabled)}
                      onDisconnect={() => setDisconnecting(connection)}
                    />
                    <Show when={account(connection.workspaceId)}>
                      {(settings) => (
                        <SwitchField
                          class="settings-modal-row"
                          checked={settings().ownNumber}
                          disabled={props.busy}
                          onChange={(checked) => props.onSetOwnNumber(connection.workspaceId, checked)}
                          label={t("connector.whatsapp.ownNumber")}
                          description={t("connector.whatsapp.ownNumberDescription")}
                        />
                      )}
                    </Show>
                  </>
                )}
              </For>
            </ItemGroup>
          </SettingsSection>

          <ChannelOrchestratorSection
            text={WHATSAPP_TEXT}
            avatar={WHATSAPP_ORCHESTRATOR_AVATAR}
            agents={orchestratorList(orchestrator())}
            busy={props.busy}
            onAddAgent={() => openDialog("agent")}
          />

          <For each={linked()}>
            {(entry) => (
              <>
                <SendersSection
                  connection={entry.connection}
                  account={entry.account}
                  busy={props.busy}
                  onAddContact={() => setAddingContact(entry.connection.workspaceId)}
                  onAddGroup={() => setAddingGroup(entry.connection.workspaceId)}
                  onRemove={(senderId) => props.onRemoveSender(entry.connection.workspaceId, senderId)}
                />
                {/* A personal number answers no stranger, so it shows requests only when some still wait. */}
                <Show when={!entry.account.ownNumber || entry.account.pendingRequests.length > 0}>
                  <RequestsSection
                    connection={entry.connection}
                    requests={entry.account.pendingRequests}
                    busy={props.busy}
                    onAnswer={(code, approve) => props.onAnswerRequest(entry.connection.workspaceId, code, approve)}
                  />
                </Show>
              </>
            )}
          </For>
        </>
      }
    >
      <WhatsAppLinkDialog
        open={dialogOpen()}
        start={dialogStart()}
        connections={props.connections}
        agents={props.agents}
        busy={props.busy}
        models={props.models}
        link={props.link}
        onStartLink={props.onStartLink}
        onAddOrchestrator={props.onAddOrchestrator}
        onClose={closeDialog}
      />
      <ContactDialog
        workspaceId={addingContact()}
        busy={props.busy}
        onAdd={(workspaceId, sender) => {
          setAddingContact(null);
          props.onAddSender(workspaceId, sender);
        }}
        onClose={() => setAddingContact(null)}
      />
      <GroupDialog
        workspaceId={addingGroup()}
        allowed={account(addingGroup() ?? "")?.allowedSenders ?? []}
        busy={props.busy}
        loadGroups={props.loadGroups}
        onAdd={(workspaceId, sender) => {
          setAddingGroup(null);
          props.onAddSender(workspaceId, sender);
        }}
        onClose={() => setAddingGroup(null)}
      />
      <ChannelDisconnectDialog
        text={WHATSAPP_TEXT}
        logo={<WhatsAppMark />}
        connection={disconnecting()}
        title={t("connector.whatsapp.disconnectTitle", { number: disconnectingName() })}
        description={t("connector.whatsapp.disconnectDescription", { number: disconnectingName() })}
        effect={t("connector.whatsapp.disconnectEffect", { number: disconnectingName() })}
        // The last linked number: its disconnect deletes the WhatsApp Orchestrator.
        deletesOrchestrator={props.connections.length === 1 && orchestrator() !== null}
        onConfirm={(workspaceId) => {
          setDisconnecting(null);
          props.onDisconnectNumber(workspaceId);
        }}
        onClose={() => setDisconnecting(null)}
      />
    </ChannelPage>
  );
}

function orchestratorList(agent: WhatsAppIntegrationAgent | null): WhatsAppIntegrationAgent[] {
  return agent ? [agent] : [];
}

/** The contacts and groups that can give work through one number, and the steps that add one. */
function SendersSection(props: {
  connection: MessagingConnection;
  account: WhatsAppAccount;
  busy: boolean;
  onAddContact: () => void;
  onAddGroup: () => void;
  onRemove: (senderId: string) => void;
}) {
  const { t } = useText();
  const senders = () => props.account.allowedSenders;
  const atCap = () => senders().length >= MESSAGING_LIMITS.allowedSenders;
  return (
    <SettingsSection
      title={t("connector.whatsapp.sendersTitle", { number: numberName(props.connection) })}
      description={t("connector.whatsapp.sendersDescription")}
      actions={
        <>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={props.busy || atCap()}
            onClick={props.onAddContact}
          >
            {t("connector.whatsapp.addContact")}
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={props.busy || atCap()} onClick={props.onAddGroup}>
            {t("connector.whatsapp.addGroup")}
          </Button>
        </>
      }
    >
      <ItemGroup class="settings-modal-card">
        <For each={senders()}>
          {(sender) => (
            <Item class="settings-modal-row">
              <ItemMedia>
                <LogoTile>
                  <Show when={sender.kind === "group"} fallback={<UserRound aria-hidden="true" />}>
                    <UsersRound aria-hidden="true" />
                  </Show>
                </LogoTile>
              </ItemMedia>
              <ItemContent>
                <ItemTitle>{sender.name}</ItemTitle>
                <ItemDescription>
                  {sender.kind === "group" ? t("connector.whatsapp.senderGroup") : phoneNumber(sender.id)}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive-ghost"
                  disabled={props.busy}
                  aria-label={t("connector.whatsapp.rowAction", {
                    action: t("connector.whatsapp.removeSender"),
                    name: sender.name,
                  })}
                  onClick={() => props.onRemove(sender.id)}
                >
                  {t("connector.whatsapp.removeSender")}
                </Button>
              </ItemActions>
            </Item>
          )}
        </For>
        <Show when={senders().length === 0}>
          <Text class="integration-card-note" variant="caption" tone="muted">
            {t("connector.whatsapp.sendersEmpty")}
          </Text>
        </Show>
        <Show when={atCap()}>
          <Text class="integration-card-note" variant="caption" tone="muted">
            {t("connector.whatsapp.sendersLimit", { count: MESSAGING_LIMITS.allowedSenders })}
          </Text>
        </Show>
      </ItemGroup>
    </SettingsSection>
  );
}

/** The people who wrote to a number only for OpenBot and wait for the owner. */
function RequestsSection(props: {
  connection: MessagingConnection;
  requests: readonly WhatsAppPairingRequest[];
  busy: boolean;
  onAnswer: (code: string, approve: boolean) => void;
}) {
  const { t } = useText();
  return (
    <SettingsSection
      title={t("connector.whatsapp.requestsTitle", { number: numberName(props.connection) })}
      description={t("connector.whatsapp.requestsDescription")}
    >
      <ItemGroup class="settings-modal-card">
        <For each={props.requests}>
          {(request) => {
            const name = () => request.name || maskedNumber(request.senderId);
            const label = (action: string) => t("connector.whatsapp.rowAction", { action, name: name() });
            return (
              <Item class="settings-modal-row">
                <ItemMedia>
                  <LogoTile>
                    <UserRound aria-hidden="true" />
                  </LogoTile>
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>{name()}</ItemTitle>
                  <ItemDescription>
                    {t("connector.whatsapp.requestDetail", {
                      code: request.code,
                      number: maskedNumber(request.senderId),
                    })}
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={props.busy}
                    aria-label={label(t("connector.whatsapp.approve"))}
                    onClick={() => props.onAnswer(request.code, true)}
                  >
                    {t("connector.whatsapp.approve")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive-ghost"
                    disabled={props.busy}
                    aria-label={label(t("connector.whatsapp.deny"))}
                    onClick={() => props.onAnswer(request.code, false)}
                  >
                    {t("connector.whatsapp.deny")}
                  </Button>
                </ItemActions>
              </Item>
            );
          }}
        </For>
        <Show when={props.requests.length === 0}>
          <Text class="integration-card-note" variant="caption" tone="muted">
            {t("connector.whatsapp.requestsEmpty")}
          </Text>
        </Show>
      </ItemGroup>
    </SettingsSection>
  );
}

/** Adds a contact by phone number. Main keeps the number in digits; the name is optional. */
function ContactDialog(props: {
  /** The number that the contact can write to; the dialog is open while it is set. */
  workspaceId: string | null;
  busy: boolean;
  onAdd: (workspaceId: string, sender: WhatsAppSender) => void;
  onClose: () => void;
}) {
  const { t } = useText();
  const [form, setForm] = createStore({ phone: "", name: "", invalid: false });
  createEffect(
    () => props.workspaceId,
    (workspaceId) => {
      if (!workspaceId) return;
      setForm((draft) => {
        draft.phone = "";
        draft.name = "";
        draft.invalid = false;
      });
    },
  );
  const submit = () => {
    const workspaceId = props.workspaceId;
    if (!workspaceId) return;
    if (!parseWhatsAppPhoneNumber(form.phone)) {
      setForm((draft) => {
        draft.invalid = true;
      });
      return;
    }
    props.onAdd(workspaceId, { kind: "contact", id: form.phone.trim(), name: form.name.trim() });
  };
  return (
    <WizardDialog
      open={props.workspaceId !== null}
      closeLabel={t("connector.whatsapp.close")}
      onClose={props.onClose}
      logo={<WhatsAppMark />}
      link="connected"
      title={t("connector.whatsapp.contactTitle")}
      description={t("connector.whatsapp.contactDescription")}
      onSubmit={submit}
      footer={
        <>
          <Button type="button" size="sm" variant="ghost" onClick={props.onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" size="sm" disabled={props.busy}>
            {t("connector.whatsapp.add")}
          </Button>
        </>
      }
    >
      <Field
        label={t("connector.whatsapp.phoneLabel")}
        description={t("connector.whatsapp.phoneDescription")}
        error={form.invalid ? t("connector.whatsapp.phoneInvalid") : undefined}
        required
      >
        <Input
          type="tel"
          autocomplete="off"
          value={form.phone}
          onValueChange={(value) =>
            setForm((draft) => {
              draft.phone = value;
              draft.invalid = false;
            })
          }
        />
      </Field>
      <Field label={t("connector.whatsapp.contactName")} description={t("connector.whatsapp.contactNameDescription")}>
        <Input
          maxlength={MESSAGING_LIMITS.name}
          autocomplete="off"
          value={form.name}
          onValueChange={(value) =>
            setForm((draft) => {
              draft.name = value;
            })
          }
        />
      </Field>
    </WizardDialog>
  );
}

/** Adds one group of the number. It reads the number's groups when it opens. */
function GroupDialog(props: {
  /** The number whose groups show; the dialog is open while it is set. */
  workspaceId: string | null;
  /** The senders that the number allows now. Their groups show as added. */
  allowed: readonly WhatsAppSender[];
  busy: boolean;
  loadGroups: (workspaceId: string) => Promise<readonly WhatsAppGroup[]>;
  onAdd: (workspaceId: string, sender: WhatsAppSender) => void;
  onClose: () => void;
}) {
  const { t, errorMessage } = useText();
  const [view, setView] = createStore<{
    status: "loading" | "ready" | "failed";
    groups: WhatsAppGroup[];
    error: string;
    query: string;
  }>({ status: "loading", groups: [], error: "", query: "" });
  /** Each read replaces the one before it, so a slow answer never overwrites a newer one. */
  let reads = 0;
  const load = (workspaceId: string) => {
    const read = ++reads;
    setView((draft) => {
      draft.status = "loading";
      draft.error = "";
    });
    void props.loadGroups(workspaceId).then(
      (groups) => {
        if (read !== reads) return;
        setView((draft) => {
          draft.status = "ready";
          draft.groups = groups.map((group) => ({ ...group }));
        });
      },
      (error: unknown) => {
        if (read !== reads) return;
        setView((draft) => {
          draft.status = "failed";
          draft.error = errorMessage(error, t("connector.whatsapp.groupsLoadFailed"));
        });
      },
    );
  };
  createEffect(
    () => props.workspaceId,
    (workspaceId) => {
      reads += 1;
      if (!workspaceId) return;
      setView((draft) => {
        draft.groups = [];
        draft.query = "";
      });
      load(workspaceId);
    },
  );
  const shown = () => {
    const query = view.query.trim().toLocaleLowerCase();
    return query ? view.groups.filter((group) => group.name.toLocaleLowerCase().includes(query)) : view.groups;
  };
  const added = (groupId: string) => props.allowed.some((sender) => sender.id === groupId);
  return (
    <WizardDialog
      open={props.workspaceId !== null}
      closeLabel={t("connector.whatsapp.close")}
      onClose={props.onClose}
      logo={<WhatsAppMark />}
      link="connected"
      title={t("connector.whatsapp.groupTitle")}
      description={t("connector.whatsapp.groupDescription")}
      footer={
        <Button type="button" size="sm" variant="ghost" onClick={props.onClose}>
          {t("common.cancel")}
        </Button>
      }
    >
      <Switch>
        <Match when={view.status === "loading"}>
          <div class="channel-waiting" aria-live="polite">
            <Spinner size="sm" />
            <Text variant="caption" tone="muted">
              {t("connector.whatsapp.groupsLoading")}
            </Text>
          </div>
        </Match>
        <Match when={view.status === "failed"}>
          <ReadFailedAlert
            message={view.error}
            onRetry={() => {
              const workspaceId = props.workspaceId;
              if (workspaceId) load(workspaceId);
            }}
          />
        </Match>
        <Match when={view.groups.length === 0}>
          <Text variant="body-sm" tone="muted" role="status">
            {t("connector.whatsapp.groupsEmpty")}
          </Text>
        </Match>
        <Match when={view.status === "ready"}>
          <Input
            type="search"
            aria-label={t("connector.whatsapp.groupSearch")}
            placeholder={t("connector.whatsapp.groupSearch")}
            value={view.query}
            onValueChange={(value) =>
              setView((draft) => {
                draft.query = value;
              })
            }
          />
          <Show
            when={shown().length > 0}
            fallback={
              <Text variant="body-sm" tone="muted" role="status">
                {t("connector.whatsapp.groupsNoMatch")}
              </Text>
            }
          >
            <ul class="whatsapp-groups" aria-label={t("connector.whatsapp.groupTitle")}>
              <For each={shown()}>
                {(group) => (
                  <li class="whatsapp-group-row">
                    <Text variant="body-sm" class="whatsapp-group-name">
                      {group.name}
                    </Text>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={props.busy || added(group.id)}
                      aria-label={t("connector.whatsapp.rowAction", {
                        action: added(group.id) ? t("connector.whatsapp.groupAdded") : t("connector.whatsapp.add"),
                        name: group.name,
                      })}
                      onClick={() => {
                        const workspaceId = props.workspaceId;
                        if (workspaceId) props.onAdd(workspaceId, { kind: "group", id: group.id, name: group.name });
                      }}
                    >
                      {added(group.id) ? t("connector.whatsapp.groupAdded") : t("connector.whatsapp.add")}
                    </Button>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </Match>
      </Switch>
    </WizardDialog>
  );
}

/** 0 links a number, 1 adds the orchestrator, and 2 is done. */
type LinkStep = 0 | 1 | 2;

/** What the number step shows: the choice, the wait for a code, the code, a failure, or the link. */
type LinkPhase = "choose" | "starting" | "waiting" | "failed" | "linked";

/**
 * Links WhatsApp in two steps. First the user selects what the number is and how the phone links:
 * by a QR code, or by a pairing code for the phone number. The phone links in WhatsApp, so the step
 * follows `link`, which the caller reads again. From `start` "agent", the dialog adds the orchestrator
 * of the numbers that are linked. With a number and the orchestrator, it is done.
 */
export function WhatsAppLinkDialog(props: {
  open: boolean;
  start: DialogStart;
  connections: readonly MessagingConnection[];
  agents: readonly { id: string }[];
  busy: boolean;
  models?: WhatsAppOrchestratorModels | undefined;
  link: WhatsAppLinkState;
  onStartLink: (input: StartWhatsAppLinkInput) => void;
  onAddOrchestrator: (choice: WhatsAppOrchestratorChoice | null) => void;
  onClose: () => void;
}) {
  const { t } = useText();
  const [form, setForm] = createStore<{
    ownNumber: boolean;
    method: StartWhatsAppLinkInput["method"];
    phone: string;
    invalid: boolean;
    /** True until the user starts a link, and again after Try again. */
    choosing: boolean;
  }>({ ownNumber: true, method: "qr", phone: "", invalid: false, choosing: true });
  const [choice, setChoice] = createSignal<WhatsAppOrchestratorChoice | null>(null);
  createEffect(
    () => props.open,
    (open) => {
      if (!open) return;
      // A link that runs already shows itself.
      const running = untrack(() => props.link.status) !== "idle";
      setForm((draft) => {
        draft.ownNumber = true;
        draft.method = "qr";
        draft.phone = "";
        draft.invalid = false;
        draft.choosing = !running;
      });
      setChoice(props.models?.initial ?? null);
    },
  );
  const phase = (): LinkPhase => {
    if (form.choosing) return "choose";
    switch (props.link.status) {
      case "waiting":
        return "waiting";
      case "failed":
        return "failed";
      case "linked":
        return "linked";
      case "idle":
        // The start is on its way; a start that failed reported why, and the choice shows again.
        return props.busy ? "starting" : "choose";
    }
  };
  /** The number that the dialog is about: the new one, or the first one for the orchestrator. */
  const current = () => {
    if (props.start === "agent") return props.connections[0] ?? null;
    const workspaceId = props.link.workspaceId;
    return phase() === "linked"
      ? (props.connections.find((connection) => connection.workspaceId === workspaceId) ?? null)
      : null;
  };
  const step = (): LinkStep => {
    if (props.start === "number" && phase() !== "linked") return 0;
    return whatsappOrchestrator(props.connections, props.agents) ? 2 : 1;
  };
  const name = () => {
    const connection = current();
    if (connection) return numberName(connection);
    const workspaceId = props.link.workspaceId;
    return workspaceId ? phoneNumber(workspaceId) : "";
  };
  const dialogLink = (): WizardLink => {
    if (step() === 2) return "connected";
    return phase() === "failed" ? "broken" : "connecting";
  };
  const copy = () => {
    switch (step()) {
      case 0:
        return { title: t("connector.whatsapp.connectTitle"), description: t("connector.whatsapp.connectDescription") };
      case 1:
        return {
          title: t("connector.whatsapp.agentStepTitle"),
          description: t("connector.whatsapp.agentStepDescription", { number: name() }),
        };
      case 2:
        return {
          title: t("connector.whatsapp.doneTitle", { number: name() }),
          description: t("connector.whatsapp.note"),
        };
    }
  };
  const steps = () => [t("connector.whatsapp.stepNumber"), t("connector.whatsapp.stepAgent")];
  const submit = () => {
    const phoneNumber = form.method === "code" ? parseWhatsAppPhoneNumber(form.phone) : null;
    if (form.method === "code" && !phoneNumber) {
      setForm((draft) => {
        draft.invalid = true;
      });
      return;
    }
    setForm((draft) => {
      draft.choosing = false;
    });
    props.onStartLink({ method: form.method, phoneNumber, ownNumber: form.ownNumber });
  };
  return (
    <WizardDialog
      open={props.open}
      closeLabel={t("connector.whatsapp.close")}
      onClose={props.onClose}
      // A click outside must not stop a link that waits for the phone.
      dismissible={phase() !== "waiting"}
      logo={<WhatsAppMark />}
      link={dialogLink()}
      title={copy().title}
      description={copy().description}
      stepper={<Stepper steps={steps()} current={step()} label={t("connector.whatsapp.connect")} />}
      // Only the choice has a field and a submit; Enter elsewhere does nothing.
      onSubmit={() => {
        if (step() === 0 && phase() === "choose") submit();
      }}
      footer={
        <Switch>
          <Match when={step() === 0 && phase() === "choose"}>
            <Button type="submit" size="sm" loading={props.busy}>
              {form.method === "qr" ? t("connector.whatsapp.showQr") : t("connector.whatsapp.getCode")}
            </Button>
          </Match>
          <Match when={step() === 0 && phase() === "failed"}>
            <Button type="button" size="sm" variant="ghost" onClick={props.onClose}>
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() =>
                setForm((draft) => {
                  draft.choosing = true;
                })
              }
            >
              {t("connector.whatsapp.tryAgain")}
            </Button>
          </Match>
          <Match when={step() === 0}>
            <Button type="button" size="sm" variant="ghost" onClick={props.onClose}>
              {t("common.cancel")}
            </Button>
          </Match>
          <Match when={step() === 1}>
            <Button type="button" size="sm" loading={props.busy} onClick={() => props.onAddOrchestrator(choice())}>
              {t("connector.whatsapp.addAgent")}
            </Button>
          </Match>
          <Match when={step() === 2}>
            <Button type="button" size="sm" onClick={props.onClose}>
              {t("connector.whatsapp.done")}
            </Button>
          </Match>
        </Switch>
      }
    >
      <Switch>
        <Match when={step() === 0 && phase() === "choose"}>
          <LinkChoice
            ownNumber={form.ownNumber}
            method={form.method}
            phone={form.phone}
            invalid={form.invalid}
            disabled={props.busy}
            onOwnNumber={(ownNumber) =>
              setForm((draft) => {
                draft.ownNumber = ownNumber;
              })
            }
            onMethod={(method) =>
              setForm((draft) => {
                draft.method = method;
              })
            }
            onPhone={(phone) =>
              setForm((draft) => {
                draft.phone = phone;
                draft.invalid = false;
              })
            }
          />
        </Match>
        <Match when={step() === 0 && phase() === "failed"}>
          <Alert tone="danger" role="alert">
            <AlertIcon>
              <OctagonX />
            </AlertIcon>
            <AlertContent>
              <AlertTitle>{t("connector.whatsapp.failedTitle")}</AlertTitle>
              <AlertDescription>{t(LINK_ERROR[props.link.error ?? "unavailable"])}</AlertDescription>
            </AlertContent>
          </Alert>
        </Match>
        <Match when={step() === 0 && phase() === "waiting" && props.link.qr}>
          {(qr) => (
            <div class="whatsapp-link-qr">
              <QrCode value={qr()} size={196} label={t("connector.whatsapp.qrLabel")} />
              <LinkSteps
                steps={[
                  "connector.whatsapp.connectStepOpen",
                  "connector.whatsapp.connectStepDevices",
                  "connector.whatsapp.connectStepScan",
                ]}
              />
              <LinkWaiting text={t("connector.whatsapp.connectWaiting")} />
            </div>
          )}
        </Match>
        <Match when={step() === 0 && phase() === "waiting" && props.link.code}>
          {(code) => (
            <>
              <div class="whatsapp-pairing-code">
                {/* Read one character at a time: the user types it on the phone from this screen alone. */}
                <output
                  class="whatsapp-pairing-digits"
                  aria-label={t("connector.whatsapp.codeLabel", { code: code().split("").join(" ") })}
                >
                  {groupedCode(code())}
                </output>
                <CopyButton
                  value={code()}
                  label={t("connector.whatsapp.copyCode")}
                  copiedLabel={t("common.copied")}
                  variant="outline"
                />
              </div>
              <LinkSteps
                steps={[
                  "connector.whatsapp.codeStepDevices",
                  "connector.whatsapp.codeStepPhone",
                  "connector.whatsapp.codeStepType",
                ]}
              />
              <LinkWaiting text={t("connector.whatsapp.codeWaiting")} />
            </>
          )}
        </Match>
        <Match when={step() === 0}>
          <LinkWaiting text={t("connector.whatsapp.starting")} />
        </Match>
        <Match when={step() === 1}>
          <ChannelOrchestratorStep
            text={WHATSAPP_TEXT}
            avatar={WHATSAPP_ORCHESTRATOR_AVATAR}
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

/** What the number is, and how the phone links: by a QR code, or by a pairing code for its number. */
function LinkChoice(props: {
  ownNumber: boolean;
  method: StartWhatsAppLinkInput["method"];
  phone: string;
  invalid: boolean;
  disabled: boolean;
  onOwnNumber: (ownNumber: boolean) => void;
  onMethod: (method: StartWhatsAppLinkInput["method"]) => void;
  onPhone: (phone: string) => void;
}) {
  const { t } = useText();
  return (
    <>
      <RadioGroup.Root
        class="whatsapp-choice"
        aria-label={t("connector.whatsapp.kindLabel")}
        value={props.ownNumber ? "own" : "dedicated"}
        disabled={props.disabled}
        onChange={(value) => props.onOwnNumber(value === "own")}
      >
        <ChoiceCard
          value="own"
          label={t("connector.whatsapp.kindPersonal")}
          description={t("connector.whatsapp.kindPersonalDescription")}
        />
        <ChoiceCard
          value="dedicated"
          label={t("connector.whatsapp.kindDedicated")}
          description={t("connector.whatsapp.kindDedicatedDescription")}
        />
      </RadioGroup.Root>
      <RadioGroup.Root
        class="whatsapp-choice"
        data-layout="row"
        aria-label={t("connector.whatsapp.methodLabel")}
        value={props.method}
        disabled={props.disabled}
        onChange={(value) => props.onMethod(value === "code" ? "code" : "qr")}
      >
        <ChoiceCard value="qr" label={t("connector.whatsapp.methodQr")} />
        <ChoiceCard value="code" label={t("connector.whatsapp.methodCode")} />
      </RadioGroup.Root>
      <Show when={props.method === "code"}>
        <Field
          label={t("connector.whatsapp.phoneLabel")}
          description={t("connector.whatsapp.phoneDescription")}
          error={props.invalid ? t("connector.whatsapp.phoneInvalid") : undefined}
          required
        >
          <Input
            type="tel"
            autocomplete="tel"
            value={props.phone}
            disabled={props.disabled}
            onValueChange={props.onPhone}
          />
        </Field>
      </Show>
    </>
  );
}

/** One option of a choice: a card with a radio dot. */
function ChoiceCard(props: { value: string; label: string; description?: string }) {
  return (
    <RadioGroup.Item class="whatsapp-choice-option" value={props.value}>
      <RadioGroup.ItemInput />
      <RadioGroup.ItemControl class="whatsapp-choice-card">
        <span class="whatsapp-choice-dot" aria-hidden="true" />
        <span class="whatsapp-choice-text">
          <RadioGroup.ItemLabel class="whatsapp-choice-name">{props.label}</RadioGroup.ItemLabel>
          <Show when={props.description}>
            {(description) => (
              <RadioGroup.ItemDescription class="whatsapp-choice-hint">{description()}</RadioGroup.ItemDescription>
            )}
          </Show>
        </span>
      </RadioGroup.ItemControl>
    </RadioGroup.Item>
  );
}

/** The steps on the phone. */
function LinkSteps(props: { steps: readonly AppTextKey[] }) {
  const { t } = useText();
  return (
    <ol class="channel-checklist whatsapp-link-steps">
      <For each={props.steps}>
        {(step, index) => (
          <li>
            <span class="whatsapp-link-step-index" aria-hidden="true">
              {index() + 1}
            </span>
            {t(step)}
          </li>
        )}
      </For>
    </ol>
  );
}

function LinkWaiting(props: { text: JSX.Element }) {
  return (
    <div class="channel-waiting" aria-live="polite">
      <Spinner size="sm" />
      <Text variant="caption" tone="muted">
        {props.text}
      </Text>
    </div>
  );
}
