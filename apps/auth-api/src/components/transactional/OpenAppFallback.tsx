import { Portal } from "@solidjs/web";
import { type Accessor, createSignal, createUniqueId, onCleanup, Show } from "solid-js";
import { detectDownloadPlatform } from "../../lib/download-platforms";
import { OPENBOT_DOWNLOAD_LINKS } from "../../lib/landing-links";
import { Button } from "../ui/button";
import type { OpenAppFallbackText } from "./page-text";

/** How long the app has to take over before the page offers help. The same as `PluginOpenButtons`. */
const OPEN_APP_HINT_DELAY_MS = 1200;

export interface OpenAppFallback {
  /** Starts the timer. Call it when the visitor presses a button that opens an `openbot://` link. */
  arm: () => void;
  open: Accessor<boolean>;
  close: () => void;
}

/**
 * The timer behind the "Nothing opened?" dialog. It is the pattern of `PluginOpenButtons`: the page
 * cannot ask if the app is installed, so it waits a short time and cancels the timer when the tab
 * becomes hidden, which is what occurs when the app takes over. The page does not probe the scheme.
 */
export function createOpenAppFallback(): OpenAppFallback {
  const [open, setOpen] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  const cancel = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  onCleanup(cancel);

  const arm = () => {
    cancel();
    const stop = () => {
      cancel();
      window.removeEventListener("pagehide", stop);
      document.removeEventListener("visibilitychange", onVisibility);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") stop();
    };
    window.addEventListener("pagehide", stop);
    document.addEventListener("visibilitychange", onVisibility);
    timer = setTimeout(() => {
      stop();
      setOpen(true);
    }, OPEN_APP_HINT_DELAY_MS);
  };

  return { arm, open, close: () => setOpen(false) };
}

/**
 * The modal dialog that shows when the app did not open. It uses the `plugin-dialog` styles and the
 * same behaviour as `PluginOpenButtons`: the platform `<dialog>` holds the focus, Escape and "Not now"
 * close it, and a press on the backdrop closes it. The download button gets the focus.
 */
export function OpenAppFallbackDialog(props: { fallback: OpenAppFallback; text: OpenAppFallbackText }) {
  const titleId = createUniqueId();
  let dialog: HTMLDialogElement | undefined;
  const platform = () => detectDownloadPlatform(globalThis.navigator ?? {}) ?? "macos";

  // A `ref` runs before the element is in the document, and a detached dialog cannot open as modal.
  const openDialog = (element: HTMLDialogElement) => {
    dialog = element;
    element.addEventListener("click", (event) => {
      if (event.target === element) element.close();
    });
    queueMicrotask(() => {
      if (!element.open) element.showModal();
    });
  };

  return (
    <Show when={props.fallback.open()}>
      {/* Outside the page boxes: the header animates a transform, and a modal dialog centres in a
          transformed ancestor instead of the window. */}
      <Portal>
        <dialog ref={openDialog} class="plugin-dialog" aria-labelledby={titleId} onClose={props.fallback.close}>
          <h2 class="plugin-dialog-title" id={titleId}>
            {props.text.title}
          </h2>
          <p class="plugin-dialog-copy">{props.text.body}</p>
          <div class="plugin-dialog-actions">
            <button class="plugin-dialog-dismiss" type="button" onClick={() => dialog?.close()}>
              {props.text.dismiss}
            </button>
            <Button autofocus href={OPENBOT_DOWNLOAD_LINKS[platform()]} variant="primary" size="sm" icon="download">
              {props.text.download[platform()]}
            </Button>
          </div>
        </dialog>
      </Portal>
    </Show>
  );
}
