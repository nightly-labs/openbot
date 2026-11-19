import type { HostedServerIssue, HostedServerSleep, HostedServerStart } from "@openbot/contracts/ipc";
import { createEffect, createMemo, createSignal, onCleanup, Show, untrack } from "solid-js";
import { Button, IconButton } from "../../button";
import { ErrorReference } from "../../error-reference";
import { X } from "../../icons";
import { useText } from "../../text";
import { toast } from "../../toast";
import { AppLoadingScreen } from "../account/AppLoadingScreen";
import { ServerStatusDialog } from "./ServerStatusDialog";

export type ServerWorkspacePhase =
  | "connecting"
  | "loading"
  | "reconnecting"
  | "waiting"
  | "sleeping"
  | "waking"
  | "updating"
  | "blocked";

/** What the desktop and the web know about a server that is not ready yet. */
export interface ServerWorkspaceState {
  /** The sleep phase of a hosted server, which wins over all other states. */
  hostedSleep?: HostedServerSleep | null | undefined;
  updating: boolean;
  blocked: boolean;
  /** The connection failed and waits before it tries again. */
  waiting?: boolean;
  /** The server is online or connecting, and its workspace loads. */
  loading: boolean;
  /** The workspace was on screen before, so the notice reconnects instead of connecting. */
  hasContent: boolean;
}

/** The phase that the notice shows, in order of priority. */
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
  /** The screen covers the whole window, server rail included, so it does not say that another server can be selected. */
  fullWindow?: boolean;
  issue?: HostedServerIssue | null;
  /** The step of a hosted start, shown with its time while the phase is `waking`. */
  start?: HostedServerStart | null;
  remainingSeconds?: number;
  busy?: boolean;
  detail?: string | null;
  /** The code of the failure in `detail`, for a user to copy into a report. */
  reference?: string | null;
  /** The OpenBot version that the server restarts into, while it updates. */
  updateVersion?: string | null;
  /** The first load ended: the full-window screen hops its crew out. Remove the notice in `onExited`. */
  ready?: boolean | undefined;
  onExited?: (() => void) | undefined;
  /** The full-window screen still covers the window, and heavy views can mount before its crew hop out. */
  onMountViews?: (() => void) | undefined;
  /** False when another loading screen already covers the window: the first load then shows only its toast. */
  screen?: boolean;
  /** Removes Details, for a notice that is not about the server connection. */
  hideDetails?: boolean;
  onRetry: () => void;
  onManage?: () => void;
  /** The offer of a hosted server, for the user's own computer that is offline. */
  upsell?: { onSeePlans: () => void } | null | undefined;
}

/** A first load that takes longer than this shows its actions in a toast. */
const FIRST_LOAD_TOAST_DELAY_MS = 10_000;
let firstLoadToasts = 0;

/**
 * Connection feedback stays visible until the workspace can answer the user's actions. A first load
 * shows only the crew. Its actions open in a toast after a long wait, or at once when
 * the server fails, sleeps or needs the user.
 */
export function ServerConnectionNotice(props: ServerConnectionNoticeProps) {
  const { t } = useText();
  const since = Date.now();
  const [detailsOpen, setDetailsOpen] = createSignal(false);
  const toastId = `server-connection-first-load:${++firstLoadToasts}`;
  // A wait is long after the delay, or at once when the server does not only load. A retry starts a new wait.
  const [round, setRound] = createSignal(0);
  const [waitedLong, setWaitedLong] = createSignal(false);
  const [toastClosed, setToastClosed] = createSignal(false);
  /**
   * A hosted server that starts and has no issue does what it must: it is not a failure, so it has no
   * error code, and its toast waits as a long load does. When the start fails, the issue makes the
   * toast urgent again, with its code, Details and Retry.
   */
  const starting = () => props.phase === "waking" && !props.issue;
  const urgent = () =>
    Boolean(props.issue) || (props.phase !== "loading" && props.phase !== "connecting" && !starting());
  const reference = () => (starting() ? null : props.reference);
  createEffect(round, () => {
    const timer = setTimeout(() => setWaitedLong(true), FIRST_LOAD_TOAST_DELAY_MS);
    return () => clearTimeout(timer);
  });
  // A server that failed once keeps its toast while it connects again.
  createEffect(urgent, (now) => {
    if (!now) return;
    setWaitedLong(true);
    // The pane screen has no controls, so a server that needs the user shows its toast again.
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
    const step =
      start.step === "provider_limit"
        ? t("server.connection.providerLimit")
        : t(start.step === "openbot" ? "server.hosted.detail.start.app" : "server.hosted.detail.start.boot");
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
  // The toast reads the notice's state, so its detail, time and buttons stay current while it shows.
  // It opens after a long wait, so its Retry also starts the connection again while one is in progress.
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
      {/* A server that starts shows its progress only: the user has nothing to retry or read yet. */}
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
    // The card reads the title itself, so a new title or lock only raises the same toast again.
    () =>
      props.initial && !props.ready && waitedLong() && !toastClosed() && !detailsOpen()
        ? { title: title(), locked: urgent() }
        : null,
    (message) => {
      toastShown = message !== null;
      if (message === null) {
        // A toast that shows again before the microtask stays.
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
        // The controls of a server that needs the user are only in this toast, so it cannot be swiped away.
        dismissible: !message.locked,
        // A `toast.dismiss` call also calls this. Only a toast that is still wanted was closed by the user.
        onDismiss: () => {
          if (toastShown) setToastClosed(true);
        },
      });
    },
  );
  // A write to the Toaster from a scope cleanup stops the reactive system, so it waits for a microtask.
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

// A history that loads faster than this does not cover the chat, so a fast switch does not flash.
const CONVERSATION_LOADING_DELAY_MS = 150;

export interface ConversationLoadNoticeProps {
  /** The agent whose history loads. */
  name: string;
  /** The first page of the history is loading. */
  loading: boolean;
  /** Why the history did not load. The notice then shows Retry. */
  error: string | null;
  /**
   * The wait is sure to be long, such as the first load of a saved frame: the screen shows at once,
   * so the chat under it does not show for a moment first.
   */
  immediate?: boolean;
  onRetry: () => void;
}

/**
 * While an agent's history loads for the first time, the lilac plush of the app loading screen covers
 * the chat and watches its balls, and the screen fades when the history is ready. A failed load shows the notice with Retry.
 */
export function ConversationLoadNotice(props: ConversationLoadNoticeProps) {
  const { t } = useText();
  // A memo, so that a read in the loading screen's `onSettled` does not run the caller's prop getter:
  // a getter such as `a && b` makes a memo when it runs, and `onSettled` does not permit one.
  const waiting = createMemo(() => props.loading && !props.error);
  // Each wait gets its own screen: a screen that started its exit cannot load again.
  const [screen, setScreen] = createSignal<number | null>(null);
  // The screen that started its exit. It stays ready, so a new wait does not stop its exit.
  const [exiting, setExiting] = createSignal<number | null>(null);
  let screens = 0;
  // Whether the screen that shows now came at once.
  let immediate = false;
  createEffect(waiting, (current) => {
    if (!current) {
      // The chat under the screen measures its rows and moves to its latest message in the next two
      // frames. The screen starts its exit after them, so the reader does not see the rows move.
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

/** A failed optional read does not prevent work in the loaded workspace. */
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
