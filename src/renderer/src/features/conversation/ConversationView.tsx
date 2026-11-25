import { agentProviderDescriptor, isKnownAgentProvider } from "@openbot/contracts/agent-providers";
import { DEFAULT_AGENT_ACCESS } from "@openbot/contracts/ipc";
import { ConfirmDialog } from "@openbot/ui";
import { AgentFolderDropOverlay, createAgentFolders } from "@openbot/ui/features/conversation/AgentFolders";
import { MessageSelectionActions } from "@openbot/ui/features/conversation/SelectionActions";
import { CoveredVoiceRecording } from "@openbot/ui/features/conversation/VoiceRecordingMorph";
import { useText } from "@openbot/ui/text";
import { Portal } from "@solidjs/web";
import { createEffect, Show } from "solid-js";
import { deviceQuoteShortcut } from "../../send-shortcut-preference";
import { agentFolderCalls } from "./agent-folders-port";
import { ConversationComposer } from "./ConversationComposer";
import { ConversationHeader } from "./ConversationHeader";
import { ConversationPanels } from "./ConversationPanels";
import { ConversationThread } from "./ConversationThread";
import { ConversationTimeline } from "./ConversationTimeline";
import { ConversationViewScopeContext, createConversationViewScope } from "./conversation-scope";
import type { ConversationProps } from "./conversation-types";
import { lowerSplitShare, sideSplitShare } from "./side-split-layout";
import { conversationOwnerId } from "./stores/composer-store";

function isDragLeavingConversation(currentTarget: HTMLElement, relatedTarget: EventTarget | null): boolean {
  return !(relatedTarget instanceof Node && currentTarget.contains(relatedTarget));
}

export function ConversationView(props: ConversationProps) {
  const scope = createConversationViewScope(props);
  const {
    agentReady,
    browserSidebarOpen,
    dropActive,
    filePreviewOpen,
    activeRightPanel,
    sidePanel,
    sidePanelOpen,
    sideSplits,
    handleChatSearchShortcut,
    sendSelectionInstruction,
    quoteSelection,
    setConversationPanelElement,
    setDropActive,
    sidePanelWidth,
    submitting,
    sideThreadOpen,
    fastModeConfirmationOpen,
    confirmFastMode,
    cancelFastModeConfirmation,
    voicePhase,
    voiceLevels,
    voiceElapsedSeconds,
    stopVoiceRecording,
    cancelVoiceRecording,
  } = scope;
  const { t } = useText();
  const sidePanelUsesBrowserWidth = () => {
    const mode = activeRightPanel();
    if (mode === "browser") return browserSidebarOpen();
    if (mode === "file-preview") return filePreviewOpen();
    return sidePanelOpen();
  };
  const sideSplitsShown = () => sidePanelOpen() && sideSplits().length > 0;
  const sideSplitStyle = () => {
    const count = sideSplits().length;
    const share = sideSplitShare(count);
    const lower = lowerSplitShare();
    return `; --side-split-count: ${count}${share === null ? "" : `; --side-split-share: ${share}`}${lower === null ? "" : `; --side-split-lower: ${lower}`}`;
  };
  const folderCalls = agentFolderCalls();
  function folderDropAgent() {
    const agent = props.agent;
    if (!agent || props.server?.kind !== "local" || props.runtime) return undefined;
    if (isKnownAgentProvider(agent.provider) && agentProviderDescriptor(agent.provider).foldersInFullAccess)
      return agent;
    return (agent.access ?? DEFAULT_AGENT_ACCESS) === "workspace" ? agent : undefined;
  }
  const chatFolders = createAgentFolders(() => {
    const agent = folderDropAgent();
    return agent ? { agentId: agent.id, agentName: agent.name, calls: folderCalls } : undefined;
  });
  createEffect(
    () => props.globalOverlayOpen,
    (open) => {
      if (open) setDropActive(false);
    },
  );
  return (
    <ConversationViewScopeContext value={scope}>
      <main
        ref={(element) => {
          setConversationPanelElement(element);
          element.addEventListener("drop", () => setTimeout(() => setDropActive(false)), { capture: true });
        }}
        aria-label={t("conversation.view.label")}
        onKeyDown={handleChatSearchShortcut}
        class={[
          "conversation-panel",
          {
            "conversation-drop-active": dropActive(),
            "browser-panel-active": sidePanelUsesBrowserWidth(),
            "side-panel-docked": sidePanelOpen(),
            "side-panel-maximized": sidePanelOpen() && sidePanel().maximized,
            "side-panel-split": sideSplitsShown(),
          },
        ]}
        style={`--settings-panel-width: ${sidePanelWidth()}px; --browser-panel-width: ${sidePanelWidth()}px; --side-panel-width: ${sidePanelWidth()}px${sideSplitStyle()}`}
        onDragEnter={(event) => {
          if (!props.globalOverlayOpen && event.dataTransfer?.types.includes("Files")) setDropActive(true);
        }}
        onDragOver={(event) => {
          if (!props.globalOverlayOpen && event.dataTransfer?.types.includes("Files")) event.preventDefault();
        }}
        onDragLeave={(event) => {
          if (isDragLeavingConversation(event.currentTarget, event.relatedTarget)) setDropActive(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          if (props.runtime?.importFiles) void props.runtime.importFiles([...(event.dataTransfer?.files ?? [])]);
        }}
      >
        <MessageSelectionActions
          contextKey={conversationOwnerId(props)}
          disabled={!conversationOwnerId(props) || props.channel?.readOnly() === true || !agentReady() || submitting()}
          onSend={sendSelectionInstruction}
          onQuote={quoteSelection}
          quoteShortcut={deviceQuoteShortcut(props.platform)}
        />
        <Show when={dropActive()}>
          <Show
            when={folderDropAgent()}
            fallback={<div class="attachment-drop-overlay">{t("conversation.view.drop")}</div>}
          >
            {(agent) => (
              <AgentFolderDropOverlay
                agentName={agent().name}
                onDropFolders={(folders) => void chatFolders.drop(folders)}
              />
            )}
          </Show>
        </Show>
        <ConversationHeader />
        {props.notice}

        <ConversationTimeline />
        <ConversationComposer />
        <Show when={sideThreadOpen()}>
          <ConversationThread />
        </Show>

        <ConversationPanels onOpenUsage={props.onOpenUsage} />
        <Show when={props.workspaceCovered && voicePhase() === "recording"}>
          <Portal>
            <CoveredVoiceRecording
              levels={voiceLevels()}
              elapsedSeconds={voiceElapsedSeconds()}
              onCancel={cancelVoiceRecording}
              onFinish={stopVoiceRecording}
            />
          </Portal>
        </Show>
        <ConfirmDialog
          open={fastModeConfirmationOpen()}
          tone="default"
          title={t("composer.fastMode.confirmTitle")}
          description={t("composer.fastMode.confirmDescription")}
          confirmLabel={t("composer.fastMode.confirm")}
          onConfirm={confirmFastMode}
          onCancel={cancelFastModeConfirmation}
        />
      </main>
    </ConversationViewScopeContext>
  );
}
