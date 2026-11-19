import { Button } from "@openbot/ui/button";
import { useText } from "@openbot/ui/text";
import { createSignal, onSettled, Show } from "solid-js";

/** The wait from the page open, as for the connection toast of a first server load. */
const SLOW_LOAD_MS = 10_000;

/**
 * Shows over the start screen of the web client when the start takes too long, such as for a download or
 * a request that gets no answer. A slow start can still end: the notice goes with the start screen. The
 * browser keeps a stalled code download for the page, so only a reload starts it again.
 */
export function WebSlowLoadNotice() {
  const { t } = useText();
  const [shown, setShown] = createSignal(false);
  // The page start, not the mount: the route and the web client each show the notice at the same time.
  onSettled(() => {
    const timer = setTimeout(() => setShown(true), Math.max(0, SLOW_LOAD_MS - performance.now()));
    return () => clearTimeout(timer);
  });
  return (
    <Show when={shown()}>
      <section class="server-connection-toast web-slow-load-notice" role="alert">
        <strong class="server-connection-toast-title">{t("webClient.slowLoad.title")}</strong>
        <p class="server-connection-toast-body">{t("webClient.slowLoad.body")}</p>
        <div class="server-connection-toast-actions ui-toast-card-actions">
          <Button variant="default" size="sm" onClick={() => window.location.reload()}>
            {t("webClient.slowLoad.reload")}
          </Button>
        </div>
      </section>
    </Show>
  );
}
