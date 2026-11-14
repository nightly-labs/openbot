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
import { useChatBubbleStyle } from "../../chat-bubble-style-preference";
import { useCompactMessageActions } from "../../compact-message-actions-preference";
import { usePlatform } from "../../platform";
import { deviceQuoteShortcut, deviceSendShortcut } from "../../send-shortcut-preference";
import { useThreadVisualReplyCard } from "./ChatVisualReply";
import { ConversationBrowserTakeover } from "./ConversationBrowserTakeover";
import { ConversationQuestionPrompt } from "./ConversationQuestionPrompt";
import { chatSearchOpensMessage } from "./chat-search";
import { latestVisibleAgentMessageId } from "./conversation-read-state";
import { useConversationViewScope } from "./conversation-scope";
import type { ConversationThreads } from "./conversation-types";
import { useThreadMcpSignInCard } from "./McpSignInChatCard";
import { createTurnSteps } from "./turn-steps";

/** The open side thread of the agent, in the place of the agent's own chat and its message box. */
export function ConversationThread() {
  const {
    props,
    openExternalMessageUrl,
    previewAttachment,
    attachmentAction,
    attachmentDownloads,
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
  } = useConversationViewScope();
  const { t, errorMessage } = useText();
  const [picker, setPicker] = createSignal<HTMLInputElement>();
  /** A failed answer shows here, where the person answered, and not in the agent's own chat. */
  const failureToast = (fallback: AppTextKey) => ({
    onError: (error: unknown) => {
      actionToast.error(errorMessage(error, t(fallback)), {
        report: { operation: "turn", source: "action", cause_code: classifyFailure(error) },
      });
    },
  });
  /** The takeover card, or its result, shows when the conversation's takeover is of this thread. */
  const takeoverShown = () => props.browserTakeover !== undefined || browserTakeoverResolution() !== null;
  /** Rebuilt only when a card comes or goes, so a card keeps what the person entered. */
  const hasAttention = createMemo(() => takeoverShown() || props.prompt !== undefined);
  /** Reconciled by id, so a stream chunk redraws only the message that changed. */
  const messages = createProjection<AgentMessage[]>(
    () => {
      const conversation = props.threads?.conversation;
      // The card draws a question that waits, so its message is left out, as in the agent's chat.
      const messages = conversation?.messages.filter((message) => message.questionPrompt?.resolution !== null);
      return messages ? toAgentMessages(messages, props.agent?.id) : [];
    },
    [],
    { key: "id" },
  );
  // The thread gets only the latest progress line of a running turn, so its steps are the thoughts,
  // and after the turn the tool steps of its stored trace.
  const turnSteps = createTurnSteps({
    messages: () => messages,
    lines: () => undefined,
    activeTurnId: () => props.threads?.open?.activeTurnId,
  });
  const showAgentSteps = useShowAgentSteps();
  const compactMessageActions = useCompactMessageActions();
  const bubbleStyle = useChatBubbleStyle();
  const { appFocused } = usePlatform();
  // The person reads the open thread while the window has focus. The mark is the member's, so the
  // phone no longer shows the thread as unread.
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
  const view = () => {
    const agent = props.agent;
    const threads = props.threads;
    return agent && threads ? { agent, threads } : undefined;
  };
  /** Each thread keeps its unsent text while the agent works, and when another thread or chat opens. */
  const draft = () => {
    const key = threadComposer.openDraftKey();
    return key ? threadComposer.draft(key) : undefined;
  };
  const rowImages = () => {
    const key = threadComposer.openDraftKey();
    return key ? threadComposer.rowImages(key) : [];
  };
  // The preload imports the picked files, and the view routes them to the open thread.
  const openPicker = () => {
    const input = picker();
    if (!input) return;
    input.value = "";
    input.click();
  };
  /** As in the agent's own chat: the draft goes to the side question, unless it names files. */
  const askSideQuestion = () => {
    if (!sideQuestionAvailable()) return undefined;
    return () => {
      const current = draft();
      const text = current?.attachments.length === 0 ? current.text : "";
      if (text) threadComposer.setText(threadComposer.openDraftKey(), "");
      openSideQuestion(text);
    };
  };
  // The editor is new each time a thread opens. A focus request from before is not for it: it would take
  // the focus from where the user clicked.
  const shownAt = untrack(threadFocusRequest);
  const focusRequest = () => {
    const request = threadFocusRequest();
    return request > shownAt ? request : undefined;
  };
  /** Dictation as in the agent's own chat. The web client has no speech model. */
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
  /** Branches the open thread through an answer. A new thread has no answer to branch from. */
  const branch = (threads: ConversationThreads) => {
    const taskId = threads.open?.id;
    if (!threads.onBranch || !taskId) return undefined;
    return (messageId: string) => void branchThread(taskId, messageId);
  };
  /** Pin and Unpin on the messages of the open thread. A host that cannot pin has no such item. */
  const threadPins = (taskId: string | undefined) => {
    if (!messagePins.available() || !taskId) return undefined;
    return {
      isPinned: (messageId: string) => messagePins.isPinned(taskId, messageId),
      onToggle: (messageId: string, pinned: boolean) => messagePins.set(taskId, messageId, pinned),
    };
  };
  /** Deletes a message of the open thread. A new thread has no message to delete. */
  const deleteMessage = (threads: ConversationThreads) => {
    const remove = threads.onDeleteMessage;
    const taskId = threads.open?.id;
    if (!remove || !taskId) return undefined;
    return (messageId: string) => remove(taskId, messageId);
  };
  /** Replies to a message of the open thread. A new thread has no message to reply to. */
  const reply = (threads: ConversationThreads) => {
    if (!threads.acceptsReplies || !threads.open) return undefined;
    return (message: AgentMessage) => threadComposer.setReply(threadComposer.openDraftKey(), message.id);
  };
  const replyTo = () => {
    const id = props.threads?.acceptsReplies ? draft()?.replyToMessageId : null;
    return id ? messages.find((message) => message.id === id) : undefined;
  };
  /** Text selected in the open thread goes to this thread, as a reply where the server takes one. */
  const selectionActions = (threads: ConversationThreads) => ({
    onSend: (messageId: string, body: string) => threads.onSend(body, [], threads.acceptsReplies ? messageId : null),
    quoteShortcut: deviceQuoteShortcut(props.platform),
  });
  /** Where the open thread came from, when it is a branch. The agent's own chat shows the agent's name. */
  const branchSource = (threads: ConversationThreads, agentName: string): AgentThreadBranchSource | undefined => {
    const source = threads.open ? threads.branchSource(threads.open) : undefined;
    if (!source) return undefined;
    return {
      throughMessageId: source.throughMessageId,
      label: source.deleted ? null : (source.title ?? agentName),
      onOpen: source.onOpen,
    };
  };
  /** The message that the open thread scrolls to once, after a click on "Branched from". */
  const focusMessage = (threads: ConversationThreads) => {
    const focus = threads.focusMessage;
    return focus && focus.taskId === threads.open?.id ? focus : undefined;
  };
  /** Continue on a sign-in card goes to the open thread, as the person's next message there. */
  const mcpSignInCard = useThreadMcpSignInCard(
    (body) => props.threads?.onSend(body, [], null) ?? Promise.resolve(false),
  );
  /** A visual reply page shows as in the agent's chat, and writes in this thread's message box. */
  const visualReplyCard = useThreadVisualReplyCard(threadComposer.openDraftKey, requestThreadFocus);
  /** The cards that the thread waits for: its browser takeover, and its question as a form. */
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
            messages={messages}
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
              // While a queued message is in the message box, Send saves it in its place.
              const key = threadComposer.openDraftKey();
              return key && threadQueue.editOf(current().threads.open?.id)
                ? threadComposer.importsEnded(key).then(() => threadQueue.save(key))
                : threadComposer.send(current().threads, text);
            }}
            onStop={() => current().threads.onStop()}
            onOpenLink={(url) => void openExternalMessageUrl(url)}
            onSelectAgent={props.onSelectAgent}
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
            messageCard={(message, quote) => visualReplyCard(message, quote) ?? mcpSignInCard(message)}
            olderMessages={current().threads.olderMessages}
            newerMessages={current().threads.newerMessages}
            stepsAbove={turnSteps.stepsAbove}
            factsAbove={turnSteps.factsAbove}
            activeSteps={turnSteps.activeSteps()}
            stepsOpenByDefault={showAgentSteps()}
            sendShortcut={deviceSendShortcut(props.platform)}
            onCopyMessage={(message) => void copyMessage(message)}
            copiedMessageId={copiedMessageId()}
            compactMessageActions={compactMessageActions()}
            bubbleStyle={bubbleStyle()}
            onBranch={branch(current().threads)}
            onDeleteMessage={deleteMessage(current().threads)}
            messagePins={threadPins(current().threads.open?.id)}
            canDeleteMessage={props.canDeleteMessage}
            branchSource={branchSource(current().threads, current().agent.name)}
            focusMessage={focusMessage(current().threads)}
            onReply={reply(current().threads)}
            replyTo={replyTo()}
            onCancelReply={() => threadComposer.setReply(threadComposer.openDraftKey(), null)}
            queue={threadQueue.view(current().threads.open, threadComposer.openDraftKey())}
            selectionActions={selectionActions(current().threads)}
          />
        </>
      )}
    </Show>
  );
}
