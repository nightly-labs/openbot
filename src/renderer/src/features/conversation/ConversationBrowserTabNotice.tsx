import type { BrowserTab } from "@openbot/contracts/ipc";
import { Button } from "@openbot/ui";
import { ComposerNotice } from "@openbot/ui/features/conversation/ComposerNotice";
import { ComposerStackCard } from "@openbot/ui/features/conversation/ComposerStackCard";
import { useText } from "@openbot/ui/text";
import { usePlatform } from "../../platform";
import { useConversationViewScope } from "./conversation-scope";
import { openBrowserTabInMainWindow } from "./open-browser-tab-in-main-window";

export function ConversationBrowserTabNotice() {
  const { props, browserTabNotice, noticeBrowserTabs, openBrowserTakeoverTab } = useConversationViewScope();
  const { t } = useText();
  const platform = usePlatform();
  const agentName = () => props.agent?.name ?? t("chat.message.agentFallback");
  const openPage = (tab: BrowserTab) => {
    noticeBrowserTabs();
    const chatWindow = platform.chatWindow;
    const agentId = props.agent?.id;
    if (chatWindow && agentId) openBrowserTabInMainWindow({ serverId: chatWindow.serverId, agentId, tabId: tab.id });
    else openBrowserTakeoverTab(tab);
  };
  return (
    <ComposerStackCard when={browserTabNotice()}>
      {(notice) => (
        <ComposerNotice
          body={
            notice().count > 1
              ? t("composer.browserTab.openedMany", { name: agentName(), count: notice().count })
              : t("composer.browserTab.opened", { name: agentName(), title: notice().tab.title })
          }
          action={
            <>
              <Button variant="outline" size="sm" type="button" onClick={() => openPage(notice().tab)}>
                {t("composer.browserTab.open")}
              </Button>
              <Button variant="ghost" size="sm" type="button" onClick={noticeBrowserTabs}>
                {t("composer.browserTab.hide")}
              </Button>
            </>
          }
        />
      )}
    </ComposerStackCard>
  );
}
