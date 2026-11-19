import { Button } from "@openbot/ui/button";
import { useText } from "@openbot/ui/text";
import { createSignal, onSettled, Show, untrack } from "solid-js";

/** How long a wait lasts before the notice shows, as for the connection toast of a first server load. */
const SLOW_LOAD_MS = 10_000;

/**
 * When the current wait started: the start screen of this visit to `/app`, or a "Try again". The notice
 * that starts the wait sets it, and a notice that takes its place uses it, so the notice shows once after
 * the same wait. Before a notice sets it, the wait counts from the page open.
 */
let waitStartedAt = 0;

/**
 * Shows over the start screen of the web client when the start takes too long, such as for a download or
 * a request that gets no answer. A slow start can still end: the notice goes with the start screen. The
 * browser keeps a stalled code download for the page, so only a reload starts it again.
 */
export function WebSlowLoadNotice(props: { startsWait?: boolean }) {
  const { t } = useText();
  const startsWait = untrack(() => props.startsWait === true);
  const waited = () => performance.now() - waitStartedAt;
  // The route's notice also renders on the server, so it starts hidden. The web client's notice takes the
  // place of the route's one, so it shows at once when the wait is over.
  const [shown, setShown] = createSignal(!startsWait && waited() >= SLOW_LOAD_MS);
  onSettled(() => {
    if (startsWait) waitStartedAt = performance.now();
    const timer = setTimeout(() => setShown(true), Math.max(0, SLOW_LOAD_MS - waited()));
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
