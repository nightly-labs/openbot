import { Portal } from "@solidjs/web";
import { type Accessor, createSignal, createUniqueId, onCleanup, Show } from "solid-js";
import { detectDownloadPlatform } from "../../lib/download-platforms";
import { OPENBOT_DOWNLOAD_LINKS } from "../../lib/landing-links";
import { Button } from "../ui/button";
import type { OpenAppFallbackText } from "./page-text";

const OPEN_APP_HINT_DELAY_MS = 1200;

export interface OpenAppFallback {
  arm: () => void;
  open: Accessor<boolean>;
  close: () => void;
}

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

export function OpenAppFallbackDialog(props: { fallback: OpenAppFallback; text: OpenAppFallbackText }) {
  const titleId = createUniqueId();
  let dialog: HTMLDialogElement | undefined;
  const platform = () => detectDownloadPlatform(globalThis.navigator ?? {}) ?? "macos";

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
