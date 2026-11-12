import type { WindowControlsState } from "@openbot/contracts/ipc";
import { WindowControls } from "@openbot/ui/features/window/WindowControls";
import { type JSX, Portal } from "@solidjs/web";
import { createEffect, createMemo, createSignal, Show } from "solid-js";
import { usePlatform } from "../../platform";
import { windowControlsPort } from "./window-controls-port";

/**
 * How far the window buttons take the top of the window from its inline end: their offset from the
 * edge and their width. Each top row that reaches them keeps it clear (`window.css`).
 */
const ROOM_PROPERTY = "--window-controls-room";
/** On the root while the buttons show, so that only then do the top rows draw the line before them. */
const SHOWN_ATTRIBUTE = "data-window-controls";

/**
 * The window buttons of an app or chat window on Windows, which has no system title bar
 * (`src/main/window-buttons.ts`). A macOS window has the system buttons, a Linux window has the system
 * title bar, and the web client has neither, so there this renders nothing. The buttons are in a
 * portal, so no layer of the page can cover them, and they hide in full screen, as system buttons do.
 */
export function DesktopWindowControls(): JSX.Element {
  const platform = usePlatform();
  const [state, setState] = createSignal<WindowControlsState>({ maximized: false, fullScreen: false });
  const drawsButtons = createMemo(() => platform.appInfo()?.platform === "win32");
  createEffect(
    () => drawsButtons(),
    (draws) => {
      if (!draws) return;
      const port = windowControlsPort();
      const stop = port.onState(setState);
      // An event sent while the page loaded is lost, so the page asks once.
      port
        .getState()
        .then(setState)
        .catch(() => undefined);
      return stop;
    },
  );
  // A failed request leaves the window as it is, and the user can press the button again.
  const send = (request: () => Promise<void>) => void request().catch(() => undefined);
  // The room follows the group itself, so it is right for any button size, gap or offset. It is
  // written only when it changes, so the layout that it starts does not report the same size again.
  const measure = (group: HTMLFieldSetElement) => {
    const root = document.documentElement;
    let written = "";
    const observer = new ResizeObserver(() => {
      const offset = Number.parseFloat(getComputedStyle(group).insetInlineEnd) || 0;
      const room = `${group.getBoundingClientRect().width + offset}px`;
      if (room === written) return;
      written = room;
      root.style.setProperty(ROOM_PROPERTY, room);
    });
    // The border box, so a change of the padding before the buttons also writes the room.
    observer.observe(group, { box: "border-box" });
    root.setAttribute(SHOWN_ATTRIBUTE, "");
    return () => {
      observer.disconnect();
      root.style.removeProperty(ROOM_PROPERTY);
      root.removeAttribute(SHOWN_ATTRIBUTE);
    };
  };
  const shown = createMemo(() => drawsButtons() && !state().fullScreen);
  const [group, setGroup] = createSignal<HTMLFieldSetElement>();
  createEffect(
    () => (shown() ? group() : undefined),
    (element) => (element ? measure(element) : undefined),
  );
  return (
    <Show when={shown()}>
      <Portal>
        <WindowControls
          ref={setGroup}
          maximized={state().maximized}
          onMinimize={() => send(() => windowControlsPort().minimize())}
          onToggleMaximize={() => send(() => windowControlsPort().toggleMaximize())}
          onClose={() => send(() => windowControlsPort().close())}
        />
      </Portal>
    </Show>
  );
}
