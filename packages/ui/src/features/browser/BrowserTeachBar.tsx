import { Button, Square, X } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createEffect, createSignal, Show } from "solid-js";
import type { BrowserTeachBarProps } from "./browser-full-view-types";

function elapsedLabel(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * The bar above the page while the user shows a task to the agent. Before the recording it starts one.
 * During the recording it shows the time, and its button ends the recording and saves the steps.
 */
export function BrowserTeachBar(props: BrowserTeachBarProps) {
  const { t } = useText();
  const [now, setNow] = createSignal(Date.now());
  createEffect(
    () => props.startedAt,
    (startedAt) => {
      if (startedAt === null) return;
      setNow(Date.now());
      const timer = window.setInterval(() => setNow(Date.now()), 1000);
      return () => window.clearInterval(timer);
    },
  );
  const closeLabel = () => (props.startedAt === null ? t("common.close") : t("browser.teach.discard"));
  return (
    <div class="browser-teach-bar" role="status" data-recording={props.startedAt === null ? undefined : ""}>
      <Show
        when={props.startedAt}
        fallback={
          <>
            <span class="browser-teach-text">{t("browser.teach.intro", { name: props.agentName })}</span>
            <Button variant="destructive" size="sm" loading={props.pending} onClick={() => props.onStart()}>
              <span class="browser-teach-dot" aria-hidden="true" />
              {t("browser.teach.start")}
            </Button>
          </>
        }
      >
        {(startedAt) => (
          <>
            <span class="browser-teach-text">{t("browser.teach.recording", { name: props.agentName })}</span>
            <Button
              variant="destructive"
              size="sm"
              class="browser-teach-stop"
              aria-label={t("browser.teach.stop")}
              title={t("browser.teach.stop")}
              loading={props.pending}
              onClick={() => props.onSave()}
            >
              <Square aria-hidden="true" />
              <span aria-hidden="true">{elapsedLabel(now() - startedAt())}</span>
            </Button>
          </>
        )}
      </Show>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={closeLabel()}
        title={closeLabel()}
        disabled={props.pending}
        onClick={() => props.onClose()}
      >
        <X aria-hidden="true" />
      </Button>
    </div>
  );
}
