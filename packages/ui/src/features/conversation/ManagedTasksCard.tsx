import { createEffect, createSignal, For, Show } from "solid-js";
import { Button } from "../../button";
import { useText } from "../../text";

/** Where a program that an agent started in the background stands. */
export type ManagedTaskStatus = "running" | "finished" | "stopped" | "unknown";

export interface ManagedTaskItem {
  id: string;
  /** What the agent called the task, or the command when it gave no title. */
  title: string;
  command: string;
  status: ManagedTaskStatus;
  /** The exit code of a finished task. A stopped or lost task has none. */
  exitCode: number | null;
  /** The last line the program printed, already shortened for the row. */
  lastLine: string;
  /** When the program started, in milliseconds since the epoch. */
  startedAt: number;
}

export interface ManagedTasksCardProps {
  items: readonly ManagedTaskItem[];
  /** Ids of the tasks whose stop the app is still waiting for. */
  stopping: readonly string[];
  onStop: (id: string) => void;
  /** The clock that ages the running tasks. The default is the system clock. */
  now?: (() => number) | undefined;
}

/** A length the way a person reads it: seconds, then minutes and seconds, then hours. */
export function formatRunTime(milliseconds: number): string {
  const total = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/**
 * The programs that the agent of this conversation runs outside its turns: one row for each task,
 * above the composer. It shows the exit code of a finished task and the last line of its log, and
 * it renders nothing when the agent has no task.
 */
export function ManagedTasksCard(props: ManagedTasksCardProps) {
  const { t } = useText();
  const [tick, setTick] = createSignal(Date.now());
  const clock = () => props.now?.() ?? tick();

  createEffect(
    () => props.items.some((item) => item.status === "running"),
    (running) => {
      if (!running) return;
      setTick(Date.now());
      const clock = window.setInterval(() => setTick(Date.now()), 1_000);
      return () => window.clearInterval(clock);
    },
  );

  const running = () => props.items.filter((item) => item.status === "running").length;
  const status = (item: ManagedTaskItem) => {
    switch (item.status) {
      case "running":
        return t("chat.managedTasks.running", { duration: formatRunTime(clock() - item.startedAt) });
      case "finished":
        return item.exitCode === null
          ? t("chat.managedTasks.unknown")
          : t("chat.managedTasks.finished", { code: item.exitCode });
      case "stopped":
        return t("chat.managedTasks.stopped");
      default:
        return t("chat.managedTasks.unknown");
    }
  };

  return (
    <Show when={props.items.length > 0}>
      <section class="managed-tasks" aria-label={t("chat.managedTasks.title", { count: props.items.length })}>
        <div class="managed-tasks-bar">
          <span class="managed-tasks-title">{t("chat.managedTasks.title", { count: props.items.length })}</span>
          <Show when={running() > 0}>
            <span class="managed-tasks-running">{t("chat.managedTasks.runningCount", { count: running() })}</span>
          </Show>
        </div>
        <ol class="managed-tasks-items">
          <For each={props.items} keyed={(item) => item.id}>
            {(item) => (
              <li class="managed-tasks-row" data-status={item().status}>
                <span class="managed-tasks-dot" aria-hidden="true" />
                <span class="managed-tasks-body">
                  <span class="managed-tasks-command" title={item().command}>
                    {item().title}
                  </span>
                  <span class="managed-tasks-meta">
                    <span class="managed-tasks-status">{status(item())}</span>
                    <Show when={item().lastLine.length > 0}>
                      <span aria-hidden="true">·</span>
                      <span class="managed-tasks-last-line" title={item().lastLine}>
                        {item().lastLine}
                      </span>
                    </Show>
                  </span>
                </span>
                <Show when={item().status === "running"}>
                  <Button
                    variant="ghost"
                    size="xs"
                    class="managed-tasks-stop"
                    disabled={props.stopping.includes(item().id)}
                    onClick={() => props.onStop(item().id)}
                  >
                    {t("chat.managedTasks.stop")}
                  </Button>
                </Show>
              </li>
            )}
          </For>
        </ol>
      </section>
    </Show>
  );
}
