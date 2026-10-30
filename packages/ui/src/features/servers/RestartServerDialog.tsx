import type { ServerSummary } from "@openbot/contracts/ipc";
import { ConfirmDialog, Spinner, toast } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createEffect, createSignal, For, onCleanup, Show, untrack } from "solid-js";
import { CircleCheck, CircleDot, RotateCcw, TriangleAlert } from "../../icons";
import { useText } from "../../text";

type RestartServer = Pick<ServerSummary, "id" | "name" | "state" | "hostedIssue">;
type RestartPhase = "confirm" | "stopping" | "starting" | "online" | "failed";
type StepStatus = "done" | "active" | "failed" | "pending";

const STEPS = [
  { label: "server.settings.restartStepStop", detail: "server.settings.restartStepStopDetail" },
  { label: "server.settings.restartStepStart", detail: "server.settings.restartStepStartDetail" },
] as const;

/**
 * The end of a restart that no client waits for, such as a server that the web client did not open. The
 * client that waits sets a hosted issue much sooner. A hosted machine restored its disk in 18 minutes.
 */
const RESTART_LIMIT_SECONDS = 30 * 60;

/**
 * Asks before the owner or an admin restarts a hosted server, then shows the restart until the server
 * is online again or does not start. A failed request stays in the dialog. The user can hide the dialog
 * while the server restarts; a toast then reports the result.
 */
export function RestartServerDialog(props: {
  /** The server to restart. Null closes the dialog. */
  server: RestartServer | null;
  /** The current servers. A hidden restart follows its server here after `server` is null. */
  servers: readonly RestartServer[];
  onClose: () => void;
  onRestart: () => Promise<void>;
  /** The element that opened the dialog. A menu item is gone when the dialog closes. */
  restoreFocusTarget?: HTMLElement | null | undefined;
}) {
  const { t, errorMessage } = useText();
  const [phase, setPhase] = createSignal<RestartPhase>("confirm");
  const [error, setError] = createSignal<string | null>(null);
  const [elapsed, setElapsed] = createSignal(0);
  const [restartId, setRestartId] = createSignal<string | null>(null);
  /** The current restart. A result of an earlier restart that the dialog no longer follows is ignored. */
  let run = 0;
  let requestDone = false;
  let wentDown = false;
  let lastIssue: RestartServer["hostedIssue"] = null;
  let clock: ReturnType<typeof setInterval> | undefined;
  let primaryButton: HTMLButtonElement | undefined;

  const restarting = () => phase() === "stopping" || phase() === "starting";
  const restartServer = () => props.servers.find((server) => server.id === restartId()) ?? null;
  const name = () => props.server?.name ?? restartServer()?.name ?? "";
  const toastId = () => `restart-server-${restartId() ?? ""}`;

  function stopClock(): void {
    if (clock !== undefined) clearInterval(clock);
    clock = undefined;
  }
  onCleanup(stopClock);

  function reset(): void {
    run += 1;
    stopClock();
    setRestartId(null);
    setPhase("confirm");
    setError(null);
    setElapsed(0);
  }

  // A new request opens the confirmation. A request for the server that restarts shows its progress.
  // The effect also runs when a new summary of the same server arrives; that is not a new request, and
  // must not reset a finished restart to the confirmation.
  createEffect(
    () => props.server?.id ?? null,
    (id, previous) => {
      if (id === null || id === previous) return;
      untrack(() => {
        if (!restarting()) return reset();
        if (id === restartId()) {
          // The dialog shows the restart again, so the toast from Hide closes.
          toast.dismiss(toastId());
          return;
        }
        // The dialog follows one restart. The hidden restart of the other server keeps a toast
        // that does not wait for the result.
        toast.info(t("server.settings.restartedTitle", { name: restartServer()?.name ?? "" }), {
          id: toastId(),
          description: t("server.settings.restartHiddenDescription"),
        });
        reset();
      });
    },
  );

  function finish(result: "online" | "failed"): void {
    stopClock();
    setPhase(result);
    if (props.server) {
      queueMicrotask(() => primaryButton?.focus({ preventScroll: true }));
      return;
    }
    // The dialog is hidden, so the toast that it opened reports the result.
    const title =
      result === "online"
        ? t("server.settings.restartDoneTitle", { name: name() })
        : t("server.settings.restartFailedTitle", { name: name() });
    if (result === "online") toast.success(title, { id: toastId(), description: undefined });
    else toast.error(title, { id: toastId(), description: failedDescription() });
    reset();
  }

  /**
   * The server goes offline when it stops, and comes back online when it starts again. The client that
   * waits for the start sets a hosted issue when the start fails or takes too long. A server on this
   * computer goes offline and comes back before its request returns.
   */
  function follow(server: Pick<RestartServer, "state" | "hostedIssue"> | null): void {
    if (!restarting() || !server) return;
    // An incompatible server runs; only its version differs from this app.
    const down = server.state !== "online" && server.state !== "incompatible";
    if (down) wentDown = true;
    if (!requestDone) return;
    const issue = server.hostedIssue ?? null;
    if (issue !== null && issue !== lastIssue) {
      finish("failed");
      return;
    }
    lastIssue = issue;
    if (down) {
      if (phase() === "stopping") setPhase("starting");
    } else if (wentDown) finish("online");
  }

  createEffect(
    () => {
      const server = restartServer();
      return server ? { state: server.state, hostedIssue: server.hostedIssue ?? null } : null;
    },
    (server) => untrack(() => follow(server)),
  );

  async function restart(): Promise<void> {
    const server = props.server;
    if (!server || restarting()) return;
    stopClock();
    requestDone = false;
    wentDown = false;
    setRestartId(server.id);
    setError(null);
    setElapsed(0);
    setPhase("stopping");
    const current = ++run;
    let seconds = 0;
    clock = setInterval(() => {
      seconds += 1;
      setElapsed(seconds);
      if (seconds >= RESTART_LIMIT_SECONDS) finish("failed");
    }, 1000);
    try {
      await props.onRestart();
    } catch (failure) {
      if (current !== run || !restarting()) return;
      const message = errorMessage(failure, t("server.settings.actionFailed"));
      if (!props.server) {
        toast.error(t("server.settings.restartFailedTitle", { name: name() }), { id: toastId(), description: message });
        reset();
        return;
      }
      stopClock();
      setPhase("confirm");
      setError(message);
      return;
    }
    if (current !== run || !restarting()) return;
    requestDone = true;
    // An issue from before the restart is not its result. A new issue, or the same issue after it
    // cleared, is.
    lastIssue = restartServer()?.hostedIssue ?? null;
    follow(restartServer());
  }

  function close(): void {
    if (restarting()) {
      toast.loading(t("server.settings.restartedTitle", { name: name() }), {
        id: toastId(),
        description: t("server.settings.restartHiddenDescription"),
      });
    } else reset();
    props.onClose();
  }

  const failedDescription = () =>
    restartServer()?.hostedIssue === "plan_ended"
      ? t("server.connection.planEnded", { name: name() })
      : t("server.settings.restartFailedDescription");

  const title = () => {
    switch (phase()) {
      case "confirm":
        return t("server.settings.restartConfirmTitle", { name: name() });
      case "online":
        return t("server.settings.restartDoneTitle", { name: name() });
      case "failed":
        return t("server.settings.restartFailedTitle", { name: name() });
      default:
        return t("server.settings.restartProgressTitle", { name: name() });
    }
  };
  const description = () => {
    switch (phase()) {
      case "confirm":
        return t("server.settings.restartConfirmDescription");
      case "online":
        return t("server.settings.restartDoneDescription", { time: formatElapsed(elapsed()) });
      case "failed":
        return failedDescription();
      default:
        return t("server.settings.restartProgressDescription", { time: formatElapsed(elapsed()) });
    }
  };
  const stepStatus = (index: number): StepStatus => {
    switch (phase()) {
      case "online":
        return "done";
      case "failed":
        return index === 0 ? "done" : "failed";
      case "stopping":
        return index === 0 ? "active" : "pending";
      default:
        return index === 0 ? "done" : "active";
    }
  };
  const secondaryLabel = () => (phase() === "confirm" ? t("common.cancel") : t("common.close"));
  const primaryLabel = () => {
    if (phase() === "online") return t("common.done");
    if (phase() === "failed") return t("common.tryAgain");
    return t("server.settings.restartTitle");
  };

  // One list for all phases, so that the body does not render it again on each read.
  const steps = (
    <ol class="restart-server-steps" aria-label={t("server.settings.restartSteps")}>
      <For each={STEPS}>
        {(step, index) => (
          <li
            class="restart-server-step"
            data-status={stepStatus(index())}
            aria-current={stepStatus(index()) === "active" ? "step" : undefined}
          >
            <span class="restart-server-step-icon" aria-hidden="true">
              <StepIcon status={stepStatus(index())} />
            </span>
            <span class="restart-server-step-text">
              <span class="restart-server-step-label">{t(step.label)}</span>
              <span class="restart-server-step-detail">{t(step.detail)}</span>
            </span>
          </li>
        )}
      </For>
    </ol>
  );

  return (
    <ConfirmDialog
      open={props.server !== null}
      tone="default"
      icon={phase() === "failed" ? <TriangleAlert /> : <RotateCcw />}
      initialFocus={restarting() || phase() === "confirm" ? "cancel" : "confirm"}
      restoreFocusTarget={props.restoreFocusTarget}
      title={title()}
      description={description()}
      confirmLabel={primaryLabel()}
      pendingLabel={t("server.settings.restarting")}
      cancelLabel={restarting() ? t("server.settings.restartHide") : secondaryLabel()}
      pending={restarting()}
      dismissWhilePending
      hideCancel={phase() === "online"}
      error={error() ?? undefined}
      confirmRef={(element) => {
        primaryButton = element;
      }}
      onCancel={close}
      onConfirm={() => {
        if (phase() === "online") close();
        else void restart();
      }}
    >
      {phase() === "confirm" ? undefined : steps}
    </ConfirmDialog>
  );
}

function StepIcon(props: { status: StepStatus }): JSX.Element {
  return (
    <Show when={props.status !== "active"} fallback={<Spinner />}>
      <Show when={props.status !== "done"} fallback={<CircleCheck />}>
        <Show when={props.status === "failed"} fallback={<CircleDot />}>
          <TriangleAlert />
        </Show>
      </Show>
    </Show>
  );
}

function formatElapsed(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
