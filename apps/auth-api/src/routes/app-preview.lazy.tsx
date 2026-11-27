import { DEFAULT_APP_LANGUAGE } from "@openbot/contracts/app-language";
import { loadLocale, resolveLocale } from "@openbot/i18n";
import { createLazyFileRoute } from "@tanstack/solid-router";
import { createSignal, lazy, onSettled, Show } from "solid-js";

const OpenBotPlayground = lazy(() =>
  Promise.all([
    import("@openbot/renderer-preview"),
    loadLocale(resolveLocale(DEFAULT_APP_LANGUAGE, navigator.language)).catch(() => undefined),
  ]).then(([module]) => ({ default: module.OpenBotPlayground })),
);

export const Route = createLazyFileRoute("/app-preview")({ component: AppPreviewPage });

export function AppPreviewPage() {
  const [mounted, setMounted] = createSignal(false);
  onSettled(() => {
    setMounted(true);
  });

  return (
    <div id="root" class="openbot-playground-root" data-preview-variant="landing">
      <Show
        when={mounted()}
        fallback={<div class="openbot-playground-loading" role="status" aria-label="Loading OpenBot preview" />}
      >
        <OpenBotPlayground variant="landing" />
      </Show>
    </div>
  );
}
