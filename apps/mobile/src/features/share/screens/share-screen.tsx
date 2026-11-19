import { useNavigation } from "expo-router";
import { StackActions } from "expo-router/react-navigation";
import { Typography } from "heroui-native";
import { useEffect, useRef, useState } from "react";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { requestComposerFocus, requestComposerText } from "@/features/chat/model/composer-requests";
import { SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { type MobileAgent, useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { serverStatusLabel, showsOnline } from "@/features/workspace/model/server-status";
import { SheetCloseAction } from "@/shared/components/sheet-close-action";
import { SheetSaveAction } from "@/shared/components/sheet-save-action";
import { SheetScrollView } from "@/shared/components/sheet-scroll-view";
import { backOrConnected } from "@/shared/lib/back-or-connected";
import { useText } from "@/shared/lib/text";
import { AgentChoice, ShareContentSection } from "../components/share-sheet-parts";
import { discardIncomingShare, type IncomingShare, takeIncomingShare } from "../model/incoming-share";
import { type ShareTarget, saveLastShareTarget, useLastShareTarget } from "../model/last-share-target";

/** The route name of an agent chat in the app stack, `app/(app)/chat/[agentId].tsx`. */
const CHAT_ROUTE = "chat/[agentId]";

/**
 * Where a share from another app goes. The user picks an agent; the agent of the last share is
 * selected first. The chat then opens with the share in its composer, and the user sends it there.
 */
export function ShareScreen() {
  const { t } = useText();
  const { session } = useMobileSession();
  const { agents, servers } = useMobileWorkspace();
  // The stack that presents this sheet. The sheet has its own stack inside, so `router.dismissTo`
  // does not see the chat list under it.
  const sheetStack = useNavigation().getParent();
  // `undefined` while the share is read, `null` when it cannot be read or holds nothing.
  const [share, setShare] = useState<IncomingShare | null | undefined>(undefined);
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
      // The native stack keeps a closing sheet mounted until its animation ends, so the chat can
      // keep the keyboard. A share that no chat got leaves no copies.
      if (sentTo.current) requestComposerFocus(sentTo.current);
      else if (received.current) discardIncomingShare(received.current);
    };
  }, []);

  const apiUrl = session?.apiUrl;
  const userId = session?.user.id;
  const lastTarget = useLastShareTarget(apiUrl, userId);

  const agentFor = (target: ShareTarget | null) =>
    target ? (agents.find((agent) => agent.serverId === target.serverId && agent.id === target.agentId) ?? null) : null;
  const lastAgent = agentFor(lastTarget);
  // The last agent applies only until the user selects one. An agent that goes away stays selected
  // and disables Share, so the share never goes to an agent the user did not select.
  const selected = chosen ? agentFor(chosen) : lastAgent;
  const selectedKey = chosen ?? lastTarget;

  function send(): void {
    if (!sheetStack || !share || !selected || sentTo.current) return;
    const target = { serverId: selected.serverId, agentId: selected.id };
    requestComposerText({ ...target, text: share.text, files: share.files });
    sentTo.current = target;
    if (apiUrl && userId) void saveLastShareTarget(apiUrl, userId, target);
    // The chat takes the place of the sheet, over the chat list.
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
      <SheetCloseAction onPress={backOrConnected} />
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
          <ShareContentSection share={share} footer={t("mobile.share.footer")} />
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
