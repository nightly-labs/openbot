import { attachmentMimeTypeForName } from "@openbot/contracts/attachment-files";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { router, useNavigation } from "expo-router";
import { StackActions } from "expo-router/react-navigation";
import { Typography } from "heroui-native";
import Check from "lucide-react-native/icons/check";
import ChevronDown from "lucide-react-native/icons/chevron-down";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import SendHorizontal from "lucide-react-native/icons/send-horizontal";
import X from "lucide-react-native/icons/x";
import { useEffect, useRef, useState } from "react";
import { Keyboard, View } from "react-native";
import { useCSSVariable } from "uniwind";
import { BloubAvatar } from "@/features/agents/components/bloub-avatar";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { AttachmentThumbnail } from "@/features/chat/components/attachment-preview";
import { useChatAttachments } from "@/features/chat/components/use-chat-attachments";
import { useOutbox } from "@/features/chat/context/outbox-context";
import { SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import {
  type MobileAgent,
  type MobileServer,
  useMobileWorkspace,
} from "@/features/workspace/context/mobile-workspace-context";
import { serverStatusLabel, showsOnline } from "@/features/workspace/model/server-status";
import { AndroidHeaderButton } from "@/shared/components/android-header-button";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { SheetScrollView } from "@/shared/components/sheet-scroll-view";
import { useText } from "@/shared/lib/text";
import { MIRROR_IN_RTL } from "@/shared/lib/text-direction";
import { discardIncomingShare, type IncomingShare, takeIncomingShare } from "../model/incoming-share";
import { loadLastShareTarget, type ShareTarget, saveLastShareTarget } from "../model/last-share-target";
import { endShareSheetRequest } from "../model/share-sheet-opener";

/** The route name of an agent chat in the app stack, `app/(app)/chat/[agentId].tsx`. */
const CHAT_ROUTE = "chat/[agentId]";

/**
 * Where a share from another app goes on Android. The user picks a server and an agent, can add a
 * message, and sends. The agent of the last share is selected first. The message goes to the outbox,
 * which sends it as the chat does, and the chat then opens in place of the sheet.
 *
 * iOS uses `share-screen.tsx`: its share extension sends without the app.
 */
export function ShareScreen() {
  const { t, format } = useText();
  const { session } = useMobileSession();
  const { agents, servers, attachmentSupport } = useMobileWorkspace();
  const { store: outbox } = useOutbox();
  // The stack that presents this sheet. The sheet has its own stack inside, so `router.dismissTo`
  // does not see the chat list under it.
  const sheetStack = useNavigation().getParent();
  // `undefined` while the share is read, `null` when it cannot be read or holds nothing.
  const [share, setShare] = useState<IncomingShare | null | undefined>(undefined);
  const [lastTarget, setLastTarget] = useState<ShareTarget | null>(null);
  const [chosen, setChosen] = useState<ShareTarget | null>(null);
  const [message, setMessage] = useState("");
  // The servers whose open state the user changed. See `isOpen`.
  const [toggled, setToggled] = useState<ReadonlySet<string>>(new Set());
  const [sending, setSending] = useState(false);
  const received = useRef<IncomingShare | null>(null);
  const sendingRef = useRef(false);
  // The host of the selected agent decides which files it takes. The read of the files asks it.
  const supportServer = useRef("");
  const attachments = useChatAttachments([], undefined, () => attachmentSupport(supportServer.current));

  useEffect(() => {
    let mounted = true;
    takeIncomingShare().then(
      (next) => {
        endShareSheetRequest();
        if (!mounted) {
          discardIncomingShare(next);
          return;
        }
        received.current = next;
        setShare(next.text || next.files.length > 0 ? next : null);
      },
      () => {
        endShareSheetRequest();
        if (mounted) setShare(null);
      },
    );
    return () => {
      mounted = false;
      // A sent message keeps its files in the outbox, so the copies of the share can go in all cases.
      if (received.current) discardIncomingShare(received.current);
    };
  }, []);

  const apiUrl = session?.apiUrl;
  const userId = session?.user.id;
  useEffect(() => {
    if (!apiUrl || !userId) return;
    let mounted = true;
    void loadLastShareTarget(apiUrl, userId).then((target) => {
      if (mounted) setLastTarget(target);
    });
    return () => {
      mounted = false;
    };
  }, [apiUrl, userId]);

  const agentFor = (target: ShareTarget | null) =>
    target ? (agents.find((agent) => agent.serverId === target.serverId && agent.id === target.agentId) ?? null) : null;
  const lastAgent = agentFor(lastTarget);
  // The last agent applies only until the user selects one. An agent that goes away stays selected
  // and disables Send, so the share never goes to an agent the user did not select.
  const selected = chosen ? agentFor(chosen) : lastAgent;
  const selectedKey = chosen ?? lastTarget;
  const canSend = Boolean(share) && selected !== null && !sending;

  function close(): void {
    if (router.canGoBack()) router.back();
    else router.replace("/connected");
  }

  async function send(): Promise<void> {
    if (!sheetStack || !share || !selected || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    // The message field has the keyboard. The chat that opens does not focus its composer, so the
    // keyboard goes now, as after a send in the chat.
    Keyboard.dismiss();
    const target = { serverId: selected.serverId, agentId: selected.id };
    supportServer.current = target.serverId;
    // The same reads and checks as a share into the composer: long text becomes a file, and one
    // alert names each file that the host does not take or that is too large.
    attachments.clear();
    let sharedText = "";
    const { items, refused } = await attachments.addShared(share.text, share.files, (text) => {
      sharedText = text;
    });
    attachments.clear();
    if (refused) {
      sendingRef.current = false;
      setSending(false);
      return;
    }
    // The user's words go before the shared content, in the same message, as on iOS.
    const text = [message.trim(), sharedText.trim()].filter(Boolean).join("\n\n");
    // The outbox keeps the message on this phone and sends it while the server is online.
    outbox.add({ kind: "agent", ...target }, { text, replyToMessageId: null, files: items });
    if (apiUrl && userId) void saveLastShareTarget(apiUrl, userId, target);
    // The chat takes the place of the sheet, over the chat list, and shows the message as it goes.
    sheetStack.dispatch(StackActions.replace(CHAT_ROUTE, { agentId: target.agentId }));
  }

  function select(agent: MobileAgent): void {
    setChosen({ serverId: agent.serverId, agentId: agent.id });
  }

  const isSelected = (agent: MobileAgent) =>
    selectedKey?.serverId === agent.serverId && selectedKey.agentId === agent.id;

  // The first server and the server of the selected agent start open, so a long list of one server
  // does not hide the others. One server needs no fold.
  const isOpen = (server: MobileServer, index: number) =>
    servers.length === 1 ||
    (index === 0 || server.id === selectedKey?.serverId ? !toggled.has(server.id) : toggled.has(server.id));

  function toggle(serverId: string): void {
    setToggled((current) => {
      const next = new Set(current);
      if (!next.delete(serverId)) next.add(serverId);
      return next;
    });
  }

  return (
    <SheetScrollView
      className="bg-sheet"
      contentContainerClassName="gap-6 px-4 pb-safe-offset-5 pt-5"
      contentInsetAdjustmentBehavior="automatic"
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
    >
      <AndroidHeaderButton placement="left" icon={X} accessibilityLabel={t("common.close")} onPress={close} />
      <AndroidHeaderButton
        placement="right"
        icon={SendHorizontal}
        hidden={!share}
        disabled={!canSend}
        accessibilityLabel={selected ? t("mobile.share.extension.send") : t("mobile.share.chooseAgent")}
        onPress={() => void send()}
      />
      {share === undefined ? (
        <Typography.Paragraph align="center" className="pt-6 text-grouped-secondary">
          {t("mobile.share.reading")}
        </Typography.Paragraph>
      ) : share === null ? (
        <Typography.Paragraph align="center" className="pt-6">
          {t("mobile.share.readFailed")}
        </Typography.Paragraph>
      ) : (
        <>
          <SettingsSection title={t("mobile.share.content")}>
            {share.text ? (
              <SettingsRow disclosure={false}>
                <Typography.Paragraph numberOfLines={4}>{share.text}</Typography.Paragraph>
              </SettingsRow>
            ) : null}
            {share.files.map((file) => (
              <SettingsRow
                key={file.uri}
                disclosure={false}
                leading={
                  <AttachmentThumbnail
                    name={file.name}
                    uri={attachmentMimeTypeForName(file.name).startsWith("image/") ? file.uri : null}
                  />
                }
                supportingText={file.size === null ? undefined : format.fileSize(file.size)}
              >
                <Typography.Paragraph numberOfLines={1}>{file.name}</Typography.Paragraph>
              </SettingsRow>
            ))}
          </SettingsSection>
          <SheetFormField
            label={t("mobile.share.extension.message")}
            hideLabel
            placeholder={t("mobile.share.extension.message")}
            value={message}
            onChangeText={setMessage}
            editable={!sending}
            multiline
            maxLength={INPUT_LIMITS.messageText}
            hint={
              sending && selected
                ? t("mobile.share.extension.sending", { name: selected.name })
                : t("mobile.share.sendFooter")
            }
          />
          {lastAgent ? (
            <SettingsSection title={t("mobile.share.lastUsed")}>
              <AgentChoice agent={lastAgent} checked={isSelected(lastAgent)} disabled={sending} onSelect={select} />
            </SettingsSection>
          ) : null}
          {servers.map((server, index) => {
            const serverAgents = agents.filter((agent) => agent.serverId === server.id && agent !== lastAgent);
            const open = isOpen(server, index);
            const status = showsOnline(server) ? undefined : serverStatusLabel(server, t);
            return (
              <SettingsSection
                key={server.id}
                title={servers.length === 1 ? server.name : undefined}
                footer={open ? status : undefined}
              >
                {servers.length > 1 ? (
                  <ServerHeader server={server} count={serverAgents.length} open={open} onToggle={toggle} />
                ) : null}
                {open && serverAgents.length > 0
                  ? serverAgents.map((agent) => (
                      <AgentChoice
                        key={agent.id}
                        agent={agent}
                        checked={isSelected(agent)}
                        disabled={sending}
                        onSelect={select}
                      />
                    ))
                  : null}
                {open && serverAgents.length === 0 ? (
                  <SettingsRow disclosure={false}>
                    <Typography.Paragraph className="text-grouped-secondary">
                      {server.initialConnectionPending ? serverStatusLabel(server, t) : t("mobile.share.noAgents")}
                    </Typography.Paragraph>
                  </SettingsRow>
                ) : null}
              </SettingsSection>
            );
          })}
        </>
      )}
    </SheetScrollView>
  );
}

function ServerHeader({
  server,
  count,
  open,
  onToggle,
}: {
  server: MobileServer;
  count: number;
  open: boolean;
  onToggle: (serverId: string) => void;
}) {
  const { format } = useText();
  const muted = String(useCSSVariable("--openbot-text-grouped-secondary"));
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <SettingsRow
      disclosure={false}
      expanded={open}
      accessibilityLabel={server.name}
      trailing={
        <View className="flex-row items-center gap-2">
          <Typography.Paragraph className="text-grouped-secondary">{format.number(count)}</Typography.Paragraph>
          <Chevron size={18} color={muted} strokeWidth={1.5} style={open ? undefined : MIRROR_IN_RTL} />
        </View>
      }
      onPress={() => onToggle(server.id)}
    >
      <Typography.Paragraph numberOfLines={1} className="font-semibold">
        {server.name}
      </Typography.Paragraph>
    </SettingsRow>
  );
}

function AgentChoice({
  agent,
  checked,
  disabled,
  onSelect,
}: {
  agent: MobileAgent;
  checked: boolean;
  disabled: boolean;
  onSelect: (agent: MobileAgent) => void;
}) {
  const accent = String(useCSSVariable("--openbot-accent"));
  return (
    <SettingsRow
      checked={checked}
      disabled={disabled}
      disclosure={false}
      accessibilityLabel={agent.name}
      leading={
        <BloubAvatar
          agentId={agent.id}
          serverId={agent.serverId}
          hue={agent.avatarHue}
          color={agent.avatarColor}
          seed={agent.avatarSeed}
          size={36}
          animateIdle={false}
        />
      }
      trailing={checked ? <Check size={18} color={accent} strokeWidth={2} /> : null}
      onPress={() => onSelect(agent)}
    >
      <Typography.Paragraph numberOfLines={1}>{agent.name}</Typography.Paragraph>
    </SettingsRow>
  );
}
