import type { ChannelMember, ChannelTask } from "@openbot/contracts/ipc";
import { Button, buttonVariants, DropdownMenu } from "@openbot/ui";
import { For, Show } from "solid-js";
import { useText } from "../../text";

export function ChannelStoppedTasks(props: {
  tasks: Pick<ChannelTask, "id" | "ownerAgentId" | "error">[];
  members: Pick<ChannelMember, "agentId">[];
  name: (agentId: string | null) => string;
  onResume: (taskId: string, recipientAgentId: string | null) => Promise<boolean>;
}) {
  const { t, sourceText } = useText();
  return (
    <Show when={props.tasks.length}>
      <div class="channel-paused-tasks">
        <For each={props.tasks}>
          {(task) => (
            <section
              class="channel-paused-task"
              aria-label={t("channel.stoppedTask.label", { name: props.name(task.ownerAgentId) })}
            >
              <p class="channel-paused-task-reason">{task.error ? sourceText(task.error) : null}</p>
              <div class="channel-paused-task-actions">
                <Button size="xs" onClick={() => void props.onResume(task.id, null)}>
                  {t("common.continue")}
                </Button>
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
              </div>
            </section>
          )}
        </For>
      </div>
    </Show>
  );
}
