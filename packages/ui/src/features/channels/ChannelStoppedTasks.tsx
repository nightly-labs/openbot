import { CHANNEL_ASSIGNMENT_LIMIT_ERROR, type ChannelMember, type ChannelTask } from "@openbot/contracts/ipc";
import { markdownPreviewText } from "@openbot/contracts/markdown-preview-text";
import { Button, buttonVariants, DropdownMenu } from "@openbot/ui";
import { For, Show } from "solid-js";
import { useText } from "../../text";

type StoppedTask = Pick<ChannelTask, "id" | "ownerAgentId" | "error"> &
  Partial<Pick<ChannelTask, "instruction">> & {
    /** The owners of the tasks of the run, which the assignment limit names. */
    runAgentIds?: readonly string[];
  };

export function ChannelStoppedTasks(props: {
  /** A task with no `instruction` (an older story or caller) shows only its reason. */
  tasks: StoppedTask[];
  members: Pick<ChannelMember, "agentId">[];
  name: (agentId: string | null) => string;
  onResume: (taskId: string, recipientAgentId: string | null) => Promise<boolean>;
  /** Ends the task and its run. A host without `channel-task-cancel-v1` gives none, and the card shows no Cancel. */
  onCancel?: ((taskId: string) => Promise<boolean>) | undefined;
}) {
  const { t, format, sourceText } = useText();
  // The host sends the limit as a rule ("Continue or reassign"), which tells the reader nothing that the
  // buttons do not. The card says what happened instead: the members passed the work around.
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
        <For each={props.tasks}>
          {(task) => (
            <section
              class="channel-paused-task"
              aria-label={t("channel.stoppedTask.label", { name: props.name(task.ownerAgentId) })}
            >
              {/* The owner and the request tell the cards apart: the reason is often the same for each
                  stopped task (#5413). */}
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
                {/* `resume` keeps the owner, and the service stops the task again when the owner left
                    the channel, so only Reassign can start it. */}
                <Show when={!task.ownerAgentId || props.members.some((member) => member.agentId === task.ownerAgentId)}>
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
    </Show>
  );
}
