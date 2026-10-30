import { AppLoadingShell } from "@openbot/ui/features/account/AppLoadingShell";
import { Dynamic } from "@solidjs/web";
import { createLazyFileRoute } from "@tanstack/solid-router";
import { type Component, createSignal, flush, lazy, onSettled, Show } from "solid-js";
import { showSavedAppearance } from "../../../../src/renderer/src/features/web-client/web-appearance-preference";
import "../../../../src/renderer/src/features/web-client/web-client.css";

const loadWebApp = () => import("@openbot/renderer-web");
// The saved language loads with the code, so the first screen is not English for a moment. If it
// fails, the web client starts in English and tries again when it shows the language.
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
  // The Bloub library, which draws the loading crew, runs only in the browser, so the Worker must never
  // import it. The Worker sends the screen's background, and the browser adds the crew after hydration.
  // The web client shows its own crew on the same clock, so the crew does not start again.
  const [crew, setCrew] = createSignal<Component>();
  // The loading screen takes the saved theme at once. The public pages stay dark after the user leaves.
  onSettled(() => showSavedAppearance());
  onSettled(() => {
    void loadWebApp();
    void import("@openbot/ui/features/account/AppLoadingScreen")
      .then((module) => {
        setCrew(() => module.AppLoadingScreen);
        // Show the crew before the web client starts: the page keeps this fallback while the web
        // client's code loads.
        flush();
      })
      // Without the crew, the web client still starts.
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
