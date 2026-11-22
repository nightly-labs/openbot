import { canPreviewAttachment } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import { classifyFailure } from "@openbot/telemetry";
import { Input } from "@openbot/ui";
import type { AgentMessage } from "@openbot/ui/data";
import { ChatSearch } from "@openbot/ui/features/conversation/ChatSearch";
import { contextUsageView } from "@openbot/ui/features/conversation/ContextUsage";
import { AgentThreadView, type AgentThreadVoice } from "@openbot/ui/features/conversation/threads/AgentThreadView";
import type { AgentThreadBranchSource } from "@openbot/ui/features/conversation/threads/BranchDivider";
import { useText } from "@openbot/ui/text";
import { createEffect, createMemo, createProjection, createSignal, Show, untrack } from "solid-js";
import { actionToast } from "../../action-toast";
import { useShowAgentSteps } from "../../agent-steps-preference";
import { toAgentMessages } from "../../app-message-projection";
import { threadAwaitingReplies } from "../../awaiting-replies";
import { useChatBubbleStyle } from "../../chat-bubble-style-preference";
import { useCompactMessageActions } from "../../compact-message-actions-preference";
import { usePlatform } from "../../platform";
import { deviceQuoteShortcut, deviceSendShortcut } from "../../send-shortcut-preference";
import { useThreadVisualReplyCard } from "./ChatVisualReply";
import { ConversationBrowserTakeover } from "./ConversationBrowserTakeover";
import { ConversationQuestionPrompt } from "./ConversationQuestionPrompt";
import { chatSearchOpensMessage } from "./chat-search";
import { latestVisibleAgentMessageId } from "./conversation-read-state";
import { conversationRuntime } from "./conversation-runtime";
import { useConversationViewScope } from "./conversation-scope";
import type { ConversationThreads } from "./conversation-types";
import { useThreadMarketplaceSuggestionCard } from "./MarketplaceSuggestionChatCard";
import { useThreadMcpSignInCard } from "./McpSignInChatCard";
import { useMessageBackdropAction } from "./message-backdrop";
import { narrationRows, naturalThreadRows } from "./narration-rows";
import { useThreadSettingLinkCard } from "./SettingLinkChatCard";
import { withQuestionContext } from "./stores/scroll-store";
import { createTurnSteps } from "./turn-steps";
import { createTurnStreamHold } from "./turn-stream-hold";
import { useTurnTrace } from "./turn-trace";

export function ConversationThread() {
  const {
    props,
    openExternalMessageUrl,
    previewAttachment,
    attachmentAction,
    attachmentDownloads,
    openThreadFile,
    browserTakeoverResolution,
    installedSkills,
    installedSkillsLoadFailed,
    mcpServers,
    taggableBrowserTabs,
    taggableThreads,
    openTaggedReference,
    threadComposer,
    threadQueue,
    threadFocusRequest,
    requestThreadFocus,
    messagePins,
    threadVoiceLiveText,
    threadVoiceOwned,
    startThreadVoiceRecording,
    stopVoiceRecording,
    stopVoiceRecordingAndSend,
    cancelVoiceRecording,
    voicePhase,
    voiceLevels,
    voiceElapsedSeconds,
    voiceModelProgress,
    sideQuestionAvailable,
    openSideQuestion,
    threadSearch,
    threadSearchOpen,
    threadSearchQuery,
    threadSearchMatches,
    activeThreadSearchIndex,
    setThreadSearchQuery,
    setThreadScrollElement,
    copyMessage,
    copiedMessageId,
    branchThread,
    changeMarkerActions,
  } = useConversationViewScope();
  const backdropAction = useMessageBackdropAction(conversationRuntime(props));
  const threadBackgroundWorkSince = (taskId: string | undefined) =>
    taskId === undefined ? undefined : props.backgroundWorkSince?.(taskId);
  const { t, errorMessage } = useText();
  const [picker, setPicker] = createSignal<HTMLInputElement>();
  const failureToast = (fallback: AppTextKey) => ({
    onError: (error: unknown) => {
      actionToast.error(errorMessage(error, t(fallback)), {
        report: { operation: "turn", source: "action", cause_code: classifyFailure(error) },
      });
    },
  });
  const takeoverShown = () => props.browserTakeover !== undefined || browserTakeoverResolution() !== null;
  const hasAttention = createMemo(() => takeoverShown() || props.prompt !== undefined);
  const messages = createProjection<AgentMessage[]>(
    () => {
      const conversation = props.threads?.conversation;
      const messages = conversation?.messages.filter((message) => message.questionPrompt?.resolution !== null);
      return messages ? toAgentMessages(messages, props.agent?.id) : [];
    },
    [],
    { key: "id" },
  );
  const streamHeld = createTurnStreamHold(() => props.threads?.open?.activeTurnId);
  const shownMessages = createMemo(() =>
    withQuestionContext(
      props.responseStyle === "natural" ? naturalThreadRows(messages, props.agent?.provider, streamHeld) : messages,
      messages,
      props.prompt?.turnId,
      (thinking) => narrationRows(thinking, props.agent?.provider),
    ),
  );
  const turnSteps = createTurnSteps({
    messages: () => messages,
    lines: () => undefined,
    activeTurnId: () => props.threads?.open?.activeTurnId,
  });
  const turnTrace = useTurnTrace({
    turnSteps,
    agentName: () => props.agent?.name,
    agents: () => props.agents,
  });
  const showAgentSteps = useShowAgentSteps();
  const compactMessageActions = useCompactMessageActions();
  const bubbleStyle = useChatBubbleStyle();
  const { appFocused } = usePlatform();
  createEffect(
    () => ({
      taskId: props.threads?.open?.id,
      messageId: appFocused() ? latestVisibleAgentMessageId(messages) : null,
      read: props.threads?.onRead,
    }),
    ({ taskId, messageId, read }) => {
      if (taskId && messageId && read) read(messageId);
    },
  );
  const awaiting = createMemo(() => threadAwaitingReplies(props.threads?.open, props.agents, props.agentWaits));
  const view = () => {
    const agent = props.agent;
    const threads = props.threads;
    return agent && threads ? { agent, threads } : undefined;
  };
  const draft = () => {
    const key = threadComposer.openDraftKey();
    return key ? threadComposer.draft(key) : undefined;
  };
  const rowImages = () => {
    const key = threadComposer.openDraftKey();
    return key ? threadComposer.rowImages(key) : [];
  };
  const openPicker = () => {
    const input = picker();
    if (!input) return;
    input.value = "";
    input.click();
  };
  const askSideQuestion = () => {
    if (!sideQuestionAvailable()) return undefined;
    return () => {
      const current = draft();
      const text = current?.attachments.length === 0 ? current.text : "";
      if (text) threadComposer.setText(threadComposer.openDraftKey(), "");
      openSideQuestion(text);
    };
  };
  const shownAt = untrack(threadFocusRequest);
  const focusRequest = () => {
    const request = threadFocusRequest();
    return request > shownAt ? request : undefined;
  };
  const voice = (): AgentThreadVoice | undefined => {
    if (props.runtime) return undefined;
    const owned = threadVoiceOwned();
    return {
      phase: owned ? voicePhase() : "idle",
      blocked: !owned && voicePhase() !== "idle",
      liveText: threadVoiceLiveText(),
      levels: voiceLevels(),
      elapsedSeconds: voiceElapsedSeconds(),
      modelProgress: voiceModelProgress(),
      onStart: startThreadVoiceRecording,
      onCancel: cancelVoiceRecording,
      onFinish: stopVoiceRecording,
      onSend: stopVoiceRecordingAndSend,
    };
  };
  const branch = (threads: ConversationThreads) => {
    const taskId = threads.open?.id;
    if (!threads.onBranch || !taskId) return undefined;
    return (messageId: string) => void branchThread(taskId, messageId);
  };
  const threadPins = (taskId: string | undefined) => {
    if (!messagePins.available() || !taskId) return undefined;
    return {
      isPinned: (messageId: string) => messagePins.isPinned(taskId, messageId),
      onToggle: (messageId: string, pinned: boolean) => messagePins.set(taskId, messageId, pinned),
    };
  };
  const deleteMessage = (threads: ConversationThreads) => {
    const remove = threads.onDeleteMessage;
    const taskId = threads.open?.id;
    if (!remove || !taskId) return undefined;
    return (messageId: string) => remove(taskId, messageId);
  };
  const reply = (threads: ConversationThreads) => {
    if (!threads.acceptsReplies || !threads.open) return undefined;
    return (message: AgentMessage) => threadComposer.setReply(threadComposer.openDraftKey(), message.id);
  };
  const replyTo = () => {
    const id = props.threads?.acceptsReplies ? draft()?.replyToMessageId : null;
    return id ? messages.find((message) => message.id === id) : undefined;
  };
  const selectionActions = (threads: ConversationThreads) => ({
    onSend: (messageId: string, body: string) => threads.onSend(body, [], threads.acceptsReplies ? messageId : null),
    quoteShortcut: deviceQuoteShortcut(props.platform),
  });
  const branchSource = (threads: ConversationThreads, agentName: string): AgentThreadBranchSource | undefined => {
    const source = threads.open ? threads.branchSource(threads.open) : undefined;
    if (!source) return undefined;
    return {
      throughMessageId: source.throughMessageId,
      label: source.deleted ? null : (source.title ?? agentName),
      onOpen: source.onOpen,
    };
  };
  const focusMessage = (threads: ConversationThreads) => {
    const focus = threads.focusMessage;
    return focus && focus.taskId === threads.open?.id ? focus : undefined;
  };
  const mcpSignInCard = useThreadMcpSignInCard(
    (body) => props.threads?.onSend(body, [], null) ?? Promise.resolve(false),
  );
  const marketplaceCard = useThreadMarketplaceSuggestionCard();
  const settingLinkCard = useThreadSettingLinkCard();
  const visualReplyCard = useThreadVisualReplyCard(threadComposer.openDraftKey, requestThreadFocus);
  const attention = () => {
    if (!hasAttention()) return undefined;
    return (
      <>
        <ConversationQuestionPrompt
          onAnswer={(answers, options) =>
            props.onAnswerPrompt(answers, options ?? failureToast("uiBlock.error.answerFailed"))
          }
        />
        <ConversationBrowserTakeover />
      </>
    );
  };
  return (
    <Show when={view()}>
      {(current) => (
        <>
          <Show when={current().threads.acceptsFiles}>
            <Input ref={setPicker} type="file" multiple hidden tabindex={-1} data-openbot-attachment-picker="true" />
          </Show>
          <Show when={threadSearchOpen()}>
            <ChatSearch
              query={threadSearchQuery()}
              current={activeThreadSearchIndex()}
              total={threadSearchMatches().length}
              inputRef={threadSearch.setChatSearchInputElement}
              onQueryChange={setThreadSearchQuery}
              onPrevious={() => threadSearch.moveChatSearch(-1)}
              onNext={() => threadSearch.moveChatSearch(1)}
              onClose={threadSearch.closeChatSearch}
            />
          </Show>
          <AgentThreadView
            scrollRef={setThreadScrollElement}
            showFullMessage={(message) =>
              threadSearchOpen() && chatSearchOpensMessage(message.body, threadSearchQuery())
            }
            task={current().threads.open ?? null}
            limit={current().threads.limit}
            agent={current().agent}
            agents={props.agents}
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
            pendingImages={threadComposer.pendingImages(threadComposer.openDraftKey())}
            onRemoveAttachment={(attachment) =>
              threadComposer.removeAttachment(threadComposer.openDraftKey(), attachment.id)
            }
            onDraftChange={(text) => threadComposer.setText(threadComposer.openDraftKey(), text)}
            onPasteFiles={(files, selection, text) => threadComposer.pasteFiles(files, selection, undefined, text)}
            onOpenDraftAttachment={(attachment) =>
              canPreviewAttachment(attachment)
                ? void previewAttachment(attachment)
                : attachmentAction(attachment, "open")
            }
            onAttachFiles={current().threads.acceptsFiles ? openPicker : undefined}
            onSideQuestion={askSideQuestion()}
            voice={voice()}
            focusRequest={focusRequest()}
            onSend={(text) => {
              const key = threadComposer.openDraftKey();
              return key && threadQueue.editOf(current().threads.open?.id)
                ? threadComposer.importsEnded(key).then(() => threadQueue.save(key))
                : threadComposer.send(current().threads, text);
            }}
            onStop={() => current().threads.onStop()}
            onOpenLink={(url) => void openExternalMessageUrl(url)}
            onOpenFile={openThreadFile}
            onSelectAgent={props.onSelectAgent}
            changeMarkerActions={changeMarkerActions}
            onPreview={(attachment) => void previewAttachment(attachment)}
            onAttachmentAction={attachmentAction}
            mediaSource={props.runtime?.attachmentMedia}
            downloads={attachmentDownloads}
            macWindowControls={props.platform === "darwin"}
            approval={current().threads.approval}
            onRespondApproval={(decision) =>
              current().threads.onRespondApproval(decision, failureToast("prompt.approval.answerFailed"))
            }
            context={contextUsageView(current().threads.contextState)}
            onCompactContext={current().threads.onCompactContext}
            waitsForAnswer={props.prompt !== undefined || props.browserTakeover !== undefined}
            attention={attention()}
            messageCard={(message, quote) =>
              visualReplyCard(message, quote) ??
              mcpSignInCard(message) ??
              marketplaceCard(message) ??
              settingLinkCard(message)
            }
            olderMessages={current().threads.olderMessages}
            newerMessages={current().threads.newerMessages}
            stepsAbove={turnSteps.stepsAbove}
            factsAbove={turnSteps.factsAbove}
            traceAbove={turnTrace}
            activeSteps={turnSteps.activeSteps()}
            backgroundWorkSince={threadBackgroundWorkSince(current().threads.open?.id)}
            stepsOpenByDefault={showAgentSteps()}
            sendShortcut={deviceSendShortcut(props.platform)}
            onCopyMessage={(message) => void copyMessage(message)}
            copiedMessageId={copiedMessageId()}
            compactMessageActions={compactMessageActions()}
            bubbleStyle={bubbleStyle()}
            responseStyle={props.responseStyle}
            onBranch={branch(current().threads)}
            onDeleteMessage={deleteMessage(current().threads)}
            messagePins={threadPins(current().threads.open?.id)}
            canDeleteMessage={props.canDeleteMessage}
            backdropAction={backdropAction}
            branchSource={branchSource(current().threads, current().agent.name)}
            focusMessage={focusMessage(current().threads)}
            onReply={reply(current().threads)}
            replyTo={replyTo()}
            onCancelReply={() => threadComposer.setReply(threadComposer.openDraftKey(), null)}
            queue={threadQueue.view(current().threads.open, threadComposer.openDraftKey())}
            awaiting={awaiting()}
            selectionActions={selectionActions(current().threads)}
          />
        </>
      )}
    </Show>
  );
}
