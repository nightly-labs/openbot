import type { ChannelMember, ChannelTask } from "@openbot/contracts/ipc";
import { Button, buttonVariants, DropdownMenu } from "@openbot/ui";
import { For, Show } from "solid-js";
import { useText } from "../../text";

export function ChannelStoppedTasks(props: {
  tasks: (Pick<ChannelTask, "id" | "ownerAgentId" | "error"> & Partial<Pick<ChannelTask, "state" | "instruction">>)[];
  members: Pick<ChannelMember, "agentId">[];
  name: (agentId: string | null) => string;
  onStop?: (taskId: string) => Promise<boolean>;
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
              aria-label={t(
                task.state === "queued" || task.state === "running" || task.state === "waiting"
                  ? "channel.task.label"
                  : "channel.stoppedTask.label",
                { name: props.name(task.ownerAgentId) },
              )}
            >
              <p>
                {props.name(task.ownerAgentId)} —{" "}
                {t(
                  task.state === "queued"
                    ? "channel.task.queued"
                    : task.state === "running"
                      ? "channel.task.running"
                      : task.state === "waiting"
                        ? "channel.task.waiting"
                        : task.state === "failed"
                          ? "channel.task.failed"
                          : "channel.task.paused",
                )}
              </p>
              <Show when={task.instruction}>
                <p>{task.instruction}</p>
              </Show>
              <p class="channel-paused-task-reason">{task.error ? sourceText(task.error) : null}</p>
              <div class="channel-paused-task-actions">
                <Show
                  when={task.state === "queued" || task.state === "running" || task.state === "waiting"}
                  fallback={
                    <>
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
                    </>
                  }
                >
                  <Button size="xs" onClick={() => void props.onStop?.(task.id)}>
                    {t("channel.task.stop")}
                  </Button>
                </Show>
              </div>
            </section>
          )}
        </For>
      </div>
    </Show>
  );
}
