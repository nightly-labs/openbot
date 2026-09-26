import { type ComputerUsePermissionApp, LOCAL_SERVER_ID, type MacPermissionId } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import { Button, FolderOpen, GripVertical, Monitor, MousePointer2 } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createSignal, onCleanup, onSettled, Show } from "solid-js";
import { computerUsePort } from "./computer-use-port";

/**
 * What the user has to do in the pane that just opened, and whether it worked.
 *
 * The list in System Settings has no way to browse for an application, so the way in is the one
 * macOS gives everybody: drag the bundle onto the list. The window carries that bundle as a card,
 * and it carries the name of the bundle the system holds responsible - in a development build that
 * is Electron, and a card that said "OpenBot" would send the user looking for a row that never
 * appears.
 */
const PERMISSION_HELP: Record<MacPermissionId, { title: AppTextKey; pane: AppTextKey; icon: typeof Monitor }> = {
  "screen-recording": {
    title: "computerUse.permission.screenRecording.title",
    pane: "computerUse.permission.screenRecording.pane",
    icon: Monitor,
  },
  accessibility: {
    title: "computerUse.permission.accessibility.title",
    pane: "computerUse.permission.accessibility.pane",
    icon: MousePointer2,
  },
};

/** The names of the applications this window can point at. They are product names. */
const SUNSHINE_APP_NAME = "Sunshine";
const OPENBOT_APP_NAME = "OpenBot";

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
  const { t, errorMessage } = useText();
  const permission = props.permission;
  const help = PERMISSION_HELP[permission];
  const PermissionIcon = help.icon;
  const [granted, setGranted] = createSignal(false);
  const [app, setApp] = createSignal<ComputerUsePermissionApp | null>(null);
  const [dragging, setDragging] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  let disposed = false;
  let reading = false;

  function close(): void {
    void computerUsePort().computerUse.closePermissionHelp();
  }

  // Computer Use can poll its driver. Sunshine checks start the runtime when it is idle,
  // so refresh those only on open and when the user returns from System Settings.
  async function read(): Promise<void> {
    if (reading || disposed) return;
    reading = true;
    try {
      if (props.sunshine) {
        const state = await computerUsePort().remoteDesktop.checkSetup(LOCAL_SERVER_ID);
        if (!disposed)
          setGranted(state[permission === "screen-recording" ? "screenRecording" : "accessibility"] === "allowed");
      } else {
        const state = await computerUsePort().computerUse.getState();
        if (!disposed) setGranted(state.permissions.some((entry) => entry.id === permission && entry.granted));
      }
    } catch {
      // Left as it was. A read that failed says nothing about the grant, and an error in this window
      // would only take the steps off the screen the user is working on.
      if (!disposed && props.sunshine) setGranted(false);
    } finally {
      reading = false;
    }
  }

  async function readApp(): Promise<void> {
    try {
      const next = await computerUsePort().computerUse.getPermissionApp();
      if (!disposed) setApp(next);
    } catch {
      // No card. The steps still name the application, and the list still accepts a bundle dropped
      // from Finder.
    }
  }

  async function reveal(): Promise<void> {
    setError(null);
    try {
      await computerUsePort().computerUse.revealPermissionApp();
    } catch (cause) {
      setError(errorMessage(cause, t("computerUse.help.revealFailed")));
    }
  }

  const closeOnEscape = (event: KeyboardEvent) => {
    if (event.key === "Escape") close();
  };

  window.addEventListener("keydown", closeOnEscape);
  const refreshOnFocus = () => void read();
  const timer = props.sunshine ? undefined : setInterval(() => void read(), POLL_INTERVAL_MS);
  if (props.sunshine) window.addEventListener("focus", refreshOnFocus);

  onSettled(() => {
    void read();
    void readApp();
  });
  onCleanup(() => {
    disposed = true;
    clearInterval(timer);
    window.removeEventListener("focus", refreshOnFocus);
    window.removeEventListener("keydown", closeOnEscape);
  });

  return (
    <main class="computer-use-help" aria-labelledby="computer-use-help-title">
      <header class="computer-use-help-header">
        <span class="computer-use-help-icon" aria-hidden="true">
          <PermissionIcon />
        </span>
        <div>
          <h1 id="computer-use-help-title">{t("computerUse.help.title", { permission: t(help.title) })}</h1>
          <p>{t("computerUse.help.paneOpen", { pane: t(help.pane) })}</p>
        </div>
      </header>

      <Show when={app()}>
        {(bundle) => (
          <Button
            type="button"
            variant="ghost"
            class={`computer-use-drag-card${dragging() ? " is-dragging" : ""}`}
            draggable="true"
            aria-label={t("computerUse.help.dragLabel", { name: bundle().name })}
            onClick={() => void reveal()}
            onDragStart={(event) => {
              // The file leaves through the main process, which is the only side that has one. The
              // browser's own drag would carry nothing, so it must not start.
              event.preventDefault();
              setDragging(true);
              setError(null);
              void computerUsePort()
                .computerUse.startPermissionAppDrag()
                .catch((cause) => setError(errorMessage(cause, t("computerUse.help.dragFailed"))))
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
            <strong>{`${bundle().name}.app`}</strong>
            <span>{t("computerUse.help.dragToAdd")}</span>
          </Button>
        )}
      </Show>

      <ol class="computer-use-help-steps">
        <li>
          <Show
            when={app()}
            fallback={t("computerUse.help.findInList", {
              name: props.sunshine ? SUNSHINE_APP_NAME : OPENBOT_APP_NAME,
            })}
          >
            {(bundle) => t("computerUse.help.dragIntoList", { name: bundle().name })}
          </Show>
        </li>
        <li>{t("computerUse.help.turnOn")}</li>
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
            {t("computerUse.help.showInFinder")}
          </Button>
        </Show>
        <Button type="button" variant={granted() ? "default" : "outline"} size="sm" onClick={close}>
          {t("common.done")}
        </Button>
      </footer>
    </main>
  );
}
