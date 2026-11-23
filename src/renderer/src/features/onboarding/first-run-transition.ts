import { flush } from "solid-js";

export type FirstRunMotion = "step" | "open";

export async function firstRunTransition(motion: FirstRunMotion, update: () => void | Promise<void>): Promise<void> {
  if (!document.startViewTransition || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    await update();
    return;
  }
  const transition = document.startViewTransition({
    types: [motion],
    update: async () => {
      await update();
      flush();
    },
  });
  await transition.updateCallbackDone;
}
