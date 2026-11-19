import { Button } from "@openbot/ui/button";
import { useText } from "@openbot/ui/text";
import { createSignal, onSettled, Show, untrack } from "solid-js";

const SLOW_LOAD_MS = 10_000;

let waitStartedAt = 0;

export function WebSlowLoadNotice(props: { startsWait?: boolean }) {
  const { t } = useText();
  const startsWait = untrack(() => props.startsWait === true);
  const waited = () => performance.now() - waitStartedAt;
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
