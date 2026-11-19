import { classifyFailure } from "@openbot/telemetry";
import { BrowserTakeoverCard } from "@openbot/ui/features/conversation/ConversationPrompts";
import { useText } from "@openbot/ui/text";
import { Loading, Show } from "solid-js";
import { actionToast } from "../../action-toast";
import { usePlatform } from "../../platform";
import { serverSupportsCapability } from "../servers/server-capabilities";
import { browserSecretVault } from "./browser-secret-vault";
import { conversationPort } from "./conversation-port";
import { conversationRuntime } from "./conversation-runtime";
import { useConversationViewScope } from "./conversation-scope";

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
  const { t, errorMessage } = useText();
  const runtime = conversationRuntime(props);
  const platform = usePlatform();
  const openPage = () => {
    const chatWindow = platform.chatWindow;
    const request = props.browserTakeover;
    if (chatWindow && request) {
      return () =>
        void conversationPort()
          .dynamicIsland.openBrowserTakeover({
            serverId: chatWindow.serverId,
            agentId: request.agentId,
            tabId: request.tabId,
          })
          .catch((error: unknown) =>
            actionToast.error(errorMessage(error, t("prompt.browser.openFailed")), {
              report: { operation: "other", source: "action", cause_code: classifyFailure(error) },
            }),
          );
    }
    return canOpenBrowserTakeoverTab() ? () => openBrowserTakeoverTab() : undefined;
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
