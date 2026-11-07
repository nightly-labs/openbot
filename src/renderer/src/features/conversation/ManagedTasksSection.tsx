import type { BackgroundTask } from "@openbot/contracts/ipc";
import { type ManagedTaskItem, ManagedTasksCard } from "@openbot/ui/features/conversation/ManagedTasksCard";
import { useText } from "@openbot/ui/text";
import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import { actionToast } from "../../action-toast";

/** The pause between two reads of the task list: faster while a task runs, slower when none does. */
const RUNNING_POLL_MS = 1000;
const IDLE_POLL_MS = 5000;

/**
 * Keeps the background tasks of one agent in step with main and shows them above the composer.
 * The list is read through the same port as settings, and it stops polling while the window is
 * hidden so a backgrounded app does not wake main every second.
 */
export function ManagedTasksSection(props: { agentId: string }) {
  const { t, errorMessage } = useText();
  const [tasks, setTasks] = createSignal<BackgroundTask[]>([]);
  const [stopping, setStopping] = createSignal<string[]>([]);

  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let cancelled = false;

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const schedule = () => {
    clearTimer();
    if (cancelled || document.visibilityState !== "visible") return;
    const running = tasks().some((task) => task.status === "running");
    timer = setTimeout(
      () => {
        timer = null;
        void load();
      },
      running ? RUNNING_POLL_MS : IDLE_POLL_MS,
    );
  };

  async function load(): Promise<void> {
    const current = ++generation;
    try {
      const next = await window.openbot.backgroundTasks.list(props.agentId);
      if (current !== generation || cancelled) return;
      setTasks(next.filter((task) => task.agentId === props.agentId));
    } catch {
      if (current !== generation || cancelled) return;
      // A failed read leaves the last list in place; the next poll retries.
    }
    schedule();
  }

  const onVisibility = () => {
    if (document.visibilityState === "visible") {
      void load();
    } else {
      clearTimer();
    }
  };

  createEffect(
    () => props.agentId,
    () => {
      generation++;
      setTasks([]);
      clearTimer();
      void load();
    },
  );

  document.addEventListener("visibilitychange", onVisibility);
  onCleanup(() => {
    cancelled = true;
    clearTimer();
    generation++;
    document.removeEventListener("visibilitychange", onVisibility);
  });

  const stop = (id: string) => {
    setStopping((current) => [...current, id]);
    window.openbot.backgroundTasks
      .stop(id)
      .catch((error: unknown) => {
        actionToast.error(errorMessage(error, t("chat.managedTasks.stopFailed")), {
          id: "managed-task-stop-failed",
          report: { operation: "turn", source: "action", cause_code: "unknown" },
        });
      })
      .finally(() => {
        setStopping((current) => current.filter((entry) => entry !== id));
        void load();
      });
  };

  const items = (): ManagedTaskItem[] =>
    tasks().map((task) => ({
      id: task.id,
      title: task.title.length > 0 ? task.title : task.command,
      command: task.command,
      status: task.status,
      exitCode: task.exitCode,
      lastLine: task.lastLine,
      startedAt: task.startedAt,
    }));

  return (
    <Show when={tasks().length > 0}>
      <ManagedTasksCard items={items()} stopping={stopping()} onStop={stop} />
    </Show>
  );
}
