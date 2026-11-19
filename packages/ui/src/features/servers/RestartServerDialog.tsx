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

const RESTART_LIMIT_SECONDS = 30 * 60;

export function RestartServerDialog(props: {
  server: RestartServer | null;
  servers: readonly RestartServer[];
  onClose: () => void;
  onRestart: () => Promise<void>;
  restoreFocusTarget?: HTMLElement | null | undefined;
}) {
  const { t, errorMessage } = useText();
  const [phase, setPhase] = createSignal<RestartPhase>("confirm");
  const [error, setError] = createSignal<string | null>(null);
  const [elapsed, setElapsed] = createSignal(0);
  const [restartId, setRestartId] = createSignal<string | null>(null);
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

  createEffect(
    () => props.server?.id ?? null,
    (id, previous) => {
      if (id === null || id === previous) return;
      untrack(() => {
        if (!restarting()) return reset();
        if (id === restartId()) {
          toast.dismiss(toastId());
          return;
        }
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
    const title =
      result === "online"
        ? t("server.settings.restartDoneTitle", { name: name() })
        : t("server.settings.restartFailedTitle", { name: name() });
    if (result === "online") toast.success(title, { id: toastId(), description: undefined });
    else toast.error(title, { id: toastId(), description: failedDescription() });
    reset();
  }

  function follow(server: Pick<RestartServer, "state" | "hostedIssue"> | null): void {
    if (!restarting() || !server) return;
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
