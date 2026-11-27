import type { AgentTask } from "@openbot/contracts/ipc";
import { isAgentTaskActive } from "@openbot/team-client/agent-tasks";
import { Archive, ArchiveRestore, Button, MessageSquare, X } from "@openbot/ui";
import { AgentTaskMark, type AgentTaskWait } from "@openbot/ui/features/conversation/AgentTasks";
import { UiBlockCard } from "@openbot/ui/features/conversation/ui-blocks/UiBlockCard";
import { useText } from "@openbot/ui/text";
import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";

interface TaskPanelProps {
  task: AgentTask | null;
  title: string;
  wait?: AgentTaskWait;
  onArchive: () => void;
  onRestore: () => void;
  onOpenInChat?: (() => void) | undefined;
  onClose: () => void;
  children: JSX.Element;
}

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

export function TaskAnswerCard(props: { agentName: string; onAnswer?: (() => void) | undefined }) {
  const { t } = useText();
  return (
    <UiBlockCard
      class="tasks-panel-answer"
      status="pending"
      title={t("conversation.tasks.panel.answerTitle", { name: props.agentName })}
      waiting
      waitingLabel={t("conversation.tasks.state.waitingAnswer")}
      actions={
        <Show when={props.onAnswer}>
          {(answer) => (
            <Button type="button" size="sm" onClick={() => answer()()}>
              {t("conversation.tasks.panel.answerInChat")}
            </Button>
          )}
        </Show>
      }
    />
  );
}
