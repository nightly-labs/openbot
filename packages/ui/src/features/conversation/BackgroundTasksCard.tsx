import type { BackgroundProcess } from "@openbot/contracts/ipc";
import { Badge, Button, Command, ConfirmDialog, Square } from "@openbot/ui";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { useText } from "../../text";
import { useDuration } from "./Subagents";

export interface BackgroundTasksCardProps {
  /** The processes of the agent of this conversation, oldest first. */
  processes: readonly BackgroundProcess[];
  /** Stops one verified process. False means that it was not found; a rejection shows the error. */
  onStop: (process: BackgroundProcess) => Promise<boolean>;
}

/** Ages one row from its start time, on a one-second clock that ends with the row. */
function createElapsed(since: () => number | undefined) {
  const [now, setNow] = createSignal(Date.now());
  createEffect(
    () => since(),
    () => {
      if (since() === undefined) return;
      setNow(Date.now());
      const clock = window.setInterval(() => setNow(Date.now()), 1_000);
      return () => window.clearInterval(clock);
    },
  );
  return createMemo(() => {
    const from = since();
    return from === undefined ? 0 : Math.max(0, now() - from);
  });
}

/**
 * The programs that this conversation's agent left running, above the composer. A row goes away when
 * the process ends; the card does not report success or failure. It renders nothing without a row.
 */
export function BackgroundTasksCard(props: BackgroundTasksCardProps) {
  const { t, errorMessage, format } = useText();
  const duration = useDuration();
  const [target, setTarget] = createSignal<BackgroundProcess>();
  const [stopping, setStopping] = createSignal<string>();
  const [error, setError] = createSignal<string>();

  async function confirmStop(): Promise<void> {
    const process = target();
    if (!process) return;
    setStopping(process.id);
    setError(undefined);
    try {
      const stopped = await props.onStop(process);
      if (!stopped) {
        setError(t("chat.backgroundTasks.notFound"));
        return;
      }
      setTarget(undefined);
    } catch (cause) {
      setError(errorMessage(cause, t("chat.backgroundTasks.stopFailed")));
    } finally {
      setStopping(undefined);
    }
  }

  return (
    <>
      <Show when={props.processes.length > 0}>
        <section class="task-list background-tasks" data-open="" aria-label={t("chat.backgroundTasks.title")}>
          <div class="background-tasks-bar">
            <Command class="background-tasks-icon" aria-hidden="true" />
            <span class="background-tasks-title">{t("chat.backgroundTasks.title")}</span>
            <span class="task-list-count">{props.processes.length}</span>
          </div>
          <ol class="task-list-items">
            <For each={props.processes} keyed={(process) => process.id}>
              {(process, index) => {
                const elapsed = createElapsed(() => process().startedAt);
                return (
                  <li
                    class="task-list-item background-tasks-row"
                    data-state="active"
                    style={{ "--task-list-index": index() }}
                  >
                    <span class="task-list-item-mark background-tasks-mark" aria-hidden="true">
                      <span class="background-tasks-dot" />
                    </span>
                    <span class="background-tasks-body">
                      <code class="background-tasks-command" dir="ltr" title={process().command}>
                        {process().command}
                      </code>
                      <span class="background-tasks-meta">
                        <Show when={!process().verified}>
                          <Badge
                            variant="warning-light"
                            class="background-tasks-unverified"
                            title={t("chat.backgroundTasks.unverifiedHint")}
                          >
                            {t("chat.backgroundTasks.unverified")}
                          </Badge>
                        </Show>
                        <span>{t("chat.backgroundTasks.running")}</span>
                        <span aria-hidden="true">·</span>
                        <span>{t("chat.backgroundTasks.elapsed", { duration: duration(elapsed()) })}</span>
                        <span aria-hidden="true">·</span>
                        <span>{t("chat.backgroundTasks.pid", { pid: String(process().pid) })}</span>
                        <Show when={process().ports.length > 0}>
                          <span aria-hidden="true">·</span>
                          <span>
                            {t("chat.backgroundTasks.ports", {
                              count: process().ports.length,
                              ports: format.list(process().ports.map(String)),
                            })}
                          </span>
                        </Show>
                      </span>
                    </span>
                    <Show when={process().verified}>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        class="background-tasks-stop"
                        disabled={stopping() === process().id}
                        loading={stopping() === process().id}
                        aria-label={t("chat.backgroundTasks.stopLabel", { pid: String(process().pid) })}
                        onClick={() => {
                          setError(undefined);
                          setTarget(process());
                        }}
                      >
                        <Square aria-hidden="true" />
                        {t("chat.backgroundTasks.stop")}
                      </Button>
                    </Show>
                  </li>
                );
              }}
            </For>
          </ol>
        </section>
      </Show>
      <Show when={target()}>
        {(process) => (
          <ConfirmDialog
            open
            initialFocus="cancel"
            title={t("chat.backgroundTasks.confirmTitle")}
            description={t("chat.backgroundTasks.confirmDescription", { pid: String(process().pid) })}
            confirmLabel={t("chat.backgroundTasks.stop")}
            pendingLabel={t("chat.backgroundTasks.stopping")}
            error={error()}
            onCancel={() => {
              setError(undefined);
              setTarget(undefined);
            }}
            onConfirm={confirmStop}
          />
        )}
      </Show>
    </>
  );
}
