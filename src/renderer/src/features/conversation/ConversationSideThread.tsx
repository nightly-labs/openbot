import { canPreviewAttachment } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import { classifyFailure } from "@openbot/telemetry";
import type { AgentMessage } from "@openbot/ui/data";
import { contextUsageView } from "@openbot/ui/features/conversation/ContextUsage";
import { AgentThreadView } from "@openbot/ui/features/conversation/threads/AgentThreadView";
import { TaskAnswerCard } from "@openbot/ui/features/tasks/TaskPanel";
import { useText } from "@openbot/ui/text";
import { createEffect, createProjection, Show } from "solid-js";
import { actionToast } from "../../action-toast";
import { useShowAgentSteps } from "../../agent-steps-preference";
import { toAgentMessages } from "../../app-message-projection";
import { usePlatform } from "../../platform";
import { latestVisibleAgentMessageId } from "./conversation-read-state";
import { useConversationViewScope } from "./conversation-scope";
import type { SideThread } from "./conversation-types";
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
    installedSkills,
    installedSkillsLoadFailed,
    mcpServers,
    threadComposer,
    movePanelThreadToChat,
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
  const draft = () => {
    const key = draftKey();
    return key ? threadComposer.draft(key) : undefined;
  };
  /** Sends the draft of this thread. Without its key, a send would take the draft of the chat's thread. */
  function sendSide(side: SideThread, text: string): Promise<boolean> {
    const key = draftKey();
    return key ? threadComposer.send(side, text, key) : Promise.resolve(false);
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
            draft={draft()?.text ?? ""}
            draftAttachments={draft()?.attachments}
            onDraftChange={(text) => threadComposer.setText(draftKey(), text)}
            onOpenDraftAttachment={(attachment) =>
              canPreviewAttachment(attachment)
                ? void previewAttachment(attachment)
                : attachmentAction(attachment, "open")
            }
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
            stepsAbove={turnSteps.stepsAbove}
            factsAbove={turnSteps.factsAbove}
            activeSteps={turnSteps.activeSteps()}
            stepsOpenByDefault={showAgentSteps()}
          />
        )}
      </Show>
    </aside>
  );
}
