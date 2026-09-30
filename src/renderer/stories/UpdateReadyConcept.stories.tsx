import { AppLogo, type AppLogoAnimation } from "@openbot/brand";
import { ArrowRight, Button, CircleCheck, HardDrive, Progress, Spinner, TriangleAlert } from "@openbot/ui";
import { AppLoadingScreen } from "@openbot/ui/features/account/AppLoadingScreen";
import { WhatsNewBody } from "@openbot/ui/features/updates/WhatsNewDialog";
import type { WhatsNewRelease } from "@openbot/ui/features/updates/whats-new";
import type { JSX } from "@solidjs/web";
import { createEffect, createSignal, For, Match, onCleanup, onSettled, Show, Switch, untrack } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import "./UpdateReadyConcept.css";

// Concepts for issue #1208: a full-screen state for a downloaded update. Each concept shares one
// restart flow (ready -> restarting -> success, failure or slow) so the fallback states can be
// compared between layouts. The launch flow puts the version handoff between the loading screen and
// the app, with the download before the restart. Copy is concept text; a shipped screen takes it
// from `@openbot/i18n`.

const CURRENT_VERSION = "0.25.3";
const NEXT_VERSION = "0.26.0";
const SLOW_RESTART_MS = 4000;
const DOWNLOAD_MB = 91;
const DOWNLOAD_TICK_MS = 100;
const DOWNLOAD_FAIL_AT = 62;

type RestartOutcome = "success" | "failure" | "slow";
type RestartState = "ready" | "restarting" | "slow" | "success" | "failed";
type DownloadStatus = "downloading" | "failed" | "done";
type ScreenState = RestartState | "downloading" | "download-failed";

interface RestartFlow {
  state: () => RestartState;
  restart: () => void;
  reset: () => void;
}

interface RestartFlowOptions {
  outcome: RestartOutcome;
  restartMs: number;
  initial: RestartState;
  /** A relaunch replaces the success panel: the app starts again on the new version. */
  onSuccess?: () => void;
}

/** Simulates the updater: `restartMs` after the click it lands on the chosen outcome. */
function createRestartFlow(options: () => RestartFlowOptions): RestartFlow {
  const [state, setState] = createSignal<RestartState>(untrack(() => options().initial));
  let timer: number | undefined;

  function restart(): void {
    window.clearTimeout(timer);
    setState("restarting");
    const { outcome, restartMs, onSuccess } = options();
    const delay = outcome === "slow" ? SLOW_RESTART_MS : restartMs;
    timer = window.setTimeout(() => {
      if (outcome === "success" && onSuccess) onSuccess();
      else if (outcome === "success") setState("success");
      else if (outcome === "failure") setState("failed");
      else setState("slow");
    }, delay);
  }

  function reset(): void {
    window.clearTimeout(timer);
    setState("ready");
  }

  onCleanup(() => window.clearTimeout(timer));
  return { state, restart, reset };
}

interface UpdateDownload {
  status: () => DownloadStatus;
  /** Percent, 0 to 100. */
  progress: () => number;
  retry: () => void;
}

interface DownloadOptions {
  downloadMs: number;
  /** The first attempt stops at `DOWNLOAD_FAIL_AT`, as a `download_failed` would. A retry resumes. */
  fails: boolean;
}

/** Simulates the background download that starts when the launch check finds an update. */
function createDownload(options: () => DownloadOptions): UpdateDownload & { start: () => void } {
  const [status, setStatus] = createSignal<DownloadStatus>("downloading");
  const [progress, setProgress] = createSignal(0);
  let timer: number | undefined;
  let done = 0;
  let failedOnce = false;

  function run(): void {
    window.clearInterval(timer);
    setStatus("downloading");
    const { downloadMs, fails } = options();
    const step = 100 / Math.max(1, downloadMs / DOWNLOAD_TICK_MS);
    timer = window.setInterval(() => {
      done = Math.min(100, done + step);
      if (fails && !failedOnce && done >= DOWNLOAD_FAIL_AT) {
        failedOnce = true;
        done = DOWNLOAD_FAIL_AT;
        window.clearInterval(timer);
        setStatus("failed");
      } else if (done >= 100) {
        window.clearInterval(timer);
        setStatus("done");
      }
      setProgress(done);
    }, DOWNLOAD_TICK_MS);
  }

  function start(): void {
    done = 0;
    failedOnce = false;
    setProgress(0);
    run();
  }

  onCleanup(() => window.clearInterval(timer));
  return { status, progress, start, retry: run };
}

function logoAnimation(state: ScreenState): AppLogoAnimation {
  if (state === "ready") return "blink";
  if (state === "restarting" || state === "slow" || state === "downloading") return "look-around";
  if (state === "failed" || state === "download-failed") return "surprised";
  return "none";
}

interface UpdateScreenProps {
  labelledBy: string;
  state: ScreenState;
  children: JSX.Element;
  onDismiss?: () => void;
}

/**
 * The full-screen shell. It is a modal dialog, so focus stays inside and Escape returns to the app
 * whenever no restart runs. The app stays usable behind it: nothing here blocks without an exit.
 */
function UpdateScreen(props: UpdateScreenProps) {
  let root: HTMLElement | undefined;

  // A state can swap the panel and remove the focused button, so focus moves to the new primary
  // action. Without it, focus falls to the body and Escape no longer reaches the dialog. Focus that
  // is still inside, such as on a changelog link while the download ends, stays where it is.
  createEffect(
    () => props.state,
    () => {
      const active = document.activeElement;
      if (root && active && active !== root && root.contains(active)) return;
      (root?.querySelector<HTMLElement>("[data-autofocus]:not(:disabled)") ?? root)?.focus();
    },
  );

  function handleKeyDown(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    if (props.state === "restarting") return;
    props.onDismiss?.();
  }

  return (
    <section
      ref={root}
      class="update-ready"
      data-state={props.state}
      role="dialog"
      aria-modal="true"
      aria-labelledby={props.labelledBy}
      tabindex={-1}
      onKeyDown={handleKeyDown}
    >
      {props.children}
    </section>
  );
}

/** Announces restart progress and outcomes to screen readers; the visible copy is elsewhere. */
function RestartAnnouncement(props: { state: ScreenState; downloaded?: boolean }) {
  const message = () => {
    switch (props.state) {
      case "downloading":
        return `Downloading OpenBot ${NEXT_VERSION}.`;
      case "download-failed":
        return "The download stopped.";
      case "ready":
        return props.downloaded ? "The update is downloaded. Restart to install it." : "";
      case "restarting":
        return "Restarting OpenBot to install the update.";
      case "slow":
        return "The restart takes longer than usual.";
      case "success":
        return `OpenBot ${NEXT_VERSION} is installed.`;
      case "failed":
        return "The update did not install.";
      default:
        return "";
    }
  };
  return (
    <p class="update-ready__sr-only" role="status" aria-live="polite">
      {message()}
    </p>
  );
}

// ---------------------------------------------------------------------------------------------
// Concept A: Focused. The layout from the issue reference, in OpenBot branding.
// ---------------------------------------------------------------------------------------------

interface ConceptProps {
  flow: RestartFlow;
  onDismiss: () => void;
  /** Present when the screen opens before the update is on disk. */
  download?: UpdateDownload;
}

function FocusedConcept(props: ConceptProps) {
  const state = () => props.flow.state();
  return (
    <UpdateScreen labelledBy="update-focused-title" state={state()} onDismiss={props.onDismiss}>
      <RestartAnnouncement state={state()} />
      <div class="update-ready__stage">
        <Show when={state() === "ready" || state() === "restarting"}>
          <div class="update-ready__mark">
            <AppLogo variant="production" animation={logoAnimation(state())} class="update-ready__logo" />
          </div>
        </Show>
        <Switch>
          <Match when={state() === "ready"}>
            <h1 id="update-focused-title" class="update-ready__title">
              Update ready
            </h1>
            <p class="update-ready__body">Restart to finish. It takes a few seconds.</p>
            <Progress class="update-ready__progress" value={100} aria-label="Update downloaded" />
            <p class="update-ready__version">OpenBot {NEXT_VERSION}</p>
            <div class="update-ready__actions">
              <Button size="lg" variant="ghost" onClick={props.onDismiss}>
                Later
              </Button>
              <Button size="lg" data-autofocus onClick={props.flow.restart}>
                Restart to update
              </Button>
            </div>
          </Match>
          <Match when={state() === "restarting"}>
            <h1 id="update-focused-title" class="update-ready__title">
              Restarting…
            </h1>
            <p class="update-ready__body">OpenBot closes and opens again on {NEXT_VERSION}.</p>
            <Progress class="update-ready__progress" indeterminate aria-label="Restarting" />
            <p class="update-ready__version">
              {CURRENT_VERSION} → {NEXT_VERSION}
            </p>
          </Match>
          <Match when={state() === "slow"}>
            <SlowRestartPanel titleId="update-focused-title" flow={props.flow} onDismiss={props.onDismiss} />
          </Match>
          <Match when={state() === "success"}>
            <SuccessPanel titleId="update-focused-title" onDismiss={props.onDismiss} />
          </Match>
          <Match when={state() === "failed"}>
            <FailurePanel titleId="update-focused-title" flow={props.flow} onDismiss={props.onDismiss} />
          </Match>
        </Switch>
      </div>
    </UpdateScreen>
  );
}

// ---------------------------------------------------------------------------------------------
// Concept B: Version handoff. It shows what changes, so the restart has a reason.
// ---------------------------------------------------------------------------------------------

// The 0.26.0 notes from CHANGELOG.md, as the What's new loader gives them: plain text, one entry per
// line. The fixes list is shortened.
const NEXT_RELEASE: WhatsNewRelease = {
  version: NEXT_VERSION,
  date: "2026-09-30",
  notices: [],
  groups: [
    {
      type: "added",
      items: [
        "In an agent chat on a team, each message from another person stands on the right, with your messages, and shows their name. Their bubble has their own color, so it does not look like yours.",
        "A hosted server updates itself. It downloads a new OpenBot release in the background and starts it at its next start, so an open session does not stop.",
      ],
    },
    {
      type: "changed",
      items: [
        "A routine run in an agent chat shows as one short line with the routine name and its state. The chat no longer shows the routine instruction as your message.",
        "When a hosted server is low on memory, new messages wait in the queue and start when memory is free.",
        "A hosted server runs at most 4, 8 or 16 agent turns at the same time, from the memory of its plan.",
        "A plan change no longer stops a hosted server that is in use.",
        "An agent's browser tab that nobody uses for 30 minutes now unloads its page to free memory. The tab stays open with its URL, title and preview.",
      ],
    },
    {
      type: "fixed",
      items: [
        "In the browser live view of a remote server, Enter submits a form and breaks a line, and Backspace, Delete, Tab and the arrow keys work.",
        "The Computer Use driver stops when OpenBot stops, also after a crash or an out-of-memory kill.",
        "OpenBot uses less memory in long sessions. It no longer keeps a second copy of each conversation.",
        "The Dynamic Island shows new messages again when you have more than 10,000 unread replies.",
        "Each Dynamic Island window uses about half the memory.",
        "Sending a message, or a change to a queued message, no longer writes all message history to the database again.",
        'With Codex (GPT models), an agent now gets the tools of an MCP server whose name has a space, such as "Home Assistant".',
        "With automatic downloads on, one restart now installs the newest OpenBot version.",
      ],
    },
  ],
};

function HandoffConcept(props: ConceptProps) {
  const state = () => props.flow.state();
  const download = () => props.download?.status() ?? "done";
  const screenState = (): ScreenState => {
    if (download() === "downloading") return "downloading";
    if (download() === "failed") return "download-failed";
    return state();
  };
  return (
    <UpdateScreen labelledBy="update-handoff-title" state={screenState()} onDismiss={props.onDismiss}>
      <RestartAnnouncement state={screenState()} downloaded={props.download !== undefined} />
      <div class="update-ready__stage update-ready__stage--wide">
        <Show
          when={state() === "ready" || state() === "restarting"}
          fallback={<OutcomePanels titleId="update-handoff-title" flow={props.flow} onDismiss={props.onDismiss} />}
        >
          <div class="update-handoff__versions" aria-hidden="true">
            <span class="update-handoff__chip">{CURRENT_VERSION}</span>
            <span class="update-handoff__arrow">
              <ArrowRight />
            </span>
            <span class="update-handoff__chip update-handoff__chip--next">
              <AppLogo
                variant="production"
                animation={logoAnimation(screenState())}
                class="update-handoff__chip-logo"
              />
              {NEXT_VERSION}
            </span>
          </div>
          <h1 id="update-handoff-title" class="update-ready__title">
            {download() === "done" ? `OpenBot ${NEXT_VERSION} is ready` : `Downloading OpenBot ${NEXT_VERSION}`}
          </h1>
          <p class="update-ready__body">
            You are on {CURRENT_VERSION}.{" "}
            {download() === "done" ? "Restart to get the changes below." : "The changes below download now."} Your chats
            and agents stay as they are.
          </p>
          <div class="update-handoff__changelog">
            <WhatsNewBody
              notes={{ status: "ready", releases: [NEXT_RELEASE] }}
              releases={[NEXT_RELEASE]}
              onRetry={() => {}}
            />
          </div>
          <Show when={props.download}>{(item) => <DownloadRow download={item()} />}</Show>
          <div class="update-ready__actions">
            <Button size="lg" variant="ghost" disabled={state() === "restarting"} onClick={props.onDismiss}>
              Later
            </Button>
            <Show
              when={download() !== "failed"}
              fallback={
                <Button size="lg" data-autofocus onClick={() => props.download?.retry()}>
                  Try again
                </Button>
              }
            >
              <Button
                size="lg"
                data-autofocus
                disabled={download() === "downloading"}
                loading={state() === "restarting"}
                loadingLabel="Restarting…"
                onClick={props.flow.restart}
              >
                Restart to update
              </Button>
            </Show>
          </div>
        </Show>
      </div>
    </UpdateScreen>
  );
}

/**
 * The row keeps its place when the download ends, so the actions do not move under the pointer.
 * `download_failed` resumes from the same point: the bytes on disk stay.
 */
function DownloadRow(props: { download: UpdateDownload }) {
  const percent = () => Math.round(props.download.progress());
  const text = () => {
    switch (props.download.status()) {
      case "failed":
        return `The download stopped at ${percent()}%. Check the connection and try again.`;
      case "done":
        return `Downloaded · ${DOWNLOAD_MB} MB`;
      default:
        return `${percent()}% · ${Math.round((percent() / 100) * DOWNLOAD_MB)} of ${DOWNLOAD_MB} MB`;
    }
  };
  return (
    <div class="update-handoff__download" data-status={props.download.status()}>
      <Progress class="update-ready__progress" value={props.download.progress()} aria-label="Update download" />
      <p class="update-handoff__download-text">{text()}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Concept C: Safe restart. It shows the work that a restart stops, and lets the user wait for it.
// ---------------------------------------------------------------------------------------------

const RUNNING_WORK = [
  { name: "Launch planner", activity: "Writing the release checklist" },
  { name: "Quality review", activity: "Running the test suite" },
];

type RestartChoice = "when-idle" | "now";

function SafeRestartConcept(props: ConceptProps) {
  const state = () => props.flow.state();
  const [choice, setChoice] = createSignal<RestartChoice>("when-idle");
  const [waiting, setWaiting] = createSignal(false);

  function confirm(): void {
    if (choice() === "now") props.flow.restart();
    else setWaiting(true);
  }

  return (
    <UpdateScreen labelledBy="update-safe-title" state={state()} onDismiss={props.onDismiss}>
      <RestartAnnouncement state={state()} />
      <div class="update-ready__stage update-ready__stage--wide">
        <Show
          when={state() === "ready" || state() === "restarting"}
          fallback={<OutcomePanels titleId="update-safe-title" flow={props.flow} onDismiss={props.onDismiss} />}
        >
          <div class="update-ready__mark update-ready__mark--small">
            <AppLogo variant="production" animation={logoAnimation(state())} class="update-ready__logo" />
          </div>
          <h1 id="update-safe-title" class="update-ready__title">
            Update ready: OpenBot {NEXT_VERSION}
          </h1>
          <p class="update-ready__body">A restart stops the work below. OpenBot starts it again after the update.</p>

          <ul class="update-safe__work" aria-label="Work that is running">
            <For each={RUNNING_WORK}>
              {(item) => (
                <li class="update-safe__work-item">
                  <Spinner size="sm" />
                  <span class="update-safe__work-name">{item.name}</span>
                  <span class="update-safe__work-activity">{item.activity}</span>
                </li>
              )}
            </For>
          </ul>

          <fieldset class="update-safe__choices">
            <legend class="update-ready__sr-only">When to restart</legend>
            <ChoiceCard
              selected={choice() === "when-idle"}
              title="When the agents are idle"
              detail="OpenBot waits for the work above, then restarts."
              onSelect={() => setChoice("when-idle")}
            />
            <ChoiceCard
              selected={choice() === "now"}
              title="Now"
              detail="The agents stop. They continue after the restart."
              onSelect={() => setChoice("now")}
            />
          </fieldset>

          <Show
            when={!waiting()}
            fallback={
              <div class="update-safe__waiting">
                <Spinner size="sm" />
                <span>Waiting for 2 agents. You can keep working.</span>
                <Button variant="ghost" size="sm" onClick={() => setWaiting(false)}>
                  Cancel
                </Button>
              </div>
            }
          >
            <div class="update-ready__actions">
              <Button size="lg" variant="ghost" disabled={state() === "restarting"} onClick={props.onDismiss}>
                Later
              </Button>
              <Button
                size="lg"
                data-autofocus
                loading={state() === "restarting"}
                loadingLabel="Restarting…"
                onClick={confirm}
              >
                {choice() === "now" ? "Restart now" : "Restart when idle"}
              </Button>
            </div>
          </Show>

          <p class="update-safe__note">
            <HardDrive aria-hidden="true" />
            Chats, files and agent memory stay on this computer during the update.
          </p>
        </Show>
      </div>
    </UpdateScreen>
  );
}

interface ChoiceCardProps {
  selected: boolean;
  title: string;
  detail: string;
  onSelect: () => void;
}

function ChoiceCard(props: ChoiceCardProps) {
  return (
    <Button
      variant="outline"
      class="update-safe__choice"
      aria-pressed={props.selected ? "true" : "false"}
      data-selected={props.selected ? "" : undefined}
      onClick={props.onSelect}
    >
      <span class="update-safe__choice-title">{props.title}</span>
      <span class="update-safe__choice-detail">{props.detail}</span>
    </Button>
  );
}

// ---------------------------------------------------------------------------------------------
// Shared outcome panels. Every concept ends in one of these, so no state leaves the user stuck.
// ---------------------------------------------------------------------------------------------

interface PanelProps {
  titleId: string;
  flow: RestartFlow;
  onDismiss: () => void;
}

function OutcomePanels(props: PanelProps) {
  return (
    <Switch>
      <Match when={props.flow.state() === "slow"}>
        <SlowRestartPanel {...props} />
      </Match>
      <Match when={props.flow.state() === "success"}>
        <SuccessPanel titleId={props.titleId} onDismiss={props.onDismiss} />
      </Match>
      <Match when={props.flow.state() === "failed"}>
        <FailurePanel {...props} />
      </Match>
    </Switch>
  );
}

/** After relaunch. In the app this hands off to the What's new dialog. */
function SuccessPanel(props: { titleId: string; onDismiss: () => void }) {
  return (
    <>
      <span class="update-ready__status-icon update-ready__status-icon--success" aria-hidden="true">
        <CircleCheck />
      </span>
      <h1 id={props.titleId} class="update-ready__title">
        OpenBot is up to date
      </h1>
      <p class="update-ready__body">
        Updated from {CURRENT_VERSION} to {NEXT_VERSION}. Your agents continue their work.
      </p>
      <div class="update-ready__actions">
        <Button size="lg" variant="ghost" onClick={props.onDismiss}>
          Continue
        </Button>
        <Button size="lg" data-autofocus onClick={props.onDismiss}>
          See what’s new
        </Button>
      </div>
    </>
  );
}

/**
 * `install_failed`. Shutdown preparation already ran, so a retry in place is not safe: the way out
 * is a relaunch, or a return to the current version.
 */
function FailurePanel(props: PanelProps) {
  return (
    <>
      <span class="update-ready__status-icon update-ready__status-icon--danger" aria-hidden="true">
        <TriangleAlert />
      </span>
      <h1 id={props.titleId} class="update-ready__title">
        The update did not install
      </h1>
      <p class="update-ready__body">
        OpenBot is still on {CURRENT_VERSION}. Your chats and agents did not change. Quit and open OpenBot to try again.
      </p>
      <div class="update-ready__actions">
        <Button size="lg" variant="ghost" onClick={props.onDismiss}>
          Keep using {CURRENT_VERSION}
        </Button>
        <Button size="lg" data-autofocus onClick={props.flow.reset}>
          Quit and reopen
        </Button>
      </div>
      <details class="update-ready__details">
        <summary>Details</summary>
        <code>install_failed: the update helper exited with code 1</code>
      </details>
    </>
  );
}

/** The restart is bounded by a timeout in the updater. This is the state when it runs long. */
function SlowRestartPanel(props: PanelProps) {
  return (
    <>
      <span class="update-ready__status-icon" aria-hidden="true">
        <Spinner />
      </span>
      <h1 id={props.titleId} class="update-ready__title">
        The restart takes longer than usual
      </h1>
      <p class="update-ready__body">
        An agent or a helper process has not stopped yet. You can wait, or go back and restart later.
      </p>
      <div class="update-ready__actions">
        <Button size="lg" variant="ghost" onClick={props.onDismiss}>
          Go back to OpenBot
        </Button>
        <Button size="lg" variant="outline" data-autofocus onClick={props.flow.restart}>
          Wait
        </Button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Playground
// ---------------------------------------------------------------------------------------------

type Concept = "focused" | "handoff" | "safe-restart";

interface UpdateReadyStoryArgs {
  concept: Concept;
  outcome: RestartOutcome;
  restartMs: number;
  initial: RestartState;
}

function ConceptView(props: UpdateReadyStoryArgs & { onDismiss: () => void }) {
  const flow = createRestartFlow(() => ({
    outcome: props.outcome,
    restartMs: props.restartMs,
    initial: props.initial,
  }));
  return (
    <Switch>
      <Match when={props.concept === "focused"}>
        <FocusedConcept flow={flow} onDismiss={props.onDismiss} />
      </Match>
      <Match when={props.concept === "handoff"}>
        <HandoffConcept flow={flow} onDismiss={props.onDismiss} />
      </Match>
      <Match when={props.concept === "safe-restart"}>
        <SafeRestartConcept flow={flow} onDismiss={props.onDismiss} />
      </Match>
    </Switch>
  );
}

/** Mounts the screen over a stand-in app. "Later" returns to the app; "Show update" opens it again. */
function UpdateReadyStory(args: UpdateReadyStoryArgs) {
  const [run, setRun] = createSignal(1);
  const [open, setOpen] = createSignal(true);

  function show(): void {
    setRun((count) => count + 1);
    setOpen(true);
  }

  return (
    <div class="update-ready-playground">
      <Button variant="outline" onClick={show}>
        Show update
      </Button>
      <Show when={open() && run()} keyed>
        <ConceptView {...args} onDismiss={() => setOpen(false)} />
      </Show>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Launch flow: loading screen -> update check -> version handoff with the download -> app.
// ---------------------------------------------------------------------------------------------

type LaunchStage = "loading" | "update" | "app";

interface LaunchStoryArgs {
  hasUpdate: boolean;
  checkMs: number;
  downloadMs: number;
  downloadFails: boolean;
  outcome: RestartOutcome;
  restartMs: number;
}

/**
 * The loading screen stays while the app starts and the update check runs. With an update, the
 * download starts and the handoff screen follows the loading screen. "Later" goes to the app and
 * the download continues there. A successful restart starts the app again on the new version.
 */
function LaunchFlow(props: LaunchStoryArgs & { onReplay: () => void }) {
  const [stage, setStage] = createSignal<LaunchStage>("loading");
  const [started, setStarted] = createSignal(false);
  const [version, setVersion] = createSignal(CURRENT_VERSION);
  const [updateFound, setUpdateFound] = createSignal(false);
  const [justUpdated, setJustUpdated] = createSignal(false);
  const download = createDownload(() => ({ downloadMs: props.downloadMs, fails: props.downloadFails }));
  const flow = createRestartFlow(() => ({
    outcome: props.outcome,
    restartMs: props.restartMs,
    initial: "ready",
    onSuccess: relaunch,
  }));
  let checkTimer: number | undefined;

  function launch(): void {
    window.clearTimeout(checkTimer);
    setStarted(false);
    setStage("loading");
    checkTimer = window.setTimeout(() => {
      const found = props.hasUpdate && version() === CURRENT_VERSION;
      setUpdateFound(found);
      if (found) download.start();
      setStarted(true);
    }, props.checkMs);
  }

  function relaunch(): void {
    setVersion(NEXT_VERSION);
    setJustUpdated(true);
    flow.reset();
    launch();
  }

  function openUpdate(): void {
    if (flow.state() !== "ready") flow.reset();
    setStage("update");
  }

  onSettled(() => {
    launch();
    return () => window.clearTimeout(checkTimer);
  });

  return (
    <div class="update-launch">
      <LaunchApp
        covered={stage() !== "app"}
        version={version()}
        update={updateFound() ? download.status() : undefined}
        progress={download.progress()}
        justUpdated={justUpdated() && stage() === "app"}
        onOpenUpdate={openUpdate}
        onRetry={download.retry}
        onDismissNotice={() => setJustUpdated(false)}
        onReplay={props.onReplay}
      />
      <Show when={stage() === "loading"}>
        <AppLoadingScreen ready={started()} onExited={() => setStage(updateFound() ? "update" : "app")} />
      </Show>
      <Show when={stage() === "update"}>
        <HandoffConcept flow={flow} download={download} onDismiss={() => setStage("app")} />
      </Show>
    </div>
  );
}

interface LaunchAppProps {
  /** A screen covers the app: it leaves the tab order and the accessibility tree. */
  covered: boolean;
  version: string;
  update: DownloadStatus | undefined;
  progress: number;
  justUpdated: boolean;
  onOpenUpdate: () => void;
  onRetry: () => void;
  onDismissNotice: () => void;
  onReplay: () => void;
}

/** A stand-in for the app. The title bar keeps the update in reach after "Later". */
function LaunchApp(props: LaunchAppProps) {
  return (
    <div class="update-launch-app" inert={props.covered}>
      <header class="update-launch-app__bar">
        <span class="update-launch-app__name">
          <AppLogo variant="production" animation="none" class="update-launch-app__logo" />
          OpenBot {props.version}
        </span>
        <Switch>
          <Match when={props.update === "downloading"}>
            <Button size="sm" variant="ghost" onClick={props.onOpenUpdate}>
              <Spinner size="sm" />
              Downloading {NEXT_VERSION} · {Math.round(props.progress)}%
            </Button>
          </Match>
          <Match when={props.update === "failed"}>
            <Button size="sm" variant="ghost" onClick={props.onRetry}>
              <TriangleAlert />
              Download stopped · Try again
            </Button>
          </Match>
          <Match when={props.update === "done"}>
            <Button size="sm" onClick={props.onOpenUpdate}>
              Restart to update
            </Button>
          </Match>
        </Switch>
      </header>
      <div class="update-launch-app__body">
        <Show when={props.justUpdated}>
          <div class="update-launch-app__notice" role="status">
            <CircleCheck aria-hidden="true" />
            <span>Updated to {NEXT_VERSION}. Your agents continue their work.</span>
            <Button size="sm" variant="ghost" onClick={props.onDismissNotice}>
              See what’s new
            </Button>
          </div>
        </Show>
        <p class="update-ready__body">This is the app. Replay the launch to see the flow again.</p>
        <Button variant="outline" onClick={props.onReplay}>
          Replay launch
        </Button>
      </div>
    </div>
  );
}

function LaunchStory(args: LaunchStoryArgs) {
  const [run, setRun] = createSignal(1);
  return (
    <Show when={run()} keyed>
      <LaunchFlow {...args} onReplay={() => setRun((count) => count + 1)} />
    </Show>
  );
}

const meta = {
  title: "Concepts/UpdateReady",
  component: UpdateReadyStory,
  args: { concept: "focused", outcome: "success", restartMs: 1800, initial: "ready" },
  argTypes: {
    concept: { control: "inline-radio", options: ["focused", "handoff", "safe-restart"] },
    outcome: { control: "inline-radio", options: ["success", "failure", "slow"] },
    restartMs: { control: { type: "range", min: 0, max: 6000, step: 200 } },
    initial: { control: "select", options: ["ready", "restarting", "slow", "success", "failed"] },
  },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof UpdateReadyStory>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A: the issue reference. Logo, one sentence, the version and one prominent action. */
export const Focused: Story = {};

/** B: current → next version with three release highlights, so the user sees why to restart. */
export const VersionHandoff: Story = { args: { concept: "handoff" } };

/** C: lists the work a restart stops and offers "when idle" or "now", like a scheduled restart. */
export const SafeRestart: Story = { args: { concept: "safe-restart", outcome: "success" } };

/** `install_failed`: the app stays on the current version, with a relaunch and a way back. */
export const RestartFailed: Story = { args: { outcome: "failure", initial: "failed" } };

/** The restart runs past its timeout. The user can wait or go back; nothing blocks. */
export const RestartSlow: Story = { args: { outcome: "slow", initial: "slow" } };

/** After relaunch on the new version, before the What's new dialog. */
export const Updated: Story = { args: { initial: "success" } };

/** The restart is under way. Escape and "Later" are off, and a status region announces it. */
export const Restarting: Story = { args: { initial: "restarting" } };

const LAUNCH_ARGS: LaunchStoryArgs = {
  hasUpdate: true,
  checkMs: 2400,
  downloadMs: 6000,
  downloadFails: false,
  outcome: "success",
  restartMs: 1800,
};

const launchStory = (args: Partial<LaunchStoryArgs>): StoryObj<LaunchStoryArgs> => ({
  args: { ...LAUNCH_ARGS, ...args },
  argTypes: {
    checkMs: { control: { type: "range", min: 0, max: 8000, step: 200 } },
    downloadMs: { control: { type: "range", min: 0, max: 20000, step: 500 } },
    outcome: { control: "inline-radio", options: ["success", "failure", "slow"] },
    restartMs: { control: { type: "range", min: 0, max: 6000, step: 200 } },
  },
  parameters: { controls: { include: Object.keys(LAUNCH_ARGS) } },
  render: (storyArgs) => <LaunchStory {...storyArgs} />,
});

/** App open: loading screen, update found, download with the notes, restart, app on 0.26.0. */
export const LaunchWithUpdate = launchStory({});

/** No update: the loading screen goes straight to the app. */
export const LaunchNoUpdate = launchStory({ hasUpdate: false });

/** `download_failed` at 62%. "Try again" resumes; "Later" keeps the retry in the title bar. */
export const LaunchDownloadFails = launchStory({ downloadFails: true });
