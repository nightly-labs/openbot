import { Portal } from "@solidjs/web";
import { createSignal, createUniqueId, onCleanup, Show } from "solid-js";
import { DOWNLOAD_PLATFORMS, detectDownloadPlatform } from "../../lib/download-platforms";
import { Button } from "../ui/button";

export interface PluginOpenButtonsProps {
  href: string;
  label: string;
  browserHref?: string;
  downloadCopy: string;
  text?: PluginOpenButtonsText;
}

export interface PluginOpenButtonsText {
  browser: string;
  notOpened: string;
  dismiss: string;
  download: (platform: string) => string;
}

const ENGLISH_TEXT: PluginOpenButtonsText = {
  browser: "Open in browser",
  notOpened: "Nothing opened?",
  dismiss: "Not now",
  download: (platform) => `Download for ${platform}`,
};

const DOWNLOAD_HINT_DELAY_MS = 1200;

export function PluginOpenButtons(props: PluginOpenButtonsProps) {
  const [showDownload, setShowDownload] = createSignal(false);
  const titleId = createUniqueId();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let dialog: HTMLDialogElement | undefined;

  const cancel = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  onCleanup(cancel);

  const platform = () => DOWNLOAD_PLATFORMS[detectDownloadPlatform(globalThis.navigator ?? {}) ?? "macos"];
  const text = () => props.text ?? ENGLISH_TEXT;

  const armDownloadHint = () => {
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
      setShowDownload(true);
    }, DOWNLOAD_HINT_DELAY_MS);
  };

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
    <div>
      <div class="plugin-actions-row">
        <Button href={props.href} variant="primary" size="lg" icon="open" onClick={armDownloadHint}>
          {props.label}
        </Button>
        <Show when={props.browserHref}>
          {(href) => (
            <Button href={href()} variant="secondary" size="lg" icon="arrow-right">
              {text().browser}
            </Button>
          )}
        </Show>
      </div>

      <Show when={showDownload()}>
        <Portal>
          <dialog
            ref={openDialog}
            class="plugin-dialog"
            aria-labelledby={titleId}
            onClose={() => setShowDownload(false)}
          >
            <h2 class="plugin-dialog-title" id={titleId}>
              {text().notOpened}
            </h2>
            <p class="plugin-dialog-copy">{props.downloadCopy}</p>
            <div class="plugin-dialog-actions">
              <button class="plugin-dialog-dismiss" type="button" onClick={() => dialog?.close()}>
                {text().dismiss}
              </button>
              <Button autofocus href={platform().href} variant="primary" size="sm" icon="download">
                {text().download(platform().label)}
              </Button>
            </div>
          </dialog>
        </Portal>
      </Show>
    </div>
  );
}
