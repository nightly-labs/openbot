import { type ComputerUsePermissionApp, LOCAL_SERVER_ID, type MacPermissionId } from "@openbot/contracts/ipc";
import { createSignal, onCleanup, onSettled, Show } from "solid-js";
import { Button, FolderOpen, GripVertical, Monitor, MousePointer2 } from "../../components/ui";
import { errorMessage } from "../../error-message";

/**
 * What the user has to do in the pane that just opened, and whether it worked.
 *
 * The list in System Settings has no way to browse for an application, so the way in is the one
 * macOS gives everybody: drag the bundle onto the list. The window carries that bundle as a card,
 * and it carries the name of the bundle the system holds responsible - in a development build that
 * is Electron, and a card that said "OpenBot" would send the user looking for a row that never
 * appears.
 */
const PERMISSION_HELP: Record<MacPermissionId, { title: string; pane: string; icon: typeof Monitor }> = {
  "screen-recording": {
    title: "Screen Recording",
    pane: "Screen & System Audio Recording",
    icon: Monitor,
  },
  accessibility: {
    title: "Accessibility",
    pane: "Accessibility",
    icon: MousePointer2,
  },
};

/** How often the driver is asked again while the user is in System Settings. */
const POLL_INTERVAL_MS = 1_000;

/**
 * Which permission the window was opened for. The window carries it in its own address, and a
 * value the window does not know falls back to screen recording: the first grant Computer Use
 * needs, and the pane the panel sends the user to when it has no better answer.
 */
export function permissionFromQuery(search: string): MacPermissionId {
  return new URLSearchParams(search).get("permission") === "accessibility" ? "accessibility" : "screen-recording";
}

export function ComputerUsePermissionHelp(props: { permission: MacPermissionId; sunshine?: boolean }) {
  const desktopApi = window.openbot;
  const permission = props.permission;
  const help = PERMISSION_HELP[permission];
  const PermissionIcon = help.icon;
  const [granted, setGranted] = createSignal(false);
  const [app, setApp] = createSignal<ComputerUsePermissionApp | null>(null);
  const [dragging, setDragging] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  let disposed = false;

  function close(): void {
    void desktopApi.closeComputerUsePermissionHelp();
  }

  // The grant is given in another application, so nothing tells this window it happened. Asking
  // again on a timer is what puts the accent on Done the moment the user is finished, in a window
  // that otherwise says the same thing whether they did it or not.
  async function read(): Promise<void> {
    try {
      if (props.sunshine) {
        const state = await desktopApi.remoteDesktop.checkSetup(LOCAL_SERVER_ID);
        if (!disposed)
          setGranted(state[permission === "screen-recording" ? "screenRecording" : "accessibility"] === "allowed");
      } else {
        const state = await desktopApi.getComputerUseState();
        if (!disposed) setGranted(state.permissions.some((entry) => entry.id === permission && entry.granted));
      }
    } catch {
      // Left as it was. A read that failed says nothing about the grant, and an error in this window
      // would only take the steps off the screen the user is working on.
    }
  }

  async function readApp(): Promise<void> {
    try {
      const next = await desktopApi.getComputerUsePermissionApp();
      if (!disposed) setApp(next);
    } catch {
      // No card. The steps still name the application, and the list still accepts a bundle dropped
      // from Finder.
    }
  }

  async function reveal(): Promise<void> {
    setError(null);
    try {
      await desktopApi.revealComputerUsePermissionApp();
    } catch (cause) {
      setError(errorMessage(cause, "The application could not be shown in Finder."));
    }
  }

  const closeOnEscape = (event: KeyboardEvent) => {
    if (event.key === "Escape") close();
  };

  window.addEventListener("keydown", closeOnEscape);
  const timer = setInterval(() => void read(), POLL_INTERVAL_MS);

  onSettled(() => {
    void read();
    void readApp();
  });
  onCleanup(() => {
    disposed = true;
    clearInterval(timer);
    window.removeEventListener("keydown", closeOnEscape);
  });

  return (
    <main class="computer-use-help" aria-labelledby="computer-use-help-title">
      <header class="computer-use-help-header">
        <span class="computer-use-help-icon" aria-hidden="true">
          <PermissionIcon />
        </span>
        <div>
          <h1 id="computer-use-help-title">Turn on {help.title}</h1>
          <p>System Settings is open at {help.pane}.</p>
        </div>
      </header>

      <Show when={app()}>
        {(bundle) => (
          <Button
            type="button"
            variant="ghost"
            class={`computer-use-drag-card${dragging() ? " is-dragging" : ""}`}
            draggable="true"
            aria-label={`Drag ${bundle().name} into System Settings, or press to show it in Finder`}
            onClick={() => void reveal()}
            onDragStart={(event) => {
              // The file leaves through the main process, which is the only side that has one. The
              // browser's own drag would carry nothing, so it must not start.
              event.preventDefault();
              setDragging(true);
              setError(null);
              void desktopApi
                .startComputerUsePermissionAppDrag()
                .catch((cause) => setError(errorMessage(cause, "The application could not be dragged.")))
                .finally(() => setDragging(false));
            }}
            onDragEnd={() => setDragging(false)}
          >
            <span class="computer-use-drag-handle" aria-hidden="true">
              <GripVertical />
            </span>
            <span class="computer-use-drag-icon" aria-hidden="true">
              <Show when={bundle().iconDataUrl} fallback={<Monitor />}>
                {(source) => <img src={source()} alt="" />}
              </Show>
            </span>
            <strong>{bundle().name}.app</strong>
            <span>Drag to add</span>
          </Button>
        )}
      </Show>

      <ol class="computer-use-help-steps">
        <li>
          <Show when={app()} fallback={<>Find {props.sunshine ? "Sunshine" : "OpenBot"} in the list.</>}>
            {(bundle) => <>Drag {bundle().name}.app into the list.</>}
          </Show>
        </li>
        <li>Turn the switch on.</li>
      </ol>

      <Show when={error()}>
        {(message) => (
          <p class="computer-use-help-status is-error" role="alert">
            {message()}
          </p>
        )}
      </Show>

      <footer class="computer-use-help-footer">
        <Show when={app()}>
          <Button type="button" variant="outline" size="sm" onClick={() => void reveal()}>
            <FolderOpen aria-hidden="true" />
            Show in Finder
          </Button>
        </Show>
        <Button type="button" variant={granted() ? "default" : "outline"} size="sm" onClick={close}>
          Done
        </Button>
      </footer>
    </main>
  );
}
