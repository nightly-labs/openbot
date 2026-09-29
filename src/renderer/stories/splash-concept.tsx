import { Button } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createSignal, onSettled, Show } from "solid-js";

interface SplashPlaygroundProps {
  /** How long the simulated app takes to load. */
  readyAfterMs: number;
  children: (ready: () => boolean, onExited: () => void) => JSX.Element;
}

/** Mounts a splash, marks the app ready after a delay, and replays the run on request. */
export function SplashPlayground(props: SplashPlaygroundProps) {
  const [run, setRun] = createSignal(0);
  const [ready, setReady] = createSignal(false);
  const [visible, setVisible] = createSignal(true);
  let readyTimer: number | undefined;

  function start(): void {
    window.clearTimeout(readyTimer);
    setReady(false);
    setVisible(true);
    setRun((count) => count + 1);
    readyTimer = window.setTimeout(() => setReady(true), props.readyAfterMs);
  }

  onSettled(() => {
    start();
    return () => window.clearTimeout(readyTimer);
  });

  return (
    <div class="relative grid min-h-screen place-items-center" style={{ background: "var(--openbot-bg-canvas)" }}>
      <Button variant="outline" onClick={start}>
        Replay
      </Button>
      <Show when={visible() && run()} keyed>
        {props.children(ready, () => setVisible(false))}
      </Show>
    </div>
  );
}
