import type { HostedServerIssue } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import type { JSX } from "@solidjs/web";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { ConfirmDialog } from "../../confirm-dialog";
import { ErrorReference } from "../../error-reference";
import { CircleCheck, CircleDot, Download, Moon, RefreshCw, TriangleAlert } from "../../icons";
import { Spinner } from "../../surface";
import { useText } from "../../text";
import type { ServerWorkspacePhase } from "./ServerConnectionNotice";

type Cause = "update" | "wake" | "connection";
type Step = "update" | "wake" | "connect" | "load";
type StepStatus = "done" | "active" | "failed" | "pending";

const STEP_TEXT = {
  update: { label: "server.status.stepUpdate", detail: "server.status.stepUpdateDetail" },
  wake: { label: "server.status.stepWake", detail: "server.status.stepWakeDetail" },
  connect: { label: "server.status.stepConnect", detail: "server.status.stepConnectDetail" },
  load: { label: "server.status.stepLoad", detail: "server.status.stepLoadDetail" },
} as const satisfies Record<Step, { label: AppTextKey; detail: AppTextKey }>;

export interface ServerStatusDialogProps {
  open: boolean;
  onClose: () => void;
  name: string;
  title: string;
  phase: ServerWorkspacePhase;
  initial: boolean;
  issue?: HostedServerIssue | null;
  updateVersion?: string | null;
  remainingSeconds?: number;
  detail?: string | null;
  reference?: string | null;
  since: number;
}

export function ServerStatusDialog(props: ServerStatusDialogProps) {
  const { t } = useText();
  const cause = createMemo<Cause>((previous) => {
    if (props.phase === "updating") return "update";
    if (props.phase === "waking" || props.phase === "sleeping" || props.issue) return "wake";
    return previous ?? "connection";
  });
  const serverStep = (): Step => (cause() === "update" ? "update" : "wake");
  const steps = (): Step[] => (cause() === "connection" ? ["connect", "load"] : [serverStep(), "connect", "load"]);
  const current = (): Step => {
    switch (props.phase) {
      case "updating":
        return "update";
      case "waking":
      case "sleeping":
        return "wake";
      case "loading":
        return "load";
      case "blocked":
        return props.issue ? serverStep() : "connect";
      default:
        return "connect";
    }
  };
  const status = (step: Step): StepStatus => {
    const index = steps().indexOf(step);
    const currentIndex = steps().indexOf(current());
    if (index < currentIndex) return "done";
    if (index > currentIndex) return "pending";
    if (props.phase === "blocked") return "failed";
    return props.phase === "sleeping" ? "pending" : "active";
  };
  const stepDetail = (step: Step): string => {
    if (step === "connect" && current() === "connect") {
      if (props.phase === "blocked" && props.detail) return props.detail;
      if (props.remainingSeconds) return t("server.connection.nextRetry", { seconds: props.remainingSeconds });
    }
    return t(STEP_TEXT[step].detail);
  };
  const description = () => {
    if (props.issue === "plan_ended") return t("server.connection.planHint");
    switch (cause()) {
      case "update":
        return props.updateVersion
          ? t("server.status.updateCause", { name: props.name, version: props.updateVersion })
          : t("server.status.updateCauseNoVersion", { name: props.name });
      case "wake":
        return props.phase === "sleeping"
          ? t("server.connection.wakeHint")
          : t("server.status.wakeCause", { name: props.name });
      default:
        return props.initial
          ? t("server.status.connectCause", { name: props.name })
          : t("server.status.connectionCause", { name: props.name });
    }
  };
  const icon = (): JSX.Element => {
    if (props.phase === "blocked") return <TriangleAlert />;
    switch (cause()) {
      case "update":
        return <Download />;
      case "wake":
        return <Moon />;
      default:
        return <RefreshCw />;
    }
  };

  const [now, setNow] = createSignal(Date.now());
  createEffect(
    () => props.open,
    (open) => {
      if (!open) return;
      setNow(Date.now());
      const clock = setInterval(() => setNow(Date.now()), 1000);
      return () => clearInterval(clock);
    },
  );
  const elapsed = () => formatElapsed(Math.max(0, Math.floor((now() - props.since) / 1000)));

  return (
    <ConfirmDialog
      open={props.open}
      tone="default"
      icon={icon()}
      title={props.title}
      description={description()}
      confirmLabel={t("common.close")}
      hideCancel
      onCancel={props.onClose}
      onConfirm={props.onClose}
    >
      <ol class="restart-server-steps" aria-label={t("server.status.steps")}>
        <For each={steps()}>
          {(step) => (
            <li
              class="restart-server-step"
              data-status={status(step)}
              aria-current={status(step) === "active" ? "step" : undefined}
            >
              <span class="restart-server-step-icon" aria-hidden="true">
                <StepIcon status={status(step)} />
              </span>
              <span class="restart-server-step-text">
                <span class="restart-server-step-label">{t(STEP_TEXT[step].label)}</span>
                <span class="restart-server-step-detail">{stepDetail(step)}</span>
              </span>
            </li>
          )}
        </For>
      </ol>
      <p class="server-status-meta">
        <span>{t("server.status.elapsed", { time: elapsed() })}</span>
        <ErrorReference reference={props.reference} />
      </p>
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
