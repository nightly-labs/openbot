import { AppLogo, type AppLogoVariant } from "@openbot/brand";
import { APP_LOGO_EYE_POINTS } from "@openbot/brand/app-logo-shape";
import { useText } from "@openbot/ui/text";
import { createEffect } from "solid-js";

// The fade takes the overlay duration. If no `animationend` comes, the splash ends after this time,
// so it cannot cover the app.
const EXIT_LIMIT_MS = 1500;
const EXIT_ANIMATION = "startup-splash-exit";

/** The sum of the segment lengths of an SVG `points` list, in the mark's own units. */
function strokeLength(points: string): number {
  const values = points.trim().split(/\s+/).map(Number);
  let length = 0;
  let previous: [number, number] | undefined;
  for (let index = 0; index + 1 < values.length; index += 2) {
    const point: [number, number] = [values[index] ?? 0, values[index + 1] ?? 0];
    if (previous) length += Math.hypot(point[0] - previous[0], point[1] - previous[1]);
    previous = point;
  }
  return Math.ceil(length);
}

const LEFT_EYE_LENGTH = strokeLength(APP_LOGO_EYE_POINTS.left);
const RIGHT_EYE_LENGTH = strokeLength(APP_LOGO_EYE_POINTS.right);

/**
 * Set on a splash root, so its CSS can draw the logo eyes with `stroke-dasharray`: one length for each
 * eye, and the longer of the two for both eyes. The unit is px:
 * a unitless number in `calc()` does not interpolate. In SVG, px are the mark's user units.
 */
export const SPLASH_EYE_LENGTH_STYLE = {
  "--splash-eye-left-length": `${LEFT_EYE_LENGTH}px`,
  "--splash-eye-right-length": `${RIGHT_EYE_LENGTH}px`,
  "--splash-eye-length": `${Math.max(LEFT_EYE_LENGTH, RIGHT_EYE_LENGTH)}px`,
};

interface StartupSplashProps {
  variant: AppLogoVariant;
  /** The app is ready: the splash fades out. Remove it in `onExited`. */
  ready: boolean;
  onExited?: () => void;
}

/** The desktop window's first screen: the logo draws its eyes and blinks until the app is ready. */
export function StartupSplash(props: StartupSplashProps) {
  const { t } = useText();
  let root: HTMLElement | undefined;
  let exitTimer: ReturnType<typeof setTimeout> | undefined;
  let exited = false;

  function finishExit(): void {
    if (exited) return;
    exited = true;
    clearTimeout(exitTimer);
    props.onExited?.();
  }

  createEffect(
    () => props.ready,
    (ready) => {
      if (!ready) return;
      exitTimer ??= setTimeout(finishExit, EXIT_LIMIT_MS);
      // Without the stylesheet, or in a test DOM, the exit does not animate: end the splash now.
      if (root && !getComputedStyle(root).animationName.includes(EXIT_ANIMATION)) queueMicrotask(finishExit);
      return () => clearTimeout(exitTimer);
    },
  );

  function handleAnimationEnd(event: AnimationEvent): void {
    if (event.animationName === EXIT_ANIMATION && event.target === event.currentTarget) finishExit();
  }

  return (
    <main
      ref={(element) => {
        root = element;
      }}
      class="startup-splash"
      data-phase={props.ready ? "exit" : "loading"}
      role="status"
      aria-label={t("app.loading")}
      aria-busy={props.ready ? "false" : "true"}
      style={SPLASH_EYE_LENGTH_STYLE}
      onAnimationEnd={handleAnimationEnd}
    >
      <AppLogo variant={props.variant} class="startup-splash-logo" />
    </main>
  );
}
