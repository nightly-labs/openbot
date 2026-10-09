import { flush } from "solid-js";

/** How a first-run change moves: to another step, or out to the app. */
export type FirstRunMotion = "step" | "open";

/**
 * Applies one first-run change as a view transition: the old step fades out while the new one
 * fades in, and the parts that stay (progress, actions) move to their new place. The motion is
 * the transition type that `onboarding.css` selects. Without the API, as in tests, or with reduced
 * motion, the change applies at once.
 */
export async function firstRunTransition(motion: FirstRunMotion, update: () => void | Promise<void>): Promise<void> {
  if (!document.startViewTransition || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    await update();
    return;
  }
  const transition = document.startViewTransition({
    types: [motion],
    update: async () => {
      await update();
      // Solid writes apply on a microtask, and the browser takes the new snapshot when this returns.
      flush();
    },
  });
  await transition.updateCallbackDone;
}
