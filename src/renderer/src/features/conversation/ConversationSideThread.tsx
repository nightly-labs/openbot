import { canPreviewAttachment } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import { classifyFailure } from "@openbot/telemetry";
import type { AgentMessage } from "@openbot/ui/data";
import { contextUsageView } from "@openbot/ui/features/conversation/ContextUsage";
import { AgentThreadView } from "@openbot/ui/features/conversation/threads/AgentThreadView";
import type { AgentThreadBranchSource } from "@openbot/ui/features/conversation/threads/BranchDivider";
import { TaskAnswerCard } from "@openbot/ui/features/tasks/TaskPanel";
import { useText } from "@openbot/ui/text";
import type { JSX } from "@solidjs/web";
import { createEffect, createMemo, createProjection, Show, untrack } from "solid-js";
import { actionToast } from "../../action-toast";
import { useShowAgentSteps } from "../../agent-steps-preference";
import { toAgentMessages } from "../../app-message-projection";
import { threadAwaitingReplies } from "../../awaiting-replies";
import { useChatBubbleStyle } from "../../chat-bubble-style-preference";
import { useCompactMessageActions } from "../../compact-message-actions-preference";
import { usePlatform } from "../../platform";
import { deviceQuoteShortcut } from "../../send-shortcut-preference";
import { remoteAgentError } from "../agents/agent-error-text";
import { useThreadVisualReplyCard } from "./ChatVisualReply";
import { latestVisibleAgentMessageId } from "./conversation-read-state";
import { conversationRuntime } from "./conversation-runtime";
import { useConversationViewScope } from "./conversation-scope";
import type { SideThread } from "./conversation-types";
import { useThreadMarketplaceSuggestionCard } from "./MarketplaceSuggestionChatCard";
import { useThreadMcpSignInCard } from "./McpSignInChatCard";
import { useMessageBackdropAction } from "./message-backdrop";
import { naturalThreadRows } from "./narration-rows";
import { useThreadSettingLinkCard } from "./SettingLinkChatCard";
import { createTurnSteps } from "./turn-steps";
import { createTurnStreamHold } from "./turn-stream-hold";
import { useTurnTrace } from "./turn-trace";

export function ConversationSideThread(props: { threadId: string; resizer: JSX.Element }) {
  const {
    props: view,
    openExternalMessageUrl,
    openFileFromThread,
    previewAttachment,
    attachmentAction,
    attachmentDownloads,
    openThreadFile,
    installedSkills,
    installedSkillsLoadFailed,
    mcpServers,
    taggableBrowserTabs,
    taggableThreads,
    openTaggedReference,
    threadComposer,
    threadQueue,
    threadVoice,
    besideFocusRequest,
    movePanelThreadToChat,
    copyMessage,
    copiedMessageId,
    branchThread,
    messagePins,
    changeMarkerActions,
    openWaitingAgent,
    shownSubagentId,
    toggleSubagentPanel,
  } = useConversationViewScope();
  const backdropAction = useMessageBackdropAction(conversationRuntime(view));
  const threadBackgroundWorkSince = (taskId: string | undefined) =>
    taskId === undefined ? undefined : view.backgroundWorkSince?.(taskId);
  const { t, errorMessage } = useText();
  const failureToast = (fallback: AppTextKey) => ({
    onError: (error: unknown) => {
      actionToast.error(errorMessage(error, t(fallback)), {
        report: { operation: "turn", source: "action", cause_code: classifyFailure(error) },
      });
    },
  });
  const thread = (): SideThread | undefined => view.threads?.side.thread(props.threadId);
  const item = () => view.threads?.side.tabs.find((tab) => tab.id === props.threadId);
  const awaiting = createMemo(() => threadAwaitingReplies(thread()?.task, view.agents, view.agentWaits));
  const messages = createProjection<AgentMessage[]>(
    () => {
      const messages = thread()?.conversation?.messages.filter(
        (message) => message.questionPrompt?.resolution !== null,
      );
      return messages ? toAgentMessages(messages, view.agent?.id) : [];
    },
    [],
    { key: "id" },
  );
  const streamHeld = createTurnStreamHold(() => thread()?.task.activeTurnId);
  const shownMessages = createMemo(() =>
    view.responseStyle === "natural" ? naturalThreadRows(messages, view.agent?.provider, streamHeld) : messages,
  );
  const turnSteps = createTurnSteps({
    messages: () => messages,
    lines: () => undefined,
    activeTurnId: () => thread()?.task.activeTurnId,
  });
  const turnTrace = useTurnTrace({
    turnSteps,
    agentName: () => view.agent?.name,
    agents: () => view.agents,
  });
  const showAgentSteps = useShowAgentSteps();
  const compactMessageActions = useCompactMessageActions();
  const bubbleStyle = useChatBubbleStyle();
  const { appFocused } = usePlatform();
  createEffect(
    () => ({
      messageId: appFocused() ? latestVisibleAgentMessageId(messages) : null,
      read: thread()?.onRead,
    }),
    ({ messageId, read }) => {
      if (messageId && read) read(messageId);
    },
  );
  const fromThread = (open: () => void) => openFileFromThread(props.threadId, open);
  const draftKey = () => threadComposer.sideDraftKey(props.threadId);
  const shownAt = untrack(besideFocusRequest);
  const focusRequest = () => {
    const request = besideFocusRequest();
    return request > shownAt ? request : undefined;
  };
  const rowImages = () => {
    const key = draftKey();
    return key ? threadComposer.rowImages(key) : [];
  };
  const draft = () => {
    const key = draftKey();
    return key ? threadComposer.draft(key) : undefined;
  };
  function sendSide(side: SideThread, text: string): Promise<boolean> {
    const key = draftKey();
    if (!key) return Promise.resolve(false);
    return threadQueue.editOf(side.task.id)
      ? threadComposer.importsEnded(key).then(() => threadQueue.save(key))
      : threadComposer.send(side, text, key);
  }
  const waitsForAnswer = () => {
    const status = item()?.status;
    return status?.kind === "waiting" && status.reason !== "approval";
  };
  const answerCard = () =>
    waitsForAnswer() ? (
      <TaskAnswerCard agentName={view.agent?.name ?? ""} onAnswer={() => movePanelThreadToChat(props.threadId)} />
    ) : undefined;
  const mcpSignInCard = useThreadMcpSignInCard((body) => thread()?.onSend(body, [], null) ?? Promise.resolve(false));
  const marketplaceCard = useThreadMarketplaceSuggestionCard();
  const settingLinkCard = useThreadSettingLinkCard();
  const visualReplyCard = useThreadVisualReplyCard(draftKey);
  const branch = () => {
    if (!view.threads?.onBranch) return undefined;
    return (messageId: string) => void branchThread(props.threadId, messageId);
  };
  const threadPins = (taskId: string) => {
    if (!messagePins.available()) return undefined;
    return {
      isPinned: (messageId: string) => messagePins.isPinned(taskId, messageId),
      onToggle: (messageId: string, pinned: boolean) => messagePins.set(taskId, messageId, pinned),
    };
  };
  const deleteMessage = () => {
    const remove = view.threads?.onDeleteMessage;
    const taskId = thread()?.task.id;
    if (!remove || !taskId) return undefined;
    return (messageId: string) => remove(taskId, messageId);
  };
  const reply = () => {
    if (!view.threads?.acceptsReplies) return undefined;
    return (message: AgentMessage) => threadComposer.setReply(draftKey(), message.id);
  };
  const replyTo = () => {
    const id = view.threads?.acceptsReplies ? draft()?.replyToMessageId : null;
    return id ? messages.find((message) => message.id === id) : undefined;
  };
  const selectionActions = (side: SideThread) => ({
    onSend: (messageId: string, body: string) => side.onSend(body, [], view.threads?.acceptsReplies ? messageId : null),
    quoteShortcut: deviceQuoteShortcut(view.platform),
  });
  const branchSource = (side: SideThread, agentName: string): AgentThreadBranchSource | undefined => {
    const source = view.threads?.branchSource(side.task);
    if (!source) return undefined;
    return {
      throughMessageId: source.throughMessageId,
      label: source.deleted ? null : (source.title ?? agentName),
      onOpen: source.onOpen,
    };
  };
  const shown = () => {
    const agent = view.agent;
    const current = thread();
    return agent && current ? { agent, thread: current } : undefined;
  };
  return (
    <aside
      id="side-thread-panel"
      class="browser-panel side-thread-panel"
      aria-label={t("conversation.threads.view.label", { title: item()?.title ?? "" })}
    >
      {props.resizer}
      <Show when={shown()}>
        {(current) => (
          <AgentThreadView
            task={current().thread.task}
            failureText={view.server && view.server.kind !== "local" ? remoteAgentError : undefined}
            limit={view.threads?.limit ?? 1}
            agent={current().agent}
            agents={view.agents}
            messages={shownMessages()}
            skills={installedSkills()}
            skillsLoadFailed={installedSkillsLoadFailed()}
            mcpServers={mcpServers()}
            browserTabs={taggableBrowserTabs()}
            threads={taggableThreads()}
            onOpenTag={openTaggedReference}
            draft={draft()?.text ?? ""}
            draftAttachments={draft()?.attachments}
            rowAttachments={rowImages()}
            pendingImages={threadComposer.pendingImages(draftKey())}
            onRemoveAttachment={(attachment) => threadComposer.removeAttachment(draftKey(), attachment.id)}
            onPasteFiles={(files, selection, text) => threadComposer.pasteFiles(files, selection, draftKey(), text)}
            onDraftChange={(text) => threadComposer.setText(draftKey(), text)}
            onOpenDraftAttachment={(attachment) =>
              fromThread(() =>
                canPreviewAttachment(attachment)
                  ? void previewAttachment(attachment)
                  : attachmentAction(attachment, "open"),
              )
            }
            voice={threadVoice(draftKey())}
            focusRequest={focusRequest()}
            mediaSource={view.runtime?.attachmentMedia}
            downloads={attachmentDownloads}
            onSend={(text) => sendSide(current().thread, text)}
            onStop={() => current().thread.onStop()}
            onOpenLink={(url) => void openExternalMessageUrl(url)}
            onOpenFile={(kind, agentId, path, asWritten) =>
              fromThread(() => openThreadFile(kind, agentId, path, asWritten))
            }
            onSelectAgent={view.onSelectAgent}
            onOpenWaitingAgent={openWaitingAgent}
            changeMarkerActions={changeMarkerActions}
            onPreview={(attachment) => fromThread(() => void previewAttachment(attachment))}
            onAttachmentAction={(attachment, action) => fromThread(() => attachmentAction(attachment, action))}
            backdropAction={backdropAction}
            approval={current().thread.approval}
            onRespondApproval={(decision) =>
              current().thread.onRespondApproval(decision, failureToast("prompt.approval.answerFailed"))
            }
            context={contextUsageView(current().thread.contextState)}
            onCompactContext={current().thread.onCompactContext}
            waitsForAnswer={waitsForAnswer()}
            attention={answerCard()}
            messageCard={(message, quote) =>
              visualReplyCard(message, quote) ??
              mcpSignInCard(message) ??
              marketplaceCard(message) ??
              settingLinkCard(message)
            }
            olderMessages={current().thread.olderMessages}
            newerMessages={current().thread.newerMessages}
            focusMessage={current().thread.focusMessage}
            stepsAbove={turnSteps.stepsAbove}
            factsAbove={turnSteps.factsAbove}
            traceAbove={turnTrace}
            activeSteps={turnSteps.activeSteps()}
            backgroundWorkSince={threadBackgroundWorkSince(current().thread.task?.id)}
            stepsOpenByDefault={showAgentSteps()}
            onCopyMessage={(message) => void copyMessage(message)}
            copiedMessageId={copiedMessageId()}
            compactMessageActions={compactMessageActions()}
            bubbleStyle={bubbleStyle()}
            responseStyle={view.responseStyle}
            onBranch={branch()}
            onDeleteMessage={deleteMessage()}
            messagePins={threadPins(current().thread.task.id)}
            canDeleteMessage={view.canDeleteMessage}
            branchSource={branchSource(current().thread, current().agent.name)}
            onReply={reply()}
            replyTo={replyTo()}
            onCancelReply={() => threadComposer.setReply(draftKey(), null)}
            queue={threadQueue.view(current().thread.task, draftKey())}
            awaiting={awaiting()}
            selectionActions={selectionActions(current().thread)}
            subagents={{ selectedId: shownSubagentId(), onOpen: toggleSubagentPanel }}
          />
        )}
      </Show>
    </aside>
  );
}
