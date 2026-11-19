import { prefersReducedMotion } from "@openbot/ui/utils";
import { flush } from "solid-js";
import type { MarketplaceNavigation, MarketplaceView } from "./marketplace-view";

type MarketplaceMotion = "forward" | "back" | "tab" | "swap";

export function moveView(motion: MarketplaceMotion, update: () => void, shared = false): void {
  if (typeof document.startViewTransition !== "function" || prefersReducedMotion()) {
    update();
    return;
  }
  document.startViewTransition({
    types: shared ? [`marketplace-${motion}`, "marketplace-group"] : [`marketplace-${motion}`],
    update: () => {
      update();
      flush();
    },
  });
}

export function createMovingNavigation(base: MarketplaceNavigation): MarketplaceNavigation {
  const shareGroup = (from: MarketplaceView | undefined, to: MarketplaceView | undefined): boolean => {
    const page = from?.kind === "appGroup" ? from : to?.kind === "appGroup" ? to : undefined;
    const other = page === from ? to : from;
    if (!page || other?.kind !== "browse") return false;
    base.set((draft) => {
      draft.appGroup = page.category;
    });
    flush();
    return true;
  };
  const top = () => base.state.stack.at(-1);
  return {
    get state() {
      return base.state;
    },
    go: (view) => moveView("forward", () => base.go(view), shareGroup(top(), view)),
    back: () => moveView("back", () => base.back(), shareGroup(top(), base.state.stack.at(-2))),
    backTo: (index) =>
      moveView("back", () => base.backTo(index), shareGroup(top(), base.state.stack[Math.max(0, index)])),
    show: (tab, view) => {
      if (tab !== base.state.tab) moveView("tab", () => base.show(tab, view));
      else if (view) moveView("forward", () => base.show(tab, view), shareGroup(top(), view));
      else if (base.state.stack.length > 1)
        moveView("back", () => base.show(tab), shareGroup(top(), base.state.stack[0]));
      else base.show(tab);
    },
    reset: () => base.reset(),
    set: (change) => base.set(change),
  };
}
