import { prefersReducedMotion } from "@openbot/ui/utils";
import { flush } from "solid-js";
import type { MarketplaceNavigation } from "./marketplace-view";

/** How a view change moves: deeper, back up, to another kind, or to other rows of the same list. */
type MarketplaceMotion = "forward" | "back" | "tab" | "swap";

/**
 * Applies one view change in a view transition, which `marketplace.css` animates by its type.
 * Without the API, or with reduced motion, the change applies at once.
 */
export function moveView(motion: MarketplaceMotion, update: () => void): void {
  if (typeof document.startViewTransition !== "function" || prefersReducedMotion()) {
    update();
    return;
  }
  document.startViewTransition({
    types: [`marketplace-${motion}`],
    update: () => {
      update();
      // Solid applies writes on a microtask. The browser takes the new snapshot when this returns,
      // so the new view, its scroll offset and its focus must be in place before then.
      flush();
    },
  });
}

/**
 * The Marketplace navigation, with each view change in a view transition. The window keeps the
 * scroll offset and the focus of each view, so this changes only how the change looks.
 */
export function createMovingNavigation(base: MarketplaceNavigation): MarketplaceNavigation {
  return {
    get state() {
      return base.state;
    },
    go: (view) => moveView("forward", () => base.go(view)),
    back: () => moveView("back", () => base.back()),
    backTo: (index) => moveView("back", () => base.backTo(index)),
    show: (tab, view) => {
      if (tab !== base.state.tab) moveView("tab", () => base.show(tab, view));
      else if (view) moveView("forward", () => base.show(tab, view));
      else if (base.state.stack.length > 1) moveView("back", () => base.show(tab));
      else base.show(tab);
    },
    reset: () => base.reset(),
    set: (change) => base.set(change),
  };
}
