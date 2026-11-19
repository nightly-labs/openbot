import { AppLoadingShell } from "@openbot/ui/features/account/AppLoadingShell";
import { Dynamic } from "@solidjs/web";
import { createLazyFileRoute } from "@tanstack/solid-router";
import { type Component, createSignal, flush, lazy, onSettled, Show } from "solid-js";
import { showSavedAppearance } from "../../../../src/renderer/src/features/web-client/web-appearance-preference";
import { markSoftwareRendering } from "../../../../src/renderer/src/features/web-client/web-software-rendering";
import "../../../../src/renderer/src/features/web-client/web-client.css";

const loadWebApp = () => import("@openbot/renderer-web");
const WebApp = lazy(() =>
  loadWebApp().then((module) =>
    module
      .loadSavedLanguage()
      .catch(() => undefined)
      .then(() => ({ default: module.WebApp })),
  ),
);

export const Route = createLazyFileRoute("/app")({ component: BrowserAppPage });
function BrowserAppPage() {
  const [mounted, setMounted] = createSignal(false);
  const [crew, setCrew] = createSignal<Component>();
  onSettled(() => showSavedAppearance());
  onSettled(() => markSoftwareRendering());
  onSettled(() => {
    void loadWebApp();
    void import("@openbot/ui/features/account/AppLoadingScreen")
      .then((module) => {
        setCrew(() => module.AppLoadingScreen);
        flush();
      })
      .catch(() => undefined)
      .finally(() => setMounted(true));
  });
  return (
    <div id="root">
      <Show
        when={mounted()}
        fallback={
          <div class="web-app">
            <Show when={crew()} fallback={<AppLoadingShell />}>
              {(screen) => <Dynamic component={screen()} />}
            </Show>
          </div>
        }
      >
        <WebApp />
      </Show>
    </div>
  );
}
