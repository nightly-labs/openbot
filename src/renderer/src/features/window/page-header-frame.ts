import type { PageHeaderFrame } from "@openbot/ui/features/window/PageHeader";
import { type Accessor, createSignal, onSettled } from "solid-js";
import { usePlatform } from "../../platform";

const NARROW_QUERY = "(max-width: 720px)";

export function createPageHeaderFrame(): Accessor<PageHeaderFrame | undefined> {
  const platform = usePlatform();
  const query = window.matchMedia?.(NARROW_QUERY);
  const [narrow, setNarrow] = createSignal(query?.matches ?? false);
  onSettled(() => {
    const change = () => setNarrow(query?.matches ?? false);
    query?.addEventListener("change", change);
    return () => query?.removeEventListener("change", change);
  });
  return () => (platform.appInfo() !== null && !narrow() ? "window" : undefined);
}
