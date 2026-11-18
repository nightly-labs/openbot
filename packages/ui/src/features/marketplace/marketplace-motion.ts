import { prefersReducedMotion } from "@openbot/ui/utils";
import { flush } from "solid-js";
import type { MarketplaceNavigation, MarketplaceView } from "./marketplace-view";

/** How a view change moves: deeper, back up, to another kind, or to other rows of the same list. */
type MarketplaceMotion = "forward" | "back" | "tab" | "swap";

/**
 * Applies one view change in a view transition, which `marketplace.css` animates by its type.
 * `shared`: the two views show the same category title and first rows, which move to their new place.
 * Without the API, or with reduced motion, the change applies at once.
 */
export function moveView(motion: MarketplaceMotion, update: () => void, shared = false): void {
  if (typeof document.startViewTransition !== "function" || prefersReducedMotion()) {
    update();
    return;
  }
  document.startViewTransition({
    types: shared ? [`marketplace-${motion}`, "marketplace-group"] : [`marketplace-${motion}`],
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
  /**
   * Marks the category of a change between the browse view and a category page of the Apps tab, and
   * tells whether the change is one. The mark is in place before the transition, so the old view is
   * captured with it.
   */
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
