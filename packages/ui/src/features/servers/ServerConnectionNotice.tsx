import type { HostedServerIssue, HostedServerSleep, HostedServerStart } from "@openbot/contracts/ipc";
import { createEffect, createSignal, Show, untrack } from "solid-js";
import { Button } from "../../button";
import { ErrorReference } from "../../error-reference";
import { useText } from "../../text";
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
  /** Removes Details, for a notice that is not about the server connection. */
  hideDetails?: boolean;
  onRetry: () => void;
  onManage?: () => void;
  /** The offer of a hosted server, for the user's own computer that is offline. */
  upsell?: { onSeePlans: () => void } | null | undefined;
}

/** Connection feedback stays visible until the workspace can answer the user's actions. */
export function ServerConnectionNotice(props: ServerConnectionNoticeProps) {
  const { t } = useText();
  const since = Date.now();
  const [detailsOpen, setDetailsOpen] = createSignal(false);
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
            ? t("server.connection.loadingHint")
            : t("server.connection.cachedHint"));
  const actions = () => (
    <>
      <Button variant="outline" disabled={props.busy} onClick={() => props.onRetry()}>
        {t("server.connection.retry")}
      </Button>
      <Show when={props.onManage && (props.issue === "plan_ended" || props.phase === "blocked")}>
        <Button variant="outline" onClick={() => props.onManage?.()}>
          {t("server.connection.manage")}
        </Button>
      </Show>
      <Show when={!props.hideDetails}>
        <Button variant="ghost" onClick={() => setDetailsOpen(true)}>
          {t("server.connection.details")}
        </Button>
      </Show>
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
    </>
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
  return (
    <Show
      when={props.initial}
      fallback={
        <section class="server-connection-notice" role="status" aria-live="polite">
          <div>
            <p>{title()}</p>
            <p class="server-connection-detail">{detail()}</p>
            <ErrorReference reference={props.reference} />
            {upsell()}
          </div>
          <div class="server-connection-actions">{actions()}</div>
        </section>
      }
    >
      <AppLoadingScreen
        label={title()}
        title={title()}
        detail={detail()}
        reference={props.reference ?? null}
        actions={actions()}
        footer={upsell()}
      />
    </Show>
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
  onRetry: () => void;
}

/**
 * While an agent's history loads for the first time, the crew of the app loading screen covers the
 * chat, and jumps out when the history is ready. A failed load shows the notice with Retry.
 */
export function ConversationLoadNotice(props: ConversationLoadNoticeProps) {
  const { t } = useText();
  const waiting = () => props.loading && !props.error;
  // Each wait gets its own screen: a screen that started its exit cannot load again.
  const [screen, setScreen] = createSignal<number | null>(null);
  // The screen that started its exit. It stays ready, so a new wait does not stop its exit.
  const [exiting, setExiting] = createSignal<number | null>(null);
  let screens = 0;
  createEffect(waiting, (current) => {
    if (!current) {
      setExiting(untrack(screen));
      return;
    }
    const timer = setTimeout(() => {
      screens += 1;
      setScreen(screens);
    }, CONVERSATION_LOADING_DELAY_MS);
    return () => clearTimeout(timer);
  });
  return (
    <>
      <Show when={screen()} keyed>
        {(key) => (
          <AppLoadingScreen
            ready={key === exiting() || !waiting()}
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
