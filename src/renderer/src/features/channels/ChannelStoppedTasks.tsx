import type { ChannelMember, ChannelTask } from "@openbot/contracts/ipc";
import { For, Show } from "solid-js";
import { Button, buttonVariants, DropdownMenu } from "../../components/ui";

export function ChannelStoppedTasks(props: {
  tasks: Pick<ChannelTask, "id" | "ownerAgentId" | "error">[];
  members: Pick<ChannelMember, "agentId">[];
  name: (agentId: string | null) => string;
  onResume: (taskId: string, recipientAgentId: string | null) => Promise<boolean>;
}) {
  return (
    <Show when={props.tasks.length}>
      <div class="channel-paused-tasks">
        <For each={props.tasks}>
          {(task) => (
            <section class="channel-paused-task" aria-label={`Stopped task for ${props.name(task.ownerAgentId)}`}>
              <p class="channel-paused-task-reason">{task.error}</p>
              <div class="channel-paused-task-actions">
                <Button size="xs" onClick={() => void props.onResume(task.id, null)}>
                  Continue
                </Button>
                <DropdownMenu.Root placement="top-start">
                  <DropdownMenu.Trigger
                    class={buttonVariants({ variant: "ghost", size: "xs" })}
                    aria-label={`Reassign the stopped task of ${props.name(task.ownerAgentId)}`}
                  >
                    Reassign
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
