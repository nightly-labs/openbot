import type { UpdateRestartMode } from "@openbot/contracts/ipc";
import { Button, ConfirmDialog, Progress, Spinner, SwitchField } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createEffect, createSignal, For, Show } from "solid-js";
import { CircleCheck, CircleDot, RotateCcw, TriangleAlert } from "../../icons";
import { useText } from "../../text";
import { restartReasonKey } from "../updates/restart-reasons";

export type ServerUpdateStage = "offer" | "downloading" | "waiting" | "restarting" | "online" | "failed";
export type ServerUpdateFailure = "download" | "install" | "restart" | "version";
export type ServerUpdateDownload = "pending" | "running" | "done" | "failed";
export type ServerUpdateBusy = "start" | "now" | "cancel";

export interface ServerUpdateView {
  name: string;
  currentVersion: string;
  version: string;
  stage: ServerUpdateStage;
  download: ServerUpdateDownload;
  progress: number | null;
  restartMode: UpdateRestartMode | null;
  waitingFor: readonly string[];
  failure: ServerUpdateFailure | null;
  elapsedSeconds: number;
}

type StepStatus = "done" | "active" | "failed" | "pending";

export function ServerUpdateDialog(props: {
  update: ServerUpdateView | null;
  canManage: boolean;
  busy: ServerUpdateBusy | null;
  error: string | null;
  onStart: (mode: UpdateRestartMode) => void;
  onRestartNow: () => void;
  onCancelRestart: () => void;
  onHide: () => void;
  onDone: () => void;
}) {
  const { t, format } = useText();
  const [whenIdle, setWhenIdle] = createSignal(true);
  let primaryButton: HTMLButtonElement | undefined;

  const view = () => props.update;
  const stage = () => view()?.stage ?? "offer";
  const name = () => view()?.name ?? "";
  const version = () => view()?.version ?? "";
  const running = () => stage() === "downloading" || stage() === "waiting" || stage() === "restarting";
  const mode = (): UpdateRestartMode => (props.canManage && !whenIdle() ? "now" : "when-idle");
  const retry = () => view()?.failure === "download" || view()?.failure === "version";
  const elapsed = () => formatElapsed(view()?.elapsedSeconds ?? 0);
  const progressText = () => {
    const progress = view()?.progress;
    return progress === null || progress === undefined ? null : format.percent(progress / 100);
  };

  createEffect(
    () => props.update === null,
    (closed) => {
      if (closed) setWhenIdle(true);
    },
  );
  createEffect(
    () => stage() === "online" || stage() === "failed",
    (finished) => {
      if (finished) queueMicrotask(() => primaryButton?.focus({ preventScroll: true }));
    },
  );

  const title = () => {
    switch (stage()) {
      case "offer":
        return t("server.update.dialog.offerTitle", { name: name(), version: version() });
      case "online":
        return t("server.update.dialog.doneTitle", { name: name(), version: version() });
      case "failed":
        return t("server.update.dialog.failedTitle", { name: name() });
      default:
        return t("server.update.dialog.progressTitle", { name: name() });
    }
  };
  const description = () => {
    const current = view();
    switch (stage()) {
      case "offer":
        return current?.download === "done"
          ? t("server.update.dialog.offerReadyDescription", { name: name(), current: current.currentVersion })
          : t("server.update.dialog.offerDescription", { name: name(), current: current?.currentVersion ?? "" });
      case "online":
        return t("server.update.dialog.doneDescription", { time: elapsed() });
      case "failed":
        switch (current?.failure) {
          case "download":
            return t("server.update.status.downloadFailed", { name: name() });
          case "install":
            return t("server.update.status.installFailed", { name: name() });
          case "version":
            return t("server.update.dialog.notInstalled", { name: name(), current: current.currentVersion });
          default:
            return t("server.update.dialog.restartFailed", { name: name() });
        }
      default:
        return t("server.update.dialog.progressDescription", { time: elapsed() });
    }
  };
  const confirmLabel = () => {
    if (stage() === "online") return t("common.done");
    if (stage() === "failed") return retry() ? t("common.tryAgain") : t("common.close");
    const downloaded = view()?.download === "done";
    if (mode() === "now") return downloaded ? t("server.update.restartNow") : t("server.update.dialog.updateNow");
    return downloaded ? t("server.update.dialog.restartWhenIdle") : t("server.update.start");
  };
  const pendingLabel = () => {
    if (stage() === "offer" || stage() === "failed") return t("server.update.dialog.starting");
    if (stage() === "restarting") return t("server.update.restarting");
    if (stage() === "waiting") return t("server.update.dialog.waiting");
    const progress = progressText();
    return progress
      ? t("server.update.dialog.downloadingProgress", { progress })
      : t("server.update.dialog.downloading");
  };

  const stepStatus = (index: number): StepStatus => {
    const current = view();
    if (!current) return "pending";
    if (index === 0) {
      if (current.download === "running") return "active";
      return current.download;
    }
    if (current.stage === "online") return "done";
    if (index === 2) return "pending";
    if (current.stage === "waiting" || current.stage === "restarting") return "active";
    return current.stage === "failed" && current.failure !== "download" ? "failed" : "pending";
  };
  const restartDetail = () => {
    const current = view();
    if (current?.stage === "restarting") return t("server.update.dialog.restartRunning", { version: version() });
    if (current?.stage === "waiting")
      return current.waitingFor.length > 0
        ? t("server.update.dialog.restartWaiting", {
            reasons: format.list(current.waitingFor.map((reason) => t(restartReasonKey(reason)))),
          })
        : t("server.update.dialog.restartSoon");
    return t("server.update.dialog.restartPending");
  };
  const downloadDetail = () => {
    switch (view()?.download) {
      case "running": {
        const progress = progressText();
        return progress
          ? t("server.update.dialog.downloadRunning", { progress })
          : t("server.update.dialog.downloadPreparing");
      }
      case "done":
        return t("server.update.dialog.downloadDone");
      default:
        return t("server.update.dialog.downloadPending");
    }
  };
  const steps = () => [
    { label: t("server.update.dialog.downloadStep", { version: version() }), detail: downloadDetail() },
    { label: t("server.update.dialog.restartStep", { name: name() }), detail: restartDetail() },
    {
      label: t("server.update.dialog.onlineStep"),
      detail:
        stage() === "online"
          ? t("server.update.dialog.onlineDone", { version: version(), time: elapsed() })
          : t("server.update.dialog.onlinePending"),
    },
  ];
  const stepAt = (index: number) => steps()[index] ?? { label: "", detail: "" };
  const restartActions = () =>
    props.canManage &&
    view()?.restartMode !== null &&
    view()?.restartMode !== undefined &&
    (stage() === "downloading" || stage() === "waiting");

  return (
    <ConfirmDialog
      open={props.update !== null}
      tone="default"
      icon={stage() === "failed" ? <TriangleAlert /> : <RotateCcw />}
      initialFocus={running() ? "cancel" : "confirm"}
      title={title()}
      description={description()}
      confirmLabel={confirmLabel()}
      pendingLabel={pendingLabel()}
      cancelLabel={running() ? t("server.update.dialog.hide") : t("server.update.dialog.later")}
      pending={running() || props.busy === "start"}
      dismissWhilePending
      hideCancel={stage() === "online" || stage() === "failed"}
      error={props.error ?? undefined}
      confirmRef={(element) => {
        primaryButton = element;
      }}
      onCancel={() => props.onHide()}
      onConfirm={() => {
        if (stage() === "offer" || (stage() === "failed" && retry())) props.onStart(mode());
        else if (stage() === "online" || stage() === "failed") props.onDone();
      }}
    >
      <div class="server-update-dialog-body">
        <ol class="restart-server-steps" aria-label={t("server.update.dialog.steps")}>
          <For each={[0, 1, 2]}>
            {(index) => (
              <li
                class="restart-server-step"
                data-status={stepStatus(index)}
                aria-current={stepStatus(index) === "active" ? "step" : undefined}
              >
                <span class="restart-server-step-icon" aria-hidden="true">
                  <StepIcon status={stepStatus(index)} />
                </span>
                <span class="restart-server-step-text">
                  <span class="restart-server-step-label">{stepAt(index).label}</span>
                  <span class="restart-server-step-detail">{stepAt(index).detail}</span>
                  <Show when={index === 0 && view()?.download === "running"}>
                    <Progress
                      class="server-update-step-progress"
                      value={view()?.progress ?? 0}
                      indeterminate={view()?.progress === null}
                      aria-label={stepAt(0).label}
                    />
                  </Show>
                  <Show when={index === 1 && restartActions()}>
                    <span class="server-update-step-actions">
                      <Show when={view()?.restartMode === "when-idle"}>
                        <Button
                          type="button"
                          size="xs"
                          variant="outline"
                          loading={props.busy === "now"}
                          disabled={props.busy !== null}
                          onClick={() => props.onRestartNow()}
                        >
                          {t("server.update.restartNow")}
                        </Button>
                      </Show>
                      <Button
                        type="button"
                        size="xs"
                        variant="ghost"
                        loading={props.busy === "cancel"}
                        disabled={props.busy !== null}
                        onClick={() => props.onCancelRestart()}
                      >
                        {t("server.update.dialog.cancelRestart")}
                      </Button>
                    </span>
                  </Show>
                </span>
              </li>
            )}
          </For>
        </ol>
        <Show when={stage() === "offer" && props.canManage}>
          <SwitchField
            checked={whenIdle()}
            onChange={setWhenIdle}
            label={t("server.update.dialog.waitIdle")}
            description={t("server.update.dialog.waitIdleDescription")}
          />
        </Show>
      </div>
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
