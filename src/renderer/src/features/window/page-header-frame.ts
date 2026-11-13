import type { PageHeaderFrame } from "@openbot/ui/features/window/PageHeader";
import { type Accessor, createSignal, onSettled } from "solid-js";
import { usePlatform } from "../../platform";

/** At this width and below, the window has no page rail (`window.css`), so a page shows its own Back. */
const NARROW_QUERY = "(max-width: 720px)";

/**
 * The frame of the header of a full page. In the app window, the page rail is the way back and the
 * server menu names the server, so the header has no Back button and no server name. A narrow window
 * has no rail, and the header shows both.
 */
export function createPageHeaderFrame(): Accessor<PageHeaderFrame | undefined> {
  const platform = usePlatform();
  // `matchMedia` is optional for jsdom.
  const query = window.matchMedia?.(NARROW_QUERY);
  const [narrow, setNarrow] = createSignal(query?.matches ?? false);
  onSettled(() => {
    const change = () => setNarrow(query?.matches ?? false);
    query?.addEventListener("change", change);
    return () => query?.removeEventListener("change", change);
  });
  return () => (platform.appInfo() !== null && !narrow() ? "window" : undefined);
}
