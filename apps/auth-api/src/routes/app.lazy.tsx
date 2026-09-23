import { createLazyFileRoute } from "@tanstack/solid-router";
import { createSignal, lazy, onSettled, Show } from "solid-js";
import "../../../../src/renderer/src/features/web-client/web-client.css";

const WebApp = lazy(() => import("@openbot/renderer-web").then((module) => ({ default: module.WebApp })));

export const Route = createLazyFileRoute("/app")({ component: BrowserAppPage });
function BrowserAppPage() {
  const [mounted, setMounted] = createSignal(false);
  onSettled(() => {
    setMounted(true);
  });
  return (
    <div id="root">
      <Show when={mounted()} fallback={<p role="status">Loading OpenBot…</p>}>
        <WebApp />
      </Show>
    </div>
  );
}
