import { createTrackedEffect } from "solid-js";
import type { ArticleReadDepth, ArticleReference } from "../../lib/analytics";

export function createArticleReadDepth(
  getElement: () => Element | undefined,
  getArticle: () => ArticleReference,
  report: (article: ArticleReference, depth: ArticleReadDepth) => void,
): void {
  createTrackedEffect(() => {
    const article = getArticle();
    const element = getElement();
    if (!element) return;

    const reported = new Set<ArticleReadDepth>();
    const reach = (depth: ArticleReadDepth) => {
      if (reported.has(depth)) return;
      reported.add(depth);
      report(article, depth);
    };

    let frame = 0;
    const measure = () => {
      frame = 0;
      const rect = element.getBoundingClientRect();
      const viewport = window.innerHeight;
      if (rect.top > viewport || rect.bottom < 0) return;
      reach("start");
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
