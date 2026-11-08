import { canPreviewAttachment } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import { classifyFailure } from "@openbot/telemetry";
import type { AgentMessage } from "@openbot/ui/data";
import { contextUsageView } from "@openbot/ui/features/conversation/ContextUsage";
import { AgentThreadView } from "@openbot/ui/features/conversation/threads/AgentThreadView";
import type { AgentThreadBranchSource } from "@openbot/ui/features/conversation/threads/BranchDivider";
import { TaskAnswerCard } from "@openbot/ui/features/tasks/TaskPanel";
import { useText } from "@openbot/ui/text";
import { createEffect, createProjection, Show } from "solid-js";
import { actionToast } from "../../action-toast";
import { useShowAgentSteps } from "../../agent-steps-preference";
import { toAgentMessages } from "../../app-message-projection";
import { useCompactMessageActions } from "../../compact-message-actions-preference";
import { usePlatform } from "../../platform";
import { deviceQuoteShortcut } from "../../send-shortcut-preference";
import { latestVisibleAgentMessageId } from "./conversation-read-state";
import { useConversationViewScope } from "./conversation-scope";
import type { SideThread } from "./conversation-types";
import { useThreadMcpSignInCard } from "./McpSignInChatCard";
import { createTurnSteps } from "./turn-steps";

/**
 * A side thread in the side panel, beside the agent's own chat. Its message box takes text only:
 * files, and the question and takeover cards of the thread, stay in the chat. A thread that waits
 * for an answer shows a card that moves it to the chat.
 */
export function ConversationSideThread(props: { threadId: string }) {
  const {
    props: view,
    openExternalMessageUrl,
    previewAttachment,
    attachmentAction,
    attachmentDownloads,
    installedSkills,
    installedSkillsLoadFailed,
    mcpServers,
    taggableBrowserTabs,
    taggableThreads,
    openTaggedReference,
    threadComposer,
    threadQueue,
    movePanelThreadToChat,
    copyMessage,
    copiedMessageId,
    branchThread,
  } = useConversationViewScope();
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
  /** Reconciled by id, so a stream chunk redraws only the message that changed. */
  const messages = createProjection<AgentMessage[]>(
    () => {
      // A question that waits shows in the chat tab of the thread, so its message is left out there too.
      const messages = thread()?.conversation?.messages.filter(
        (message) => message.questionPrompt?.resolution !== null,
      );
      return messages ? toAgentMessages(messages, view.agent?.id) : [];
    },
    [],
    { key: "id" },
  );
  const turnSteps = createTurnSteps({
    messages: () => messages,
    lines: () => undefined,
    activeTurnId: () => thread()?.task.activeTurnId,
  });
  const showAgentSteps = useShowAgentSteps();
  const compactMessageActions = useCompactMessageActions();
  const { appFocused } = usePlatform();
  // The person reads the thread in the side panel while the window has focus.
  createEffect(
    () => ({
      messageId: appFocused() ? latestVisibleAgentMessageId(messages) : null,
      read: thread()?.onRead,
    }),
    ({ messageId, read }) => {
      if (messageId && read) read(messageId);
    },
  );
  const draftKey = () => threadComposer.sideDraftKey(props.threadId);
  const rowImages = () => {
    const key = draftKey();
    return key ? threadComposer.rowImages(key) : [];
  };
  const draft = () => {
    const key = draftKey();
    return key ? threadComposer.draft(key) : undefined;
  };
  /** Sends the draft of this thread. Without its key, a send would take the draft of the chat's thread. */
  function sendSide(side: SideThread, text: string): Promise<boolean> {
    const key = draftKey();
    if (!key) return Promise.resolve(false);
    // While a queued message is in the message box, Send saves it in its place.
    return threadQueue.editOf(side.task.id)
      ? threadComposer.importsEnded(key).then(() => threadQueue.save(key))
      : threadComposer.send(side, text, key);
  }
  /** The thread waits for an answer to a question or a takeover, which the chat tab of the thread shows. */
  const waitsForAnswer = () => {
    const status = item()?.status;
    return status?.kind === "waiting" && status.reason !== "approval";
  };
  const answerCard = () =>
    waitsForAnswer() ? (
      <TaskAnswerCard agentName={view.agent?.name ?? ""} onAnswer={() => movePanelThreadToChat(props.threadId)} />
    ) : undefined;
  /** Continue on a sign-in card goes to this thread, as the person's next message there. */
  const mcpSignInCard = useThreadMcpSignInCard((body) => thread()?.onSend(body, [], null) ?? Promise.resolve(false));
  /** Branches this thread through an answer. The branch opens as a chat tab. */
  const branch = () => {
    if (!view.threads?.onBranch) return undefined;
    return (messageId: string) => void branchThread(props.threadId, messageId);
  };
  /** Deletes a message of this thread. A host without `message-delete-v1` has no Delete item. */
  const deleteMessage = () => {
    const remove = view.threads?.onDeleteMessage;
    const taskId = thread()?.task.id;
    if (!remove || !taskId) return undefined;
    return (messageId: string) => remove(taskId, messageId);
  };
  /** Replies to a message of this thread. */
  const reply = () => {
    if (!view.threads?.acceptsReplies) return undefined;
    return (message: AgentMessage) => threadComposer.setReply(draftKey(), message.id);
  };
  const replyTo = () => {
    const id = view.threads?.acceptsReplies ? draft()?.replyToMessageId : null;
    return id ? messages.find((message) => message.id === id) : undefined;
  };
  /** Text selected in this thread goes to this thread, as a reply where the server takes one. */
  const selectionActions = (side: SideThread) => ({
    onSend: (messageId: string, body: string) => side.onSend(body, [], view.threads?.acceptsReplies ? messageId : null),
    quoteShortcut: deviceQuoteShortcut(view.platform),
  });
  /** Where this thread came from, when it is a branch. The agent's own chat shows the agent's name. */
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
      class="browser-panel side-thread-panel"
      aria-label={t("conversation.threads.view.label", { title: item()?.title ?? "" })}
    >
      <Show when={shown()}>
        {(current) => (
          <AgentThreadView
            task={current().thread.task}
            limit={view.threads?.limit ?? 1}
            agent={current().agent}
            agents={view.agents}
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
            pendingImages={threadComposer.pendingImages(draftKey())}
            onRemoveAttachment={(attachment) => threadComposer.removeAttachment(draftKey(), attachment.id)}
            onPasteFiles={(files, selection, text) => threadComposer.pasteFiles(files, selection, draftKey(), text)}
            onDraftChange={(text) => threadComposer.setText(draftKey(), text)}
            onOpenDraftAttachment={(attachment) =>
              canPreviewAttachment(attachment)
                ? void previewAttachment(attachment)
                : attachmentAction(attachment, "open")
            }
            mediaSource={view.runtime?.attachmentMedia}
            downloads={attachmentDownloads}
            onSend={(text) => sendSide(current().thread, text)}
            onStop={() => current().thread.onStop()}
            onOpenLink={(url) => void openExternalMessageUrl(url)}
            onPreview={(attachment) => void previewAttachment(attachment)}
            onAttachmentAction={attachmentAction}
            approval={current().thread.approval}
            onRespondApproval={(decision) =>
              current().thread.onRespondApproval(decision, failureToast("prompt.approval.answerFailed"))
            }
            context={contextUsageView(current().thread.contextState)}
            onCompactContext={current().thread.onCompactContext}
            waitsForAnswer={waitsForAnswer()}
            attention={answerCard()}
            messageCard={mcpSignInCard}
            olderMessages={current().thread.olderMessages}
            stepsAbove={turnSteps.stepsAbove}
            factsAbove={turnSteps.factsAbove}
            activeSteps={turnSteps.activeSteps()}
            stepsOpenByDefault={showAgentSteps()}
            onCopyMessage={(message) => void copyMessage(message)}
            copiedMessageId={copiedMessageId()}
            compactMessageActions={compactMessageActions()}
            onBranch={branch()}
            onDeleteMessage={deleteMessage()}
            canDeleteMessage={view.canDeleteMessage}
            branchSource={branchSource(current().thread, current().agent.name)}
            onReply={reply()}
            replyTo={replyTo()}
            onCancelReply={() => threadComposer.setReply(draftKey(), null)}
            queue={threadQueue.view(current().thread.task, draftKey())}
            selectionActions={selectionActions(current().thread)}
          />
        )}
      </Show>
    </aside>
  );
}
