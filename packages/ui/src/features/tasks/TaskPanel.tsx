import type { AgentTask } from "@openbot/contracts/ipc";
import { isAgentTaskActive } from "@openbot/team-client/agent-tasks";
import { Archive, ArchiveRestore, Badge, Button, MessageSquare, X } from "@openbot/ui";
import { AgentTaskMark, type AgentTaskWait } from "@openbot/ui/features/conversation/AgentTasks";
import { useText } from "@openbot/ui/text";
import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";

interface TaskPanelProps {
  /** Null for a start that waits for its Undo time. */
  task: AgentTask | null;
  /** The title of a start that waits. */
  title: string;
  wait?: AgentTaskWait;
  onArchive: () => void;
  onRestore: () => void;
  /** Opens the task as a thread tab in the agent's chat. Absent where the client cannot. */
  onOpenInChat?: (() => void) | undefined;
  onClose: () => void;
  /** The thread view of the task. */
  children: JSX.Element;
}

/**
 * One task beside the list of the Tasks page: its state and title, the actions of a thread tab, and
 * the thread view. A running task is archived after it stops, as in the thread tabs.
 */
export function TaskPanel(props: TaskPanelProps) {
  const { t } = useText();
  const title = () => props.task?.title ?? props.title;
  return (
    <aside class="browser-panel tasks-panel" aria-label={t("conversation.tasks.panel.label", { title: title() })}>
      <header class="file-preview-header">
        <Show when={props.task}>{(task) => <AgentTaskMark task={task()} wait={props.wait} />}</Show>
        <h2 title={title()}>{title()}</h2>
        <Show when={props.task}>
          {(task) => (
            <>
              <Show
                when={task().state === "closed"}
                fallback={
                  <Button
                    type="button"
                    variant="ghost"
                    class="browser-toolbar-button"
                    aria-label={t("conversation.threads.archive")}
                    title={t("conversation.threads.archive")}
                    disabled={isAgentTaskActive(task())}
                    onClick={() => props.onArchive()}
                  >
                    <Archive class="browser-toolbar-icon" aria-hidden="true" />
                  </Button>
                }
              >
                <Button
                  type="button"
                  variant="ghost"
                  class="browser-toolbar-button"
                  aria-label={t("conversation.threads.restore")}
                  title={t("conversation.threads.restore")}
                  onClick={() => props.onRestore()}
                >
                  <ArchiveRestore class="browser-toolbar-icon" aria-hidden="true" />
                </Button>
              </Show>
              <Show when={props.onOpenInChat}>
                {(open) => (
                  <Button
                    type="button"
                    variant="ghost"
                    class="browser-toolbar-button"
                    aria-label={t("conversation.tasks.panel.openInChat")}
                    title={t("conversation.tasks.panel.openInChat")}
                    onClick={() => open()()}
                  >
                    <MessageSquare class="browser-toolbar-icon" aria-hidden="true" />
                  </Button>
                )}
              </Show>
            </>
          )}
        </Show>
        <Button
          type="button"
          variant="ghost"
          class="browser-toolbar-button side-panel-pane-close"
          aria-label={t("conversation.tasks.panel.closePanel")}
          title={t("conversation.tasks.panel.closePanel")}
          onClick={() => props.onClose()}
        >
          <X class="browser-toolbar-icon" aria-hidden="true" />
        </Button>
      </header>
      {props.children}
    </aside>
  );
}

/**
 * The card of a task whose turn waits for a question or a browser takeover. The chat answers them,
 * so the card opens the task there.
 */
export function TaskAnswerCard(props: { agentName: string; onAnswer?: (() => void) | undefined }) {
  const { t } = useText();
  return (
    <section class="conversation-interaction-card tasks-panel-answer">
      <header class="conversation-interaction-header">
        <strong>{t("conversation.tasks.panel.answerTitle", { name: props.agentName })}</strong>
        <Badge variant="warning-light" class="conversation-interaction-status">
          {t("conversation.tasks.state.waitingAnswer")}
        </Badge>
      </header>
      <Show when={props.onAnswer}>
        {(answer) => (
          <footer class="tasks-panel-answer-footer">
            <Button type="button" variant="default" onClick={() => answer()()}>
              {t("conversation.tasks.panel.answerInChat")}
            </Button>
          </footer>
        )}
      </Show>
    </section>
  );
}
