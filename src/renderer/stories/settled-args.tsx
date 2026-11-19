import type { JSX } from "@solidjs/web";
import { createSignal, Show } from "solid-js";

export function SettledArgs(props: { children: () => JSX.Element }) {
  const [ready, setReady] = createSignal(false);
  queueMicrotask(() => setReady(true));
  return <Show when={ready()}>{props.children()}</Show>;
}
