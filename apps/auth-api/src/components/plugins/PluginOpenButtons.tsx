import { createOpenBotPluginUrl } from "@openbot/contracts/plugin-links";
import { createSignal, onCleanup, Show } from "solid-js";
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
 * The address is built from the slug through the shared helper, never read from catalog data, so a
 * listing cannot put another link behind this button.
 */
export function PluginOpenButtons(props: PluginOpenButtonsProps) {
  const [showDownload, setShowDownload] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

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

  // The wrapper carries no class of its own: what it holds together is the button and the offer
  // that follows it, and the spacing is the hero line's and the hint's own.
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
        {/* Announced when it arrives, because it appears after the press rather than with the page. */}
        <p class="plugin-download-hint" role="status">
          <span>Nothing opened? {props.name} installs from inside OpenBot.</span>
          <Button href={platform().href} variant="secondary" size="sm" icon="download">
            {platform().action}
          </Button>
        </p>
      </Show>
    </div>
  );
}
