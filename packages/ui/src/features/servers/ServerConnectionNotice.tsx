import type {
  HostedServerIssue,
  HostedServerSleep,
  HostedServerStart,
  HostedServerStartStep,
} from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import { createEffect, createMemo, createSignal, onCleanup, Show, untrack } from "solid-js";
import { Button, IconButton } from "../../button";
import { ErrorReference } from "../../error-reference";
import { X } from "../../icons";
import { useText } from "../../text";
import { toast } from "../../toast";
import { AppLoadingScreen } from "../account/AppLoadingScreen";
import { ServerStatusDialog } from "./ServerStatusDialog";

const START_STEP_TEXT = {
  machine: "server.hosted.detail.start.boot",
  restore: "server.hosted.detail.start.restore",
  openbot: "server.hosted.detail.start.app",
  provider_limit: "server.connection.providerLimit",
} as const satisfies Record<HostedServerStartStep, AppTextKey>;

export type ServerWorkspacePhase =
  | "connecting"
  | "loading"
  | "reconnecting"
  | "waiting"
  | "sleeping"
  | "waking"
  | "updating"
  | "blocked";

export interface ServerWorkspaceState {
  hostedSleep?: HostedServerSleep | null | undefined;
  updating: boolean;
  blocked: boolean;
  waiting?: boolean;
  loading: boolean;
  hasContent: boolean;
}

export function serverWorkspacePhase(state: ServerWorkspaceState): ServerWorkspacePhase {
  if (state.hostedSleep) return state.hostedSleep;
  if (state.updating) return "updating";
  if (state.blocked) return "blocked";
  if (state.waiting) return "waiting";
  if (state.loading) return "loading";
  return state.hasContent ? "reconnecting" : "connecting";
}

export interface ServerConnectionNoticeProps {
  name: string;
  phase: ServerWorkspacePhase;
  initial: boolean;
  fullWindow?: boolean;
  issue?: HostedServerIssue | null;
  start?: HostedServerStart | null;
  remainingSeconds?: number;
  busy?: boolean;
  detail?: string | null;
  reference?: string | null;
  updateVersion?: string | null;
  ready?: boolean | undefined;
  onExited?: (() => void) | undefined;
  onMountViews?: (() => void) | undefined;
  screen?: boolean;
  loadingScene?: "pile" | "quiet";
  hideDetails?: boolean;
  onRetry: () => void;
  onManage?: () => void;
  upsell?: { onSeePlans: () => void } | null | undefined;
}

const FIRST_LOAD_TOAST_DELAY_MS = 10_000;
let firstLoadToasts = 0;

export function ServerConnectionNotice(props: ServerConnectionNoticeProps) {
  const { t } = useText();
  const since = Date.now();
  const [detailsOpen, setDetailsOpen] = createSignal(false);
  const toastId = `server-connection-first-load:${++firstLoadToasts}`;
  const [round, setRound] = createSignal(0);
  const [waitedLong, setWaitedLong] = createSignal(false);
  const [toastClosed, setToastClosed] = createSignal(false);
  const starting = () => props.phase === "waking" && !props.issue;
  const urgent = () =>
    Boolean(props.issue) || (props.phase !== "loading" && props.phase !== "connecting" && !starting());
  const reference = () => (starting() ? null : props.reference);
  createEffect(round, () => {
    const timer = setTimeout(() => setWaitedLong(true), FIRST_LOAD_TOAST_DELAY_MS);
    return () => clearTimeout(timer);
  });
  createEffect(urgent, (now) => {
    if (!now) return;
    setWaitedLong(true);
    setToastClosed(false);
  });
  const retry = () => {
    setToastClosed(false);
    if (props.initial && !urgent()) setWaitedLong(false);
    setRound((current) => current + 1);
    props.onRetry();
  };
  const title = () => {
    switch (props.issue) {
      case "plan_ended":
        return t("server.connection.planEnded", { name: props.name });
      case "wake_failed":
        return t("server.connection.wakeFailed", { name: props.name });
      case "start_timeout":
        return t("server.connection.startTimeout", { name: props.name });
    }
    switch (props.phase) {
      case "sleeping":
        return t("server.connection.sleeping", { name: props.name });
      case "waking":
        return t("server.connection.waking", { name: props.name });
      case "updating":
        return t("server.connection.updating", { name: props.name });
      case "loading":
        return t("server.connection.loading", { name: props.name });
      case "connecting":
        return t("server.connection.connecting", { name: props.name });
      case "blocked":
        return t("server.connection.blocked", { name: props.name });
      default:
        return t("server.connection.reconnecting", { name: props.name });
    }
  };
  const [now, setNow] = createSignal(Date.now());
  createEffect(
    () => props.phase === "waking" && !props.issue && Boolean(props.start),
    (counting) => {
      if (!counting) return;
      setNow(Date.now());
      const clock = setInterval(() => setNow(Date.now()), 1000);
      return () => clearInterval(clock);
    },
  );
  const startProgress = () => {
    const start = props.start;
    if (props.phase !== "waking" || props.issue || !start) return null;
    const step = t(START_STEP_TEXT[start.step]);
    const seconds = Math.max(0, Math.floor((now() - start.startedAt) / 1000));
    return t("server.connection.startProgress", { step, time: formatElapsed(seconds) });
  };
  const detail = () =>
    startProgress() ??
    props.detail ??
    (props.remainingSeconds
      ? t("server.connection.nextRetry", { seconds: props.remainingSeconds })
      : props.phase === "sleeping"
        ? t("server.connection.wakeHint")
        : props.issue === "plan_ended"
          ? t("server.connection.planHint")
          : props.initial
            ? props.fullWindow
              ? undefined
              : t("server.connection.loadingHint")
            : t("server.connection.cachedHint"));
  const manageButton = (size: "default" | "sm") => (
    <Show when={props.onManage && (props.issue === "plan_ended" || props.phase === "blocked")}>
      <Button variant="outline" size={size} onClick={() => props.onManage?.()}>
        {t("server.connection.manage")}
      </Button>
    </Show>
  );
  const detailsButton = (size: "default" | "sm") => (
    <Show when={!props.hideDetails}>
      <Button variant="ghost" size={size} onClick={() => setDetailsOpen(true)}>
        {t("server.connection.details")}
      </Button>
    </Show>
  );
  const actions = () => (
    <>
      <Button variant="outline" disabled={props.busy} onClick={retry}>
        {t("server.connection.retry")}
      </Button>
      {manageButton("default")}
      {detailsButton("default")}
    </>
  );
  const statusDialog = () => (
    <ServerStatusDialog
      open={detailsOpen()}
      onClose={() => setDetailsOpen(false)}
      name={props.name}
      title={title()}
      phase={props.phase}
      initial={props.initial}
      issue={props.issue ?? null}
      updateVersion={props.updateVersion ?? null}
      remainingSeconds={props.remainingSeconds ?? 0}
      detail={props.detail ?? null}
      reference={props.reference ?? null}
      since={since}
    />
  );
  const upsell = () => (
    <Show when={props.upsell}>
      {(offer) => (
        <p class="hosted-upsell-offline">
          <span>{t("server.upsell.offline")}</span>
          <Button size="sm" variant="link" onClick={() => offer().onSeePlans()}>
            {t("server.upsell.seePlans")}
          </Button>
        </p>
      )}
    </Show>
  );
  const toastCard = () => (
    <section class="server-connection-toast" aria-label={title()}>
      <Show when={!urgent()}>
        <IconButton
          class="ui-toast-card-close"
          size="icon-xs"
          variant="ghost"
          label={t("common.close")}
          onClick={() => setToastClosed(true)}
        >
          <X aria-hidden="true" />
        </IconButton>
      </Show>
      <strong class="server-connection-toast-title">{title()}</strong>
      <Show when={detail()}>{(text) => <p class="server-connection-toast-body">{text()}</p>}</Show>
      <ErrorReference reference={reference()} />
      {upsell()}
      <Show when={!starting()}>
        <div class="server-connection-toast-actions ui-toast-card-actions">
          {detailsButton("sm")}
          {manageButton("sm")}
          <Button variant="default" size="sm" onClick={retry}>
            {t("server.connection.retry")}
          </Button>
        </div>
      </Show>
    </section>
  );
  let toastShown = false;
  createEffect(
    () =>
      props.initial && !props.ready && waitedLong() && !toastClosed() && !detailsOpen()
        ? { title: title(), locked: urgent() }
        : null,
    (message) => {
      toastShown = message !== null;
      if (message === null) {
        queueMicrotask(() => {
          if (!toastShown) toast.dismiss(toastId);
        });
        return;
      }
      toast(toastCard, {
        id: toastId,
        duration: Number.POSITIVE_INFINITY,
        unstyled: true,
        closeButton: false,
        class: "server-connection-toast-host",
        dismissible: !message.locked,
        onDismiss: () => {
          if (toastShown) setToastClosed(true);
        },
      });
    },
  );
  onCleanup(() => {
    toastShown = false;
    queueMicrotask(() => toast.dismiss(toastId));
  });
  return (
    <>
      <Show
        when={props.initial}
        fallback={
          <section class="server-connection-notice" role="status" aria-live="polite">
            <div>
              <p>{title()}</p>
              <p class="server-connection-detail">{detail()}</p>
              <ErrorReference reference={reference()} />
              {upsell()}
            </div>
            <div class="server-connection-actions">{actions()}</div>
          </section>
        }
      >
        <Show when={props.screen !== false}>
          <AppLoadingScreen
            label={title()}
            title={title()}
            scene={props.loadingScene ?? "pile"}
            ready={props.ready}
            onExited={props.onExited}
            onMountViews={props.onMountViews}
          />
        </Show>
      </Show>
      {statusDialog()}
    </>
  );
}

function formatElapsed(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

const CONVERSATION_LOADING_DELAY_MS = 150;

export interface ConversationLoadNoticeProps {
  name: string;
  loading: boolean;
  error: string | null;
  immediate?: boolean;
  onRetry: () => void;
}

export function ConversationLoadNotice(props: ConversationLoadNoticeProps) {
  const { t } = useText();
  const waiting = createMemo(() => props.loading && !props.error);
  const [screen, setScreen] = createSignal<number | null>(null);
  const [exiting, setExiting] = createSignal<number | null>(null);
  let screens = 0;
  let immediate = false;
  createEffect(waiting, (current) => {
    if (!current) {
      const shown = untrack(screen);
      let frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => setExiting(shown));
      });
      return () => cancelAnimationFrame(frame);
    }
    const show = () => {
      screens += 1;
      setScreen(screens);
    };
    immediate = untrack(() => props.immediate === true);
    if (immediate) {
      show();
      return;
    }
    const timer = setTimeout(show, CONVERSATION_LOADING_DELAY_MS);
    return () => clearTimeout(timer);
  });
  return (
    <>
      <Show when={screen()} keyed>
        {(key) => (
          <AppLoadingScreen
            scene="thinking"
            immediate={immediate}
            ready={key === exiting()}
            label={t("server.connection.loading", { name: props.name })}
            title={t("server.connection.loading", { name: props.name })}
            onExited={() => setScreen((current) => (current === key ? null : current))}
          />
        )}
      </Show>
      <Show when={props.error}>
        {(error) => (
          <ServerConnectionNotice
            name={props.name}
            phase="blocked"
            initial={false}
            detail={error()}
            hideDetails
            onRetry={props.onRetry}
          />
        )}
      </Show>
    </>
  );
}

export function ServerPanelLoadNotice(props: { busy: boolean; onRetry: () => void }) {
  const { t } = useText();
  return (
    <section class="server-connection-notice" role="status">
      <p>{t("server.connection.panelsFailed")}</p>
      <Button variant="outline" disabled={props.busy} onClick={() => props.onRetry()}>
        {t("server.connection.retry")}
      </Button>
    </section>
  );
}
