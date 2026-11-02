import { BrowserTakeoverCard } from "@openbot/ui/features/conversation/ConversationPrompts";
import { useText } from "@openbot/ui/text";
import { Loading, Show } from "solid-js";
import { browserSecretVault } from "./browser-secret-vault";
import { conversationRuntime } from "./conversation-runtime";
import { useConversationViewScope } from "./conversation-scope";

/**
 * The browser takeover of the open thread, with the secure card for a code or a password, and its result
 * after the user answers. The agent's chat and an open side thread show it.
 */
export function ConversationBrowserTakeover() {
  const {
    props,
    channel,
    browserTakeoverPreview,
    browserTakeoverResolution,
    browserTakeoverTab,
    openBrowserTakeoverTab,
    localSignIn,
    respondToBrowserTakeover,
  } = useConversationViewScope();
  const { t } = useText();
  const runtime = conversationRuntime(props);
  /** The agent that asks in a card: in a channel, the working agent whose card shows. */
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
            onOpen={openBrowserTakeoverTab}
            onComplete={() => respondToBrowserTakeover("complete")}
            onCancel={() => respondToBrowserTakeover("cancel")}
            onSignInLocally={localSignIn.canStartForTakeover() ? localSignIn.startForTakeover : undefined}
            signInBlocked={localSignIn.blockedTakeover()}
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
