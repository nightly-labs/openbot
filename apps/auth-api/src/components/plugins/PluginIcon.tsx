import { cx } from "@openbot/ui/utils";
import type { JSX } from "@solidjs/web";
import { createSignal, Show } from "solid-js";
import { pluginIconPath } from "../../lib/plugins";

export interface PluginIconProps {
  slug: string;
  appId?: string;
  fallback: JSX.Element;
  class?: string;
}

export function PluginIcon(props: PluginIconProps) {
  const [unavailable, setUnavailable] = createSignal(false);

  return (
    <Show when={!unavailable()} fallback={props.fallback}>
      <img
        class={cx("plugin-icon", props.class)}
        src={pluginIconPath(props.slug, props.appId)}
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => setUnavailable(true)}
      />
    </Show>
  );
}
