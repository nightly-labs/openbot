import { createOpenBotPluginUrl } from "@openbot/contracts/plugin-links";
import { Portal } from "@solidjs/web";
import { createSignal, createUniqueId, onCleanup, Show } from "solid-js";
import { DOWNLOAD_PLATFORMS, detectDownloadPlatform } from "../../lib/download-platforms";
import { Button } from "../ui/button";

export interface PluginOpenButtonsProps {
  slug: string;
  name: string;
}

/** How long the app is given to take over before the page offers the download instead. */
const DOWNLOAD_HINT_DELAY_MS = 1200;

/**
 * `Open in OpenBot`, and the download offer that appears only after it is pressed.
 *
 * The page cannot ask whether the app is installed, and it must not try: a hidden frame that probes
 * the scheme is a fingerprint. So the offer is a reveal on a timer, cancelled when the tab is hidden
 * - which is what happens when the app really does take over. A visitor who has OpenBot never sees
 * it, and a visitor who does not sees it a moment later. Neither is redirected anywhere.
 *
 * The offer is a modal `<dialog>` rather than a line on the page. A visitor sees it only after the
 * page failed to do the one thing they asked for, so it is the whole subject at that moment, and a
 * note beside the button reads as debris instead. The element is the platform's own: it takes the
 * focus, holds it, closes on Escape and gives the focus back to the button, none of which this file
 * has to write or keep true.
 *
 * The address is built from the slug through the shared helper, never read from catalog data, so a
 * listing cannot put another link behind this button.
 */
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

  /**
   * Opened as modal rather than with the markup's `open`, which is the non-modal dialog: no
   * backdrop, no focus, and the page still reachable behind it. It waits a microtask because a
   * `ref` runs before the element is in the document, and a detached dialog cannot be shown.
   *
   * The press-away is bound here rather than as `onClick`, because it is not a control: the
   * backdrop is the dialog's own box, so a press outside the panel lands on the element itself.
   * A keyboard closes this dialog with Escape and with `Not now`, both of which the element and
   * the markup already carry.
   */
  const openDialog = (element: HTMLDialogElement) => {
    dialog = element;
    element.addEventListener("click", (event) => {
      if (event.target === element) element.close();
    });
    queueMicrotask(() => {
      if (!element.open) element.showModal();
    });
  };

  // The wrapper carries no class of its own: what it holds together is the button and the offer
  // that follows it, and the spacing is the hero line's own.
  return (
    <div>
      <div class="plugin-actions-row">
        <Button
          href={createOpenBotPluginUrl(props.slug)}
          variant="primary"
          size="lg"
          icon="open"
          onClick={armDownloadHint}
        >
          Open in OpenBot
        </Button>
      </div>

      <Show when={showDownload()}>
        {/* Out of this page's own boxes, because the header it stands in animates a transform, and
            a transformed ancestor is what a modal dialog then centres itself in, not the window. */}
        <Portal>
          <dialog
            ref={openDialog}
            class="plugin-dialog"
            aria-labelledby={titleId}
            onClose={() => setShowDownload(false)}
          >
            <h2 class="plugin-dialog-title" id={titleId}>
              Nothing opened?
            </h2>
            <p class="plugin-dialog-copy">
              {props.name} installs from inside OpenBot. Get the app, then open this plugin from its Plugins tab.
            </p>
            <div class="plugin-dialog-actions">
              <button class="plugin-dialog-dismiss" type="button" onClick={() => dialog?.close()}>
                Not now
              </button>
              {/* Where the dialog puts the focus, because it is the thing the visitor came for.
                  Without it the modal would open on `Not now`, which is the way out. */}
              <Button autofocus href={platform().href} variant="primary" size="sm" icon="download">
                {platform().action}
              </Button>
            </div>
          </dialog>
        </Portal>
      </Show>
    </div>
  );
}
