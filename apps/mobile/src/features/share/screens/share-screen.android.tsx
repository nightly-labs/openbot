import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { useNavigation } from "expo-router";
import { StackActions } from "expo-router/react-navigation";
import { Typography } from "heroui-native";
import ChevronDown from "lucide-react-native/icons/chevron-down";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import { useCallback, useEffect, useRef, useState } from "react";
import { Keyboard, View } from "react-native";
import { useCSSVariable } from "uniwind";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { LARGE_TEXT_LENGTH, useChatAttachments } from "@/features/chat/components/use-chat-attachments";
import { useOutbox } from "@/features/chat/context/outbox-context";
import { SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import {
  type MobileAgent,
  type MobileServer,
  useMobileWorkspace,
} from "@/features/workspace/context/mobile-workspace-context";
import { serverStatusLabel, showsOnline } from "@/features/workspace/model/server-status";
import { SheetCloseAction } from "@/shared/components/sheet-close-action";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { SheetSaveAction } from "@/shared/components/sheet-save-action";
import { SheetScrollView } from "@/shared/components/sheet-scroll-view";
import { backOrConnected } from "@/shared/lib/back-or-connected";
import { useText } from "@/shared/lib/text";
import { MIRROR_IN_RTL } from "@/shared/lib/text-direction";
import { AgentChoice, ShareContentSection } from "../components/share-sheet-parts";
import { discardIncomingShare, type IncomingShare, takeIncomingShare } from "../model/incoming-share";
import { type ShareTarget, saveLastShareTarget, useLastShareTarget } from "../model/last-share-target";
import { endShareSheetRequest, openShareSheet, setOpenShareSheet } from "../model/share-sheet-opener";

const CHAT_ROUTE = "chat/[agentId]";

export function ShareScreen() {
  const { t } = useText();
  const { session } = useMobileSession();
  const { agents, servers, attachmentSupport } = useMobileWorkspace();
  const { store: outbox } = useOutbox();
  const sheetStack = useNavigation().getParent();
  const [share, setShare] = useState<IncomingShare | null | undefined>(undefined);
  const [chosen, setChosen] = useState<ShareTarget | null>(null);
  const [message, setMessage] = useState("");
  const [folds, setFolds] = useState<Readonly<Record<string, boolean>>>({});
  const [sending, setSending] = useState(false);
  const received = useRef<IncomingShare | null>(null);
  const sendingRef = useRef(false);
  const mounted = useRef(true);
  const reading = useRef(false);
  const nextShareWaits = useRef(false);
  const supportServer = useRef("");
  const attachments = useChatAttachments([], undefined, () => attachmentSupport(supportServer.current));

  const takeShare = useCallback(() => {
    setShare(undefined);
    takeIncomingShare().then(
      (next) => {
        endShareSheetRequest();
        if (!mounted.current) {
          discardIncomingShare(next);
          return;
        }
        if (received.current) discardIncomingShare(received.current);
        received.current = next;
        setShare(next.text || next.files.length > 0 ? next : null);
      },
      () => {
        endShareSheetRequest();
        if (mounted.current) setShare(null);
      },
    );
  }, []);

  useEffect(() => {
    mounted.current = true;
    takeShare();
    const stopTaking = setOpenShareSheet(() => {
      if (sendingRef.current) {
        nextShareWaits.current = true;
        endShareSheetRequest();
      } else takeShare();
    });
    return () => {
      mounted.current = false;
      stopTaking();
      if (reading.current) return;
      if (received.current) discardIncomingShare(received.current);
      if (nextShareWaits.current) openShareSheet();
    };
  }, [takeShare]);

  const apiUrl = session?.apiUrl;
  const userId = session?.user.id;
  const lastTarget = useLastShareTarget(apiUrl, userId);

  const agentFor = (target: ShareTarget | null) =>
    target ? (agents.find((agent) => agent.serverId === target.serverId && agent.id === target.agentId) ?? null) : null;
  const lastAgent = agentFor(lastTarget);
  const selected = chosen ? agentFor(chosen) : lastAgent;
  const selectedKey = chosen ?? lastTarget;
  const inlineTextLength = share?.text && share.text.length <= LARGE_TEXT_LENGTH ? share.text.length + 2 : 0;

  async function send(): Promise<void> {
    if (!sheetStack || !share || !selected || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    Keyboard.dismiss();
    const target = { serverId: selected.serverId, agentId: selected.id };
    supportServer.current = target.serverId;
    attachments.clear();
    let sharedText = "";
    reading.current = true;
    const { items, refused } = await attachments.addShared(share.text, share.files, (text) => {
      sharedText = text;
    });
    reading.current = false;
    attachments.clear();
    if (!mounted.current) {
      discardIncomingShare(share);
      if (nextShareWaits.current) openShareSheet();
      return;
    }
    if (refused) {
      sendingRef.current = false;
      setSending(false);
      if (nextShareWaits.current) {
        nextShareWaits.current = false;
        takeShare();
      }
      return;
    }
    const text = [message.trim(), sharedText.trim()].filter(Boolean).join("\n\n");
    outbox.add({ kind: "agent", ...target }, { text, replyToMessageId: null, files: items });
    discardIncomingShare(share);
    if (apiUrl && userId) void saveLastShareTarget(apiUrl, userId, target);
    sheetStack.dispatch(StackActions.replace(CHAT_ROUTE, { agentId: target.agentId }));
  }

  function select(agent: MobileAgent): void {
    setChosen({ serverId: agent.serverId, agentId: agent.id });
  }

  const isSelected = (agent: MobileAgent) =>
    selectedKey?.serverId === agent.serverId && selectedKey.agentId === agent.id;

  const isOpen = (server: MobileServer, index: number) =>
    servers.length === 1 || (folds[server.id] ?? (index === 0 || server.id === selectedKey?.serverId));

  function toggle(server: MobileServer, open: boolean): void {
    setFolds((current) => ({ ...current, [server.id]: !open }));
  }

  return (
    <SheetScrollView
      className="bg-sheet"
      contentContainerClassName="gap-6 px-4 pb-safe-offset-5 pt-5"
      contentInsetAdjustmentBehavior="automatic"
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
    >
      <SheetCloseAction disabled={sending} onPress={backOrConnected} />
      <SheetSaveAction
        dirty={Boolean(share)}
        canSave={selected !== null}
        pending={sending}
        label={selected ? t("mobile.share.extension.send") : t("mobile.share.chooseAgent")}
        pendingLabel={selected ? t("mobile.share.extension.sending", { name: selected.name }) : undefined}
        onSave={() => void send()}
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
          <ShareContentSection share={share} />
          <SheetFormField
            label={t("mobile.share.extension.message")}
            hideLabel
            placeholder={t("mobile.share.extension.message")}
            value={message}
            onChangeText={setMessage}
            editable={!sending}
            multiline
            maxLength={INPUT_LIMITS.messageText - inlineTextLength}
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
  onToggle: (server: MobileServer, open: boolean) => void;
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
      onPress={() => onToggle(server, open)}
    >
      <Typography.Paragraph numberOfLines={1} className="font-semibold">
        {server.name}
      </Typography.Paragraph>
    </SettingsRow>
  );
}
