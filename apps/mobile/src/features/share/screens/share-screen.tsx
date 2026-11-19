import { attachmentMimeTypeForName } from "@openbot/contracts/attachment-files";
import { router, Stack, useNavigation } from "expo-router";
import { StackActions } from "expo-router/react-navigation";
import { Typography } from "heroui-native";
import Check from "lucide-react-native/icons/check";
import X from "lucide-react-native/icons/x";
import { useEffect, useRef, useState } from "react";
import { useCSSVariable } from "uniwind";
import { BloubAvatar } from "@/features/agents/components/bloub-avatar";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { AttachmentThumbnail } from "@/features/chat/components/attachment-preview";
import { requestComposerFocus, requestComposerText } from "@/features/chat/model/composer-requests";
import { SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { type MobileAgent, useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { serverStatusLabel, showsOnline } from "@/features/workspace/model/server-status";
import { AndroidHeaderButton } from "@/shared/components/android-header-button";
import { SheetSaveAction } from "@/shared/components/sheet-save-action";
import { SheetScrollView } from "@/shared/components/sheet-scroll-view";
import { isAndroid, isIOS } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";
import { discardIncomingShare, type IncomingShare, takeIncomingShare } from "../model/incoming-share";
import { loadLastShareTarget, type ShareTarget, saveLastShareTarget } from "../model/last-share-target";

const CHAT_ROUTE = "chat/[agentId]";

export function ShareScreen() {
  const { t, format } = useText();
  const { session } = useMobileSession();
  const { agents, servers } = useMobileWorkspace();
  const sheetStack = useNavigation().getParent();
  const [share, setShare] = useState<IncomingShare | null | undefined>(undefined);
  const [lastTarget, setLastTarget] = useState<ShareTarget | null>(null);
  const [chosen, setChosen] = useState<ShareTarget | null>(null);
  const received = useRef<IncomingShare | null>(null);
  const sentTo = useRef<ShareTarget | null>(null);

  useEffect(() => {
    let mounted = true;
    takeIncomingShare().then(
      (next) => {
        if (!mounted) {
          discardIncomingShare(next);
          return;
        }
        received.current = next;
        setShare(next.text || next.files.length > 0 ? next : null);
      },
      () => {
        if (mounted) setShare(null);
      },
    );
    return () => {
      mounted = false;
      if (sentTo.current) requestComposerFocus(sentTo.current);
      else if (received.current) discardIncomingShare(received.current);
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
  const selected = chosen ? agentFor(chosen) : lastAgent;
  const selectedKey = chosen ?? lastTarget;

  function close(): void {
    if (router.canGoBack()) router.back();
    else router.replace("/connected");
  }

  function send(): void {
    if (!sheetStack || !share || !selected || sentTo.current) return;
    const target = { serverId: selected.serverId, agentId: selected.id };
    requestComposerText({ ...target, text: share.text, files: share.files });
    sentTo.current = target;
    if (apiUrl && userId) void saveLastShareTarget(apiUrl, userId, target);
    sheetStack.dispatch(StackActions.replace(CHAT_ROUTE, { agentId: selected.id }));
  }

  function select(agent: MobileAgent): void {
    setChosen({ serverId: agent.serverId, agentId: agent.id });
  }

  const isSelected = (agent: MobileAgent) =>
    selectedKey?.serverId === agent.serverId && selectedKey.agentId === agent.id;

  return (
    <SheetScrollView
      className="bg-sheet"
      contentContainerClassName="gap-6 px-4 pb-safe-offset-5 pt-5"
      contentInsetAdjustmentBehavior="automatic"
    >
      {isAndroid ? (
        <AndroidHeaderButton placement="left" icon={X} accessibilityLabel={t("common.close")} onPress={close} />
      ) : (
        <Stack.Toolbar placement="left">
          <Stack.Toolbar.Button
            icon={isIOS ? "xmark" : undefined}
            accessibilityLabel={t("common.close")}
            onPress={close}
          >
            {isIOS ? t("common.close") : "×"}
          </Stack.Toolbar.Button>
        </Stack.Toolbar>
      )}
      <SheetSaveAction
        dirty={Boolean(share)}
        canSave={selected !== null}
        pending={false}
        label={selected ? t("mobile.share.action", { name: selected.name }) : t("mobile.share.chooseAgent")}
        onSave={send}
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
          <SettingsSection title={t("mobile.share.content")} footer={t("mobile.share.footer")}>
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
          {lastAgent ? (
            <SettingsSection title={t("mobile.share.lastUsed")}>
              <AgentChoice agent={lastAgent} checked={isSelected(lastAgent)} onSelect={select} />
            </SettingsSection>
          ) : null}
          {servers.map((server) => {
            const serverAgents = agents.filter((agent) => agent.serverId === server.id && agent !== lastAgent);
            return (
              <SettingsSection
                key={server.id}
                title={server.name}
                footer={showsOnline(server) ? undefined : serverStatusLabel(server, t)}
              >
                {serverAgents.length > 0 ? (
                  serverAgents.map((agent) => (
                    <AgentChoice key={agent.id} agent={agent} checked={isSelected(agent)} onSelect={select} />
                  ))
                ) : (
                  <SettingsRow disclosure={false}>
                    <Typography.Paragraph className="text-grouped-secondary">
                      {server.initialConnectionPending ? serverStatusLabel(server, t) : t("mobile.share.noAgents")}
                    </Typography.Paragraph>
                  </SettingsRow>
                )}
              </SettingsSection>
            );
          })}
        </>
      )}
    </SheetScrollView>
  );
}

function AgentChoice({
  agent,
  checked,
  onSelect,
}: {
  agent: MobileAgent;
  checked: boolean;
  onSelect: (agent: MobileAgent) => void;
}) {
  const accent = String(useCSSVariable("--openbot-accent"));
  return (
    <SettingsRow
      checked={checked}
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
