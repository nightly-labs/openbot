import { onSettled } from "solid-js";
import type { ArticleReadDepth } from "../../lib/analytics";

/**
 * Reports how far a reader got into an article body, once per depth. `start` is the body coming
 * into view, `half` its midpoint passing the foot of the viewport, and `end` its last line.
 *
 * An IntersectionObserver answers "is it visible", not "how much of it has been read", and a body
 * that is taller than the viewport never reaches a high ratio at all. The position is read from the
 * element instead, on scroll and resize, coalesced into one animation frame. Nothing here is timed:
 * a reader who never scrolls reports only the depths that were on screen from the start.
 */
export function createArticleReadDepth(
  getElement: () => Element | undefined,
  report: (depth: ArticleReadDepth) => void,
): void {
  onSettled(() => {
    const element = getElement();
    if (!element) return;

    const reported = new Set<ArticleReadDepth>();
    const reach = (depth: ArticleReadDepth) => {
      if (reported.has(depth)) return;
      reported.add(depth);
      report(depth);
    };

    let frame = 0;
    const measure = () => {
      frame = 0;
      const rect = element.getBoundingClientRect();
      const viewport = window.innerHeight;
      if (rect.top > viewport || rect.bottom < 0) return;
      reach("start");
      // How much of the body has passed the foot of the viewport. A body shorter than the
      // viewport is fully read the moment its end is on screen, which this gives as 1.
      const read = rect.height > 0 ? (viewport - rect.top) / rect.height : 1;
      if (read >= 0.5) reach("half");
      if (read >= 1) reach("end");
    };

    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  });
}
