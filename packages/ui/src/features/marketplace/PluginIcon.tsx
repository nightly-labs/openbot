import { Blocks, Puzzle } from "@openbot/ui";
import { createMemo, createSignal, Show } from "solid-js";

export function PluginIcon(props: { iconUrl: string | null; fallback?: "plugin" | "skill"; class?: string }) {
  const [failedUrl, setFailedUrl] = createSignal<string | null>(null);
  const iconUrl = createMemo(() => {
    const url = props.iconUrl;
    return url && failedUrl() !== url ? url : null;
  });
  return (
    <span class={props.class ? `skills-marketplace-icon ${props.class}` : "skills-marketplace-icon"}>
      <Show when={iconUrl()} fallback={props.fallback === "skill" ? <Blocks /> : <Puzzle />} keyed>
        {(url) => <img src={url} alt="" onError={() => setFailedUrl(url)} />}
      </Show>
    </span>
  );
}
