import { agentProviderDescriptor, isKnownAgentProvider } from "@openbot/contracts/agent-providers";
import { DEFAULT_AGENT_ACCESS } from "@openbot/contracts/ipc";
import { AgentFolderDropOverlay, createAgentFolders } from "@openbot/ui/features/conversation/AgentFolders";
import { MessageSelectionActions } from "@openbot/ui/features/conversation/SelectionActions";
import { useText } from "@openbot/ui/text";
import { createEffect, Show } from "solid-js";
import { currentDevicePlatform } from "../../send-shortcut-preference";
import { agentFolderCalls } from "./agent-folders-port";
import { ConversationComposer } from "./ConversationComposer";
import { ConversationHeader } from "./ConversationHeader";
import { ConversationPanels } from "./ConversationPanels";
import { ConversationThread } from "./ConversationThread";
import { ConversationTimeline } from "./ConversationTimeline";
import { ConversationViewScopeContext, createConversationViewScope } from "./conversation-scope";
import type { ConversationProps } from "./conversation-types";
import { conversationOwnerId } from "./stores/composer-store";

/** @internal Keeps file-drag state active while the pointer moves between conversation descendants. */
function isDragLeavingConversation(currentTarget: HTMLElement, relatedTarget: EventTarget | null): boolean {
  return !(relatedTarget instanceof Node && currentTarget.contains(relatedTarget));
}

export function ConversationView(props: ConversationProps) {
  const scope = createConversationViewScope(props);
  const {
    agentReady,
    browserPanelWidth,
    browserSidebarOpen,
    dropActive,
    filePreviewOpen,
    filesOpen,
    activeRightPanel,
    settingsOpen,
    sidePanel,
    sidePanelOpen,
    handleChatSearchShortcut,
    sendSelectionInstruction,
    quoteSelection,
    setConversationPanelElement,
    setDropActive,
    settingsPanelWidth,
    submitting,
    sideThreadOpen,
  } = scope;
  const { t } = useText();
  const folderCalls = agentFolderCalls();
  /**
   * A local agent in Workspace only mode can get a folder from a drop on the chat. With wider access a
   * folder gives it nothing new, except to a provider whose own file tools reach only its folders.
   * The Team API does not carry an agent's folders.
   */
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
          // In the capture phase, because a folder dropped on the settings panel stops the drop there.
          element.addEventListener("drop", () => setDropActive(false), { capture: true });
        }}
        aria-label={t("conversation.view.label")}
        onKeyDown={handleChatSearchShortcut}
        class={[
          "conversation-panel",
          {
            "conversation-drop-active": dropActive(),
            "browser-panel-active":
              browserSidebarOpen() ||
              filePreviewOpen() ||
              filesOpen() ||
              activeRightPanel() === "question" ||
              activeRightPanel() === "voice" ||
              activeRightPanel() === "subagent" ||
              activeRightPanel() === "thread" ||
              activeRightPanel() === "side-panel",
            "side-panel-docked": sidePanelOpen(),
            "side-panel-maximized": sidePanelOpen() && sidePanel().maximized,
          },
        ]}
        style={`--settings-panel-width: ${settingsPanelWidth()}px; --browser-panel-width: ${browserPanelWidth()}px; --side-panel-width: ${settingsOpen() ? settingsPanelWidth() : browserPanelWidth()}px`}
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
          // The desktop preload imports a dropped file; a client with its own runtime imports it here.
          if (props.runtime?.importFiles) void props.runtime.importFiles([...(event.dataTransfer?.files ?? [])]);
        }}
      >
        <MessageSelectionActions
          contextKey={conversationOwnerId(props)}
          disabled={!conversationOwnerId(props) || props.channel?.readOnly() === true || !agentReady() || submitting()}
          onSend={sendSelectionInstruction}
          onQuote={quoteSelection}
          quoteShortcut={(props.platform ?? currentDevicePlatform()) === "darwin" ? "meta" : "ctrl"}
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

        {/* A side thread covers the agent's own chat and its message box. They stay mounted, so the way
            back keeps their rows and scroll position and does not build the chat again. */}
        <ConversationTimeline />
        <ConversationComposer />
        <Show when={sideThreadOpen()}>
          <ConversationThread />
        </Show>

        <ConversationPanels onOpenUsage={props.onOpenUsage} />
      </main>
    </ConversationViewScopeContext>
  );
}
