import type { JSX } from "@solidjs/web";
import { createSignal, Show } from "solid-js";

/**
 * Renders its children after Solid applies the story args. The renderer writes the args into a store just before
 * the first render, and Solid applies a store write at its next flush, so a `component:` story first gets empty
 * args. A component that reads a nested arg, such as `props.status.state`, throws on that render.
 *
 * Use it in `render`, not in a decorator: after the first render settles, the renderer gives a decorator's story null.
 */
export function SettledArgs(props: { children: () => JSX.Element }) {
  const [ready, setReady] = createSignal(false);
  // Solid queued its flush when the renderer wrote the args, so this runs after it.
  queueMicrotask(() => setReady(true));
  return <Show when={ready()}>{props.children()}</Show>;
}
