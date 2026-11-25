import { CHANNEL_ASSIGNMENT_LIMIT_ERROR, type ChannelMember, type ChannelTask } from "@openbot/contracts/ipc";
import { markdownPreviewText } from "@openbot/contracts/markdown-preview-text";
import { Button, buttonVariants, DropdownMenu } from "@openbot/ui";
import { createEffect, For, onCleanup, Show } from "solid-js";
import { createScrollFades } from "../../components/createScrollFades";
import { ScrollEdgeBlur } from "../../components/ScrollEdgeBlur";
import { useText } from "../../text";

type StoppedTask = Pick<ChannelTask, "id" | "ownerAgentId" | "error"> &
  Partial<Pick<ChannelTask, "instruction">> & {
    runAgentIds?: readonly string[];
  };

export function ChannelStoppedTasks(props: {
  tasks: StoppedTask[];
  members: Pick<ChannelMember, "agentId">[];
  name: (agentId: string | null) => string;
  onResume: (taskId: string, recipientAgentId: string | null) => Promise<boolean>;
  onCancel?: ((taskId: string) => Promise<boolean>) | undefined;
}) {
  const { t, format, sourceText } = useText();
  const fades = createScrollFades();
  onCleanup(() => fades.stop());
  createEffect(
    () => props.tasks,
    () => fades.remeasure(),
  );
  const reason = (task: StoppedTask) => {
    if (task.error !== CHANNEL_ASSIGNMENT_LIMIT_ERROR) return task.error ? sourceText(task.error) : null;
    const names = (task.runAgentIds ?? []).map((agentId) => props.name(agentId));
    return names.length > 1
      ? t("channel.stoppedTask.assignmentLoop", { names: format.list(names) })
      : t("channel.stoppedTask.assignmentLoopMembers");
  };
  return (
    <Show when={props.tasks.length}>
      <div class="channel-paused-tasks">
        <div
          ref={(element) => fades.bind(element)}
          class={["channel-paused-tasks-list", fades.classes()]}
          onScroll={fades.measure}
        >
          <For each={props.tasks}>
            {(task) => (
              <section
                class="channel-paused-task"
                aria-label={t("channel.stoppedTask.label", { name: props.name(task.ownerAgentId) })}
              >
                <div class="channel-paused-task-text">
                  <Show when={task.instruction && markdownPreviewText(task.instruction)}>
                    {(subject) => (
                      <p class="channel-paused-task-subject" title={subject()}>
                        <strong>{props.name(task.ownerAgentId)}</strong> {subject()}
                      </p>
                    )}
                  </Show>
                  <p class="channel-paused-task-reason">{reason(task)}</p>
                </div>
                <div class="channel-paused-task-actions">
                  <Show
                    when={!task.ownerAgentId || props.members.some((member) => member.agentId === task.ownerAgentId)}
                  >
                    <Button size="xs" onClick={() => void props.onResume(task.id, null)}>
                      {t("common.continue")}
                    </Button>
                  </Show>
                  <DropdownMenu.Root placement="top-start">
                    <DropdownMenu.Trigger
                      class={buttonVariants({ variant: "ghost", size: "xs" })}
                      aria-label={t("channel.stoppedTask.reassignLabel", { name: props.name(task.ownerAgentId) })}
                    >
                      {t("channel.stoppedTask.reassign")}
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Portal>
                      <DropdownMenu.Content>
                        <For each={props.members.filter((member) => member.agentId !== task.ownerAgentId)}>
                          {(member) => (
                            <DropdownMenu.Item onSelect={() => void props.onResume(task.id, member.agentId)}>
                              {props.name(member.agentId)}
                            </DropdownMenu.Item>
                          )}
                        </For>
                      </DropdownMenu.Content>
                    </DropdownMenu.Portal>
                  </DropdownMenu.Root>
                  <Show when={props.onCancel}>
                    {(cancel) => (
                      <Button variant="ghost" size="xs" onClick={() => void cancel()(task.id)}>
                        {t("channel.stoppedTask.cancel")}
                      </Button>
                    )}
                  </Show>
                </div>
              </section>
            )}
          </For>
        </div>
        <ScrollEdgeBlur fades={fades} />
      </div>
    </Show>
  );
}
