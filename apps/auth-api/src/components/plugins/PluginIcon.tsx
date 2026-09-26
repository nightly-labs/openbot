import { cx } from "@openbot/ui/utils";
import type { JSX } from "@solidjs/web";
import { createSignal, Show } from "solid-js";
import { pluginIconPath } from "../../lib/plugins";

export interface PluginIconProps {
  slug: string;
  /** One of the listing's apps, when the icon wanted is that app's rather than the plugin's. */
  appId?: string;
  /** Drawn instead when the catalog holds no icon, or the one it holds cannot be fetched. */
  fallback: JSX.Element;
  class?: string;
}

/**
 * The icon the catalog carries for a listing, at the sizes it was made for.
 *
 * The address is this origin's: the Worker reads the developer's URL from the catalog and fetches
 * it, so the page asks openbot.run for the picture and a reader connects to nobody else. See
 * `src/server/plugin-icon.ts`.
 *
 * `alt=""`, because the row beside it already says the name. An icon that announced itself would
 * make every row say its name twice, which is the same reason `PluginLogo` is hidden.
 */
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
