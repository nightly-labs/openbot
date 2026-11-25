import { BrowserTakeoverCard } from "@openbot/ui/features/conversation/ConversationPrompts";
import { useText } from "@openbot/ui/text";
import { Loading, Show } from "solid-js";
import { usePlatform } from "../../platform";
import { serverSupportsCapability } from "../servers/server-capabilities";
import { browserSecretVault } from "./browser-secret-vault";
import { conversationRuntime } from "./conversation-runtime";
import { useConversationViewScope } from "./conversation-scope";
import { openBrowserTabInMainWindow } from "./open-browser-tab-in-main-window";

export function ConversationBrowserTakeover() {
  const {
    props,
    channel,
    browserTakeoverPreview,
    browserTakeoverResolution,
    browserTakeoverTab,
    openBrowserTakeoverTab,
    canOpenBrowserTakeoverTab,
    localSignIn,
    respondToBrowserTakeover,
  } = useConversationViewScope();
  const { t } = useText();
  const runtime = conversationRuntime(props);
  const platform = usePlatform();
  const signInStaysOffServer = () =>
    localSignIn.blockedTakeover() !== undefined || localSignIn.needsDesktopForTakeover();
  const openPage = () => {
    const chatWindow = platform.chatWindow;
    const request = props.browserTakeover;
    if (chatWindow && request) {
      return () =>
        openBrowserTabInMainWindow({
          serverId: chatWindow.serverId,
          agentId: request.agentId,
          tabId: request.tabId,
        });
    }
    return canOpenBrowserTakeoverTab() && !signInStaysOffServer() ? () => openBrowserTakeoverTab() : undefined;
  };
  const completeHere = () =>
    !(
      platform.chatWindow &&
      props.browserTakeover?.reason === "sign-in-blocked" &&
      props.server?.kind === "remote" &&
      serverSupportsCapability(props.server, "browser-sign-in")
    );
  const agentName = () =>
    (channel ? channel.interactionAgentName() : props.agent?.name) ?? t("chat.message.agentFallback");
  return (
    <>
      <Show when={props.browserTakeover}>
        <Loading>
          <BrowserTakeoverCard
            request={props.browserTakeover}
            agentName={agentName()}
            tab={browserTakeoverTab()}
            preview={browserTakeoverPreview().preview}
            previewStatus={browserTakeoverPreview().status}
            onOpen={openPage()}
            onComplete={completeHere() ? () => respondToBrowserTakeover("complete") : undefined}
            onCancel={() => respondToBrowserTakeover("cancel")}
            onSignInLocally={localSignIn.canStartForTakeover() ? localSignIn.startForTakeover : undefined}
            signInBlocked={localSignIn.blockedTakeover()}
            signInOnDesktop={localSignIn.needsDesktopForTakeover()}
            browserSecret={{
              loadPreview: runtime.browser.capturePreview,
              vault: browserSecretVault(props.server),
              onRespond: runtime.agent.respondToBrowserSecret,
            }}
          />
        </Loading>
      </Show>
      <Show when={!props.browserTakeover && browserTakeoverResolution()}>
        {(resolution) => (
          <BrowserTakeoverCard
            agentName={agentName()}
            tab={resolution().tab}
            preview={resolution().preview}
            previewStatus={resolution().previewStatus}
            decision={resolution().decision}
            signInBlocked={resolution().signInBlocked}
            onComplete={async () => false}
            onCancel={async () => false}
          />
        )}
      </Show>
    </>
  );
}
