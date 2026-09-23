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
 * Whether the user asked for less animation. Import this instead of redeclaring it; several
 * modules once held their own copy under different names. `matchMedia` is optional for jsdom.
 */
export function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/** Whether the pointer is coarse and hoverless (touch screen). Kept beside `prefersReducedMotion`. */
export function usesTouchLayout(): boolean {
  return window.matchMedia?.("(hover: none), (pointer: coarse)").matches ?? false;
}

/** Constrains `value` to the inclusive range. */
export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

/** Linear interpolation from `start` to `end`, for a `progress` an animation drives from 0 to 1. */
export function mix(start: number, end: number, progress: number): number {
  return start + (end - start) * progress;
}
