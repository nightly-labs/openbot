import { render } from "@solidjs/web";
import { createSignal, onCleanup, Show } from "solid-js";
import { decodeStatusFile, type StatusFile } from "./model";
import { ISSUES_URL, StatusPage } from "./StatusPage";
import "./document.css";

const RELOAD_MS = 60_000;

function StatusApp() {
  const [status, setStatus] = createSignal<StatusFile | null>(null);
  const [failed, setFailed] = createSignal(false);
  const [now, setNow] = createSignal(new Date().toISOString());

  const load = async () => {
    try {
      const response = await fetch("status.json", { cache: "no-store" });
      if (!response.ok) throw new Error(`status.json: HTTP ${response.status}`);
      setStatus(decodeStatusFile(await response.json()));
      setFailed(false);
    } catch {
      setFailed(true);
    }
    setNow(new Date().toISOString());
  };

  void load();
  const timer = setInterval(() => void load(), RELOAD_MS);
  onCleanup(() => clearInterval(timer));

  return (
    <Show
      when={status()}
      fallback={
        <Show when={failed()}>
          <main class="status-load-error">
            <p>
              The status did not load. <a href={ISSUES_URL}>See the incident issues on GitHub</a>.
            </p>
          </main>
        </Show>
      }
    >
      {(loaded) => <StatusPage status={loaded()} now={now()} />}
    </Show>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("The status page root element was not found.");
render(() => <StatusApp />, root);
