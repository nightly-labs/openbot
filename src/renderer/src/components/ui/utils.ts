import type { JSX } from "@solidjs/web";

type ClassValue = JSX.HTMLAttributes<HTMLElement>["class"] | false | null | undefined;

export function cx(...values: ClassValue[]): string {
  return values
    .flatMap((value): string[] => {
      if (!value || value === true) return [];
      if (Array.isArray(value)) return [cx(...value)];
      if (Object.prototype.toString.call(value) === "[object Object]") {
        return Object.entries(value)
          .filter(([, enabled]) => enabled)
          .map(([className]) => className);
      }
      return [String(value)];
    })
    .join(" ");
}

export function truncateMiddle(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  const visibleLength = maxLength - 1;
  const startLength = Math.ceil((visibleLength * 2) / 3);
  const endLength = visibleLength - startLength;
  return `${value.slice(0, startLength)}…${value.slice(-endLength)}`;
}

/**
 * Whether the user has asked the system for less animation. Import this rather than
 * declaring it again: eight modules held their own byte-identical copy - five spelled
 * `prefersReducedMotion`, plus `shouldReduceMotion`, `prefersReducedStreamingMotion` and
 * `reducedMotion` - so a change to how the preference is read, a fallback or a cached
 * MediaQueryList, would have reached one animation and not the other seven.
 *
 * A handful of call sites still read the media query inline, because they want a duration
 * rather than a boolean (`return 0`) or a `ScrollBehavior`, and one holds the MediaQueryList
 * to subscribe to it. Those are a different shape, not another copy of this one.
 *
 * `matchMedia` is optional because jsdom does not implement it, and a test that renders a
 * component with an entrance animation must not throw on the way in.
 */
export function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}
