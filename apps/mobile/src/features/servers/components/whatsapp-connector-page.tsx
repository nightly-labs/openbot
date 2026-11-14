import {
  MESSAGING_LIMITS,
  type MessagingConnection,
  type WhatsAppAccount,
  type WhatsAppOverview,
  type WhatsAppPairingRequest,
  type WhatsAppSender,
} from "@openbot/contracts/ipc";
import type { UseQueryResult } from "@tanstack/react-query";
import { router } from "expo-router";
import { Typography } from "heroui-native";
import UserRound from "lucide-react-native/icons/user-round";
import UsersRound from "lucide-react-native/icons/users-round";
import { Fragment } from "react";
import { Alert } from "react-native";
import { useCSSVariable, useUniwind } from "uniwind";
import { BloubAvatarThumbnail } from "@/features/agents/components/bloub-avatar";
import { ConnectorError, ConnectorHeader } from "@/features/servers/components/connector-header";
import {
  CONNECTOR_STATUS_KEYS,
  connectionKind,
  maskedWhatsAppNumber,
  telegramOrchestrator,
  whatsappAttentionCount,
  whatsappNumberName,
  whatsappPhoneNumber,
  whatsappStatus,
} from "@/features/servers/model/connectors";
import { useConnectorAction } from "@/features/servers/model/use-server-connectors";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { SettingsSwitch } from "@/features/settings/components/settings-controls";
import { useMobileWorkspaceActions } from "@/features/workspace/context/mobile-workspace-context";
import type { MobileAgent, MobileServer } from "@/features/workspace/model/workspace-types";
import { type MobileText, useText } from "@/shared/lib/text";

const KIND_KEYS = {
  live: "mobile.server.connectors.statusConnected",
  paused: "mobile.server.connectors.statusPaused",
  setup: "mobile.server.connectors.statusConnecting",
  attention: "mobile.server.connectors.statusAttention",
} as const;

const AVATAR_SIZE = 32;
const ICON_SIZE = 20;

/** What to do about a stopped number, or the note of its kind. */
function numberNote({ t, format }: MobileText, connection: MessagingConnection, account: WhatsAppAccount | undefined) {
  if (connection.retryAt)
    return t("mobile.server.connectors.whatsapp.retryAt", {
      time: format.date(new Date(connection.retryAt), { hour: "numeric", minute: "2-digit" }),
    });
  switch (connection.state) {
    // WhatsApp removed the linked device: only a new link brings the number back.
    case "invalid_token":
      return t("mobile.server.connectors.whatsapp.helpLoggedOut");
    // The saved keys of the number cannot be read: a reconnect has nothing to connect with.
    case "secret_storage_unavailable":
      return t("mobile.server.connectors.whatsapp.helpKeysUnreadable");
    case "error":
      return t("mobile.server.connectors.whatsapp.helpError");
    default:
      return account?.ownNumber === false
        ? t("mobile.server.connectors.whatsapp.dedicatedNote")
        : t("mobile.server.connectors.whatsapp.ownNumberNote");
  }
}

/**
 * Marketplace › Apps › WhatsApp of a joined server (`whatsapp-connector-v1`). Each number
 * links the host as a device from WhatsApp on a phone, and one WhatsApp Orchestrator answers all
 * numbers. Only the allowed contacts and groups reach it. On a number only for OpenBot, an unknown
 * person gets a code that the owner approves here. The host keeps the WhatsApp session and its keys.
 */
export function WhatsAppConnectorPage({
  server,
  query,
  agents,
}: {
  server: MobileServer;
  query: UseQueryResult<WhatsAppOverview>;
  agents: readonly MobileAgent[];
}) {
  const text = useText();
  const { t, errorMessage } = text;
  const { theme } = useUniwind();
  const muted = String(useCSSVariable("--openbot-text-grouped-secondary"));
  const {
    disconnectWhatsAppNumber,
    reconnectWhatsAppNumber,
    setWhatsAppEnabled,
    setWhatsAppOwnNumber,
    setWhatsAppWorkingMessage,
    addWhatsAppOrchestrator,
    removeWhatsAppSender,
    answerWhatsAppRequest,
  } = useMobileWorkspaceActions();
  const action = useConnectorAction(query.refetch);
  const overview = query.data;
  if (!overview)
    return (
      <SettingsContent>
        <SettingsNote>
          {query.isError
            ? errorMessage(query.error, t("mobile.server.connectors.readFailed"))
            : t("mobile.server.connectors.loading")}
        </SettingsNote>
      </SettingsContent>
    );
  const { connections, accounts } = overview;
  const serverId = server.id;
  const status = whatsappStatus(connections, agents);
  const attention = whatsappAttentionCount(connections, agents);
  const orchestrator = telegramOrchestrator(connections, agents);
  const account = (workspaceId: string) => accounts.find((entry) => entry.workspaceId === workspaceId);
  /** The numbers whose settings are known, in the order of the number list. */
  const linked = connections.flatMap((connection) => {
    const settings = account(connection.workspaceId);
    return settings ? [{ connection, account: settings }] : [];
  });
  const rowLabel = (label: string, name: string) => t("mobile.server.connectors.rowAction", { action: label, name });
  const run = (operation: () => Promise<unknown>) =>
    void action.perform(async () => {
      await operation();
    });
  const openLink = () => router.push({ pathname: "/server-settings/whatsapp-link", params: { serverId } });

  const disconnect = (connection: MessagingConnection) => {
    const number = whatsappNumberName(connection);
    // The last linked number: its disconnect deletes the WhatsApp Orchestrator.
    const deletes = connections.length === 1 && orchestrator !== null;
    const body = [
      t("mobile.server.connectors.whatsapp.disconnectBody", { number }),
      t("mobile.server.connectors.whatsapp.disconnectEffect", { number }),
      t(
        deletes
          ? "mobile.server.connectors.whatsapp.removeEffectDeleted"
          : "mobile.server.connectors.whatsapp.removeEffectKept",
      ),
    ].join("\n\n");
    Alert.alert(t("mobile.server.connectors.whatsapp.disconnectTitle", { number }), body, [
      { text: t("mobile.server.connectors.whatsapp.keep"), style: "cancel" },
      {
        text: t("mobile.server.connectors.disconnect"),
        style: "destructive",
        onPress: () => run(() => disconnectWhatsAppNumber({ workspaceId: connection.workspaceId }, serverId)),
      },
    ]);
  };
  const removeSender = (workspaceId: string, sender: WhatsAppSender, name: string) =>
    Alert.alert(name, undefined, [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("mobile.server.connectors.whatsapp.removeSender"),
        style: "destructive",
        onPress: () => run(() => removeWhatsAppSender({ workspaceId, senderId: sender.id }, serverId)),
      },
    ]);
  const answerRequest = (workspaceId: string, request: WhatsAppPairingRequest) => {
    const answer = (approve: boolean) =>
      run(() => answerWhatsAppRequest({ workspaceId, code: request.code, approve }, serverId));
    Alert.alert(
      request.name || maskedWhatsAppNumber(request.senderId),
      t("mobile.server.connectors.whatsapp.requestDetail", {
        code: request.code,
        number: maskedWhatsAppNumber(request.senderId),
      }),
      [
        { text: t("common.cancel"), style: "cancel" },
        { text: t("mobile.server.connectors.whatsapp.deny"), style: "destructive", onPress: () => answer(false) },
        { text: t("mobile.server.connectors.whatsapp.approve"), onPress: () => answer(true) },
      ],
    );
  };
  const failure = action.error
    ? errorMessage(
        action.error,
        t("mobile.server.connectors.actionFailed", { name: t("mobile.server.connectors.whatsapp.title") }),
      )
    : query.isError
      ? errorMessage(query.error, t("mobile.server.connectors.readFailed"))
      : null;

  return (
    <SettingsContent>
      <ConnectorHeader
        id="whatsapp"
        status={
          attention > 0
            ? t("mobile.server.connectors.whatsapp.attention", { count: attention })
            : t(CONNECTOR_STATUS_KEYS[status])
        }
        attention={attention > 0}
        description={t("mobile.server.connectors.whatsapp.description")}
      />
      <ConnectorError message={failure} />
      {connections.map((connection, index) => {
        const kind = connectionKind(connection);
        const name = whatsappNumberName(connection);
        const settings = account(connection.workspaceId);
        return (
          <SettingsSection
            key={connection.workspaceId}
            title={index === 0 ? t("mobile.server.connectors.whatsapp.numbersTitle") : undefined}
          >
            <SettingsRow
              disclosure={false}
              supportingText={numberNote(text, connection, settings)}
              trailing={
                <Typography.Paragraph
                  type="body-xs"
                  className={kind === "attention" ? "text-warning-text" : "text-grouped-secondary"}
                >
                  {t(KIND_KEYS[kind])}
                </Typography.Paragraph>
              }
            >
              <Typography.Paragraph>{name}</Typography.Paragraph>
            </SettingsRow>
            {kind === "live" || kind === "paused" ? (
              <SettingsRow>
                <SettingsSwitch
                  value={connection.enabled}
                  disabled={action.busy}
                  label={t("mobile.server.connectors.answerMessages")}
                  dark={theme === "dark"}
                  onValueChange={(enabled) =>
                    run(() => setWhatsAppEnabled({ workspaceId: connection.workspaceId, enabled }, serverId))
                  }
                />
              </SettingsRow>
            ) : null}
            {settings ? (
              <SettingsRow supportingText={t("mobile.server.connectors.whatsapp.ownNumberDescription")}>
                <SettingsSwitch
                  value={settings.ownNumber}
                  disabled={action.busy}
                  label={t("mobile.server.connectors.whatsapp.ownNumber")}
                  dark={theme === "dark"}
                  onValueChange={(ownNumber) =>
                    run(() => setWhatsAppOwnNumber({ workspaceId: connection.workspaceId, ownNumber }, serverId))
                  }
                />
              </SettingsRow>
            ) : null}
            {/* An older host cannot set it: its numbers carry no `workingMessage`. */}
            {settings && settings.workingMessage !== undefined ? (
              <SettingsRow supportingText={t("mobile.server.connectors.whatsapp.workingMessageDescription")}>
                <SettingsSwitch
                  value={settings.workingMessage}
                  disabled={action.busy}
                  label={t("mobile.server.connectors.whatsapp.workingMessage")}
                  dark={theme === "dark"}
                  onValueChange={(workingMessage) =>
                    run(() =>
                      setWhatsAppWorkingMessage({ workspaceId: connection.workspaceId, workingMessage }, serverId),
                    )
                  }
                />
              </SettingsRow>
            ) : null}
            {/* The device was removed, or its keys cannot be read: only a new link brings the number back. */}
            {connection.state === "invalid_token" || connection.state === "secret_storage_unavailable" ? (
              <SettingsRow
                disclosure={false}
                disabled={action.busy}
                accessibilityLabel={rowLabel(t("mobile.server.connectors.whatsapp.linkAgain"), name)}
                onPress={openLink}
              >
                <Typography.Paragraph className="text-accent">
                  {t("mobile.server.connectors.whatsapp.linkAgain")}
                </Typography.Paragraph>
              </SettingsRow>
            ) : kind === "attention" ? (
              <SettingsRow
                disclosure={false}
                disabled={action.busy}
                accessibilityLabel={rowLabel(t("mobile.server.connectors.reconnect"), name)}
                onPress={() => run(() => reconnectWhatsAppNumber({ workspaceId: connection.workspaceId }, serverId))}
              >
                <Typography.Paragraph className="text-accent">
                  {t("mobile.server.connectors.reconnect")}
                </Typography.Paragraph>
              </SettingsRow>
            ) : null}
            <SettingsRow
              disclosure={false}
              disabled={action.busy}
              accessibilityLabel={rowLabel(t("mobile.server.connectors.disconnect"), name)}
              onPress={() => disconnect(connection)}
            >
              <Typography.Paragraph className="text-danger-text">
                {t("mobile.server.connectors.disconnect")}
              </Typography.Paragraph>
            </SettingsRow>
          </SettingsSection>
        );
      })}
      <SettingsSection footer={connections.length > 0 ? t("mobile.server.connectors.whatsapp.note") : undefined}>
        <SettingsRow disclosure={false} disabled={action.busy} onPress={openLink}>
          <Typography.Paragraph className="text-accent">
            {t(
              connections.length === 0
                ? "mobile.server.connectors.whatsapp.linkTitle"
                : "mobile.server.connectors.whatsapp.linkNumber",
            )}
          </Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
      {connections.length > 0 ? (
        <SettingsSection
          title={t("mobile.server.connectors.whatsapp.orchestratorTitle")}
          footer={t("mobile.server.connectors.whatsapp.orchestratorDescription")}
        >
          {orchestrator ? (
            <SettingsRow
              disclosure={false}
              supportingText={orchestrator.title || undefined}
              leading={
                <BloubAvatarThumbnail
                  agentId={orchestrator.id}
                  serverId={orchestrator.serverId}
                  hue={orchestrator.avatarHue}
                  color={orchestrator.avatarColor}
                  seed={orchestrator.avatarSeed}
                  size={AVATAR_SIZE}
                />
              }
            >
              <Typography.Paragraph>{orchestrator.name}</Typography.Paragraph>
            </SettingsRow>
          ) : (
            <SettingsRow disclosure={false} supportingText={t("mobile.server.connectors.whatsapp.orchestratorNone")}>
              <Typography.Paragraph>{t("mobile.server.connectors.noAgent")}</Typography.Paragraph>
            </SettingsRow>
          )}
          {orchestrator ? null : (
            <SettingsRow
              disclosure={false}
              disabled={action.busy}
              // The host starts it on its default provider and model, as the Telegram page does.
              onPress={() => run(() => addWhatsAppOrchestrator(serverId))}
            >
              <Typography.Paragraph className="text-accent">
                {t("mobile.server.connectors.whatsapp.addAgent")}
              </Typography.Paragraph>
            </SettingsRow>
          )}
        </SettingsSection>
      ) : null}
      {linked.map(({ connection, account: settings }) => {
        const workspaceId = connection.workspaceId;
        const number = whatsappNumberName(connection);
        const senders = settings.allowedSenders;
        const atCap = senders.length >= MESSAGING_LIMITS.allowedSenders;
        const addSender = (pathname: "/server-settings/whatsapp-contact" | "/server-settings/whatsapp-group") =>
          router.push({ pathname, params: { serverId, workspaceId } });
        return (
          <Fragment key={workspaceId}>
            <SettingsSection
              title={t("mobile.server.connectors.whatsapp.sendersTitle", { number })}
              footer={
                atCap
                  ? t("mobile.server.connectors.whatsapp.sendersLimit", { count: MESSAGING_LIMITS.allowedSenders })
                  : t("mobile.server.connectors.whatsapp.sendersDescription")
              }
            >
              {senders.map((sender) => {
                const name = sender.name || whatsappPhoneNumber(sender.id);
                const Icon = sender.kind === "group" ? UsersRound : UserRound;
                return (
                  <SettingsRow
                    key={sender.id}
                    disclosure={false}
                    disabled={action.busy}
                    accessibilityLabel={rowLabel(t("mobile.server.connectors.whatsapp.removeSender"), name)}
                    leading={<Icon size={ICON_SIZE} color={muted} strokeWidth={1.75} />}
                    supportingText={
                      sender.kind === "group"
                        ? t("mobile.server.connectors.whatsapp.senderGroup")
                        : whatsappPhoneNumber(sender.id)
                    }
                    trailing={
                      <Typography.Paragraph type="body-xs" className="text-danger-text">
                        {t("mobile.server.connectors.whatsapp.removeSender")}
                      </Typography.Paragraph>
                    }
                    onPress={() => removeSender(workspaceId, sender, name)}
                  >
                    <Typography.Paragraph>{name}</Typography.Paragraph>
                  </SettingsRow>
                );
              })}
              {senders.length === 0 ? (
                <SettingsRow disclosure={false}>
                  <Typography.Paragraph className="text-grouped-secondary">
                    {t("mobile.server.connectors.whatsapp.sendersEmpty")}
                  </Typography.Paragraph>
                </SettingsRow>
              ) : null}
              <SettingsRow
                disclosure={false}
                disabled={action.busy || atCap}
                onPress={() => addSender("/server-settings/whatsapp-contact")}
              >
                <Typography.Paragraph className="text-accent">
                  {t("mobile.server.connectors.whatsapp.addContact")}
                </Typography.Paragraph>
              </SettingsRow>
              <SettingsRow
                disclosure={false}
                disabled={action.busy || atCap}
                onPress={() => addSender("/server-settings/whatsapp-group")}
              >
                <Typography.Paragraph className="text-accent">
                  {t("mobile.server.connectors.whatsapp.addGroup")}
                </Typography.Paragraph>
              </SettingsRow>
            </SettingsSection>
            {/* A personal number answers no stranger, so it shows requests only when some still wait. */}
            {!settings.ownNumber || settings.pendingRequests.length > 0 ? (
              <SettingsSection
                title={t("mobile.server.connectors.whatsapp.requestsTitle", { number })}
                footer={t("mobile.server.connectors.whatsapp.requestsDescription")}
              >
                {settings.pendingRequests.map((request) => (
                  <SettingsRow
                    key={request.code}
                    disclosure={false}
                    disabled={action.busy}
                    leading={<UserRound size={ICON_SIZE} color={muted} strokeWidth={1.75} />}
                    supportingText={t("mobile.server.connectors.whatsapp.requestDetail", {
                      code: request.code,
                      number: maskedWhatsAppNumber(request.senderId),
                    })}
                    onPress={() => answerRequest(workspaceId, request)}
                  >
                    <Typography.Paragraph>
                      {request.name || maskedWhatsAppNumber(request.senderId)}
                    </Typography.Paragraph>
                  </SettingsRow>
                ))}
                {settings.pendingRequests.length === 0 ? (
                  <SettingsRow disclosure={false}>
                    <Typography.Paragraph className="text-grouped-secondary">
                      {t("mobile.server.connectors.whatsapp.requestsEmpty")}
                    </Typography.Paragraph>
                  </SettingsRow>
                ) : null}
              </SettingsSection>
            ) : null}
          </Fragment>
        );
      })}
    </SettingsContent>
  );
}
