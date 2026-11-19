import { Button } from "@openbot/ui/button";
import { useText } from "@openbot/ui/text";
import { createSignal, onSettled, Show, untrack } from "solid-js";

/** The wait from the start of the visit, as for the connection toast of a first server load. */
const SLOW_LOAD_MS = 10_000;

/**
 * When the start screen of this visit to `/app` showed. The route's notice sets it, and the web client's
 * notice uses it, so the notice shows once after the same wait. Before the route sets it, the wait counts
 * from the page open.
 */
let visitStartedAt = 0;

/**
 * Shows over the start screen of the web client when the start takes too long, such as for a download or
 * a request that gets no answer. A slow start can still end: the notice goes with the start screen. The
 * browser keeps a stalled code download for the page, so only a reload starts it again.
 */
export function WebSlowLoadNotice(props: { visitStart?: boolean }) {
  const { t } = useText();
  const visitStart = untrack(() => props.visitStart === true);
  const waited = () => performance.now() - visitStartedAt;
  // The route's notice also renders on the server, so it starts hidden. The web client's notice takes the
  // place of the route's one, so it shows at once when the wait is over.
  const [shown, setShown] = createSignal(!visitStart && waited() >= SLOW_LOAD_MS);
  onSettled(() => {
    if (visitStart) visitStartedAt = performance.now();
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
