import { supportedAttachmentExtensions } from "@openbot/contracts/attachment-files";
import { canPreviewAttachment } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import { classifyFailure } from "@openbot/telemetry";
import { Input } from "@openbot/ui";
import type { AgentMessage } from "@openbot/ui/data";
import { ChatSearch } from "@openbot/ui/features/conversation/ChatSearch";
import { contextUsageView } from "@openbot/ui/features/conversation/ContextUsage";
import { AgentThreadView, type AgentThreadVoice } from "@openbot/ui/features/conversation/threads/AgentThreadView";
import { useText } from "@openbot/ui/text";
import { createEffect, createMemo, createProjection, createSignal, Show, untrack } from "solid-js";
import { actionToast } from "../../action-toast";
import { useShowAgentSteps } from "../../agent-steps-preference";
import { toAgentMessages } from "../../app-message-projection";
import { usePlatform } from "../../platform";
import { deviceSendShortcut } from "../../send-shortcut-preference";
import { ConversationBrowserTakeover } from "./ConversationBrowserTakeover";
import { ConversationQuestionPrompt } from "./ConversationQuestionPrompt";
import { latestVisibleAgentMessageId } from "./conversation-read-state";
import { useConversationViewScope } from "./conversation-scope";
import { createTurnSteps } from "./turn-steps";

/** A thread takes files only from this computer, which reads every supported type. */
const THREAD_ATTACHMENT_ACCEPT = supportedAttachmentExtensions({ eml: true, media: true, zip: true, mp4: true })
  .map((extension) => `.${extension}`)
  .join(",");

/** The open side thread of the agent, in the place of the agent's own chat and its message box. */
export function ConversationThread() {
  const {
    props,
    openExternalMessageUrl,
    previewAttachment,
    attachmentAction,
    browserTakeoverResolution,
    installedSkills,
    installedSkillsLoadFailed,
    mcpServers,
    threadComposer,
    threadFocusRequest,
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
            <Input
              ref={setPicker}
              type="file"
              accept={THREAD_ATTACHMENT_ACCEPT}
              multiple
              hidden
              tabindex={-1}
              data-openbot-attachment-picker="true"
            />
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
            task={current().threads.open ?? null}
            limit={current().threads.limit}
            agent={current().agent}
            agents={props.agents}
            messages={messages}
            skills={installedSkills()}
            skillsLoadFailed={installedSkillsLoadFailed()}
            mcpServers={mcpServers()}
            draft={draft()?.text ?? ""}
            draftAttachments={draft()?.attachments}
            onDraftChange={(text) => threadComposer.setText(threadComposer.openDraftKey(), text)}
            onPasteFiles={threadComposer.pasteFiles}
            onOpenDraftAttachment={(attachment) =>
              canPreviewAttachment(attachment)
                ? void previewAttachment(attachment)
                : attachmentAction(attachment, "open")
            }
            onAttachFiles={current().threads.acceptsFiles ? openPicker : undefined}
            onSideQuestion={askSideQuestion()}
            voice={voice()}
            focusRequest={focusRequest()}
            onSend={(text) => threadComposer.send(current().threads, text)}
            onStop={() => current().threads.onStop()}
            onOpenLink={(url) => void openExternalMessageUrl(url)}
            onPreview={(attachment) => void previewAttachment(attachment)}
            onAttachmentAction={attachmentAction}
            macWindowControls={props.platform === "darwin"}
            approval={current().threads.approval}
            onRespondApproval={(decision) =>
              current().threads.onRespondApproval(decision, failureToast("prompt.approval.answerFailed"))
            }
            context={contextUsageView(current().threads.contextState)}
            onCompactContext={current().threads.onCompactContext}
            waitsForAnswer={props.prompt !== undefined || props.browserTakeover !== undefined}
            attention={attention()}
            stepsAbove={turnSteps.stepsAbove}
            factsAbove={turnSteps.factsAbove}
            activeSteps={turnSteps.activeSteps()}
            stepsOpenByDefault={showAgentSteps()}
            sendShortcut={deviceSendShortcut(props.platform)}
          />
        </>
      )}
    </Show>
  );
}
