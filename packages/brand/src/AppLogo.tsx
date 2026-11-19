import { createEffect, createSignal, flush, onCleanup } from "solid-js";
import { APP_LOGO_CORNER, APP_LOGO_EYE_POINTS, APP_LOGO_SIZE } from "./app-logo-shape";

export type AppLogoAnimation = "none" | "blink" | "look-around" | "surprised";
export type AppLogoVariant = "production" | "dev" | "preview";

export interface AppLogoProps {
  variant: AppLogoVariant;
  animation?: AppLogoAnimation;
  interactive?: boolean;
  pointerArea?: HTMLElement | undefined;
  class?: string;
}

const EYE_RANGE = { x: 2.4, y: 1.8 };
const AREA_EYE_RANGE = { x: 9, y: 7 };
const BLINK_PERIOD = 4_800;
const BLINK_DURATION = 192;
const FIRST_BLINK_DELAY = 2_112;

export function AppLogo(props: AppLogoProps) {
  const [clickReaction, setClickReaction] = createSignal(false);
  const [easterEgg, setEasterEgg] = createSignal(false);
  const [blinking, setBlinking] = createSignal(false);
  const className = () => ["app-logo", props.class].filter(Boolean).join(" ");
  const animation = () => props.animation ?? "none";
  let clickReactionTimer: number | undefined;
  let easterEggTimer: number | undefined;
  let logoElement: SVGSVGElement | undefined;
  let rapidClicks: number[] = [];

  function shouldReduceMotion(): boolean {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  }

  function setEyePosition(x: number, y: number): void {
    const range = props.pointerArea ? AREA_EYE_RANGE : EYE_RANGE;
    logoElement?.style.setProperty("--app-logo-eye-x", `${x * range.x}%`);
    logoElement?.style.setProperty("--app-logo-eye-y", `${y * range.y}%`);
  }

  function resetEyePosition(): void {
    setEyePosition(0, 0);
  }

  function lookAt(event: PointerEvent, area: Element): void {
    if (!props.interactive || shouldReduceMotion()) return;
    if (event.pointerType && event.pointerType !== "mouse") return;
    const logo = logoElement?.getBoundingClientRect();
    if (!logo) return;
    const bounds = area.getBoundingClientRect();
    const centerX = logo.left + logo.width / 2;
    const centerY = logo.top + logo.height / 2;
    const reachX = Math.max(centerX - bounds.left, bounds.right - centerX);
    const reachY = Math.max(centerY - bounds.top, bounds.bottom - centerY);
    const x = Math.max(-1, Math.min(1, (event.clientX - centerX) / reachX));
    const y = Math.max(-1, Math.min(1, (event.clientY - centerY) / reachY));
    setEyePosition(x, y);
  }

  function handlePointerMove(event: PointerEvent): void {
    if (!props.pointerArea && logoElement) lookAt(event, logoElement);
  }

  function handlePointerLeave(): void {
    if (!props.pointerArea) resetEyePosition();
  }

  function triggerClickReaction(): void {
    if (!props.interactive || shouldReduceMotion()) return;
    window.clearTimeout(clickReactionTimer);
    flush(() => setClickReaction(false));
    void logoElement?.getBoundingClientRect();
    flush(() => setClickReaction(true));
    clickReactionTimer = window.setTimeout(() => setClickReaction(false), 360);
  }

  function registerRapidClick(): void {
    if (!props.interactive || shouldReduceMotion()) return;
    const now = performance.now();
    rapidClicks = [...rapidClicks.filter((time) => now - time < 900), now];
    if (rapidClicks.length < 5) return;

    rapidClicks = [];
    window.clearTimeout(easterEggTimer);
    flush(() => setEasterEgg(false));
    void logoElement?.getBoundingClientRect();
    flush(() => setEasterEgg(true));
    easterEggTimer = window.setTimeout(() => setEasterEgg(false), 1200);
  }

  function handleClick(): void {
    triggerClickReaction();
    registerRapidClick();
  }

  function handleKeyDown(event: KeyboardEvent): void {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    triggerClickReaction();
  }

  createEffect(
    () => props.pointerArea,
    (area) => {
      if (!area) return;
      const handleAreaPointerMove = (event: PointerEvent) => lookAt(event, area);
      const handleAreaClick = (event: MouseEvent) => {
        if (event.target instanceof Node && logoElement?.contains(event.target)) return;
        handleClick();
      };
      area.addEventListener("pointermove", handleAreaPointerMove);
      area.addEventListener("pointerleave", resetEyePosition);
      area.addEventListener("click", handleAreaClick);
      return () => {
        area.removeEventListener("pointermove", handleAreaPointerMove);
        area.removeEventListener("pointerleave", resetEyePosition);
        area.removeEventListener("click", handleAreaClick);
      };
    },
  );

  createEffect(
    () => animation() === "blink",
    (blinks) => {
      if (!blinks) return;
      let blinkEndTimer: number | undefined;
      let blinkInterval: number | undefined;
      const blink = () => {
        if (shouldReduceMotion()) return;
        setBlinking(true);
        blinkEndTimer = window.setTimeout(() => setBlinking(false), BLINK_DURATION);
      };
      const firstBlinkTimer = window.setTimeout(() => {
        blink();
        blinkInterval = window.setInterval(blink, BLINK_PERIOD);
      }, FIRST_BLINK_DELAY);
      return () => {
        window.clearTimeout(firstBlinkTimer);
        window.clearInterval(blinkInterval);
        window.clearTimeout(blinkEndTimer);
        setBlinking(false);
      };
    },
  );

  onCleanup(() => {
    globalThis.clearTimeout(clickReactionTimer);
    globalThis.clearTimeout(easterEggTimer);
  });

  return (
    <svg
      ref={(element) => (logoElement = element)}
      class={className()}
      data-animation={animation()}
      data-blink={blinking() ? "" : undefined}
      data-click-reaction={clickReaction() ? "wink" : undefined}
      data-easter-egg={easterEgg() ? "party" : undefined}
      data-interactive={props.interactive ? "true" : undefined}
      data-variant={props.variant}
      viewBox={`0 0 ${APP_LOGO_SIZE} ${APP_LOGO_SIZE}`}
      aria-hidden={props.interactive ? undefined : "true"}
      aria-label={props.interactive ? "Animate OpenBot logo" : undefined}
      role={props.interactive ? "button" : undefined}
      tabindex={props.interactive ? 0 : undefined}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onPointerLeave={handlePointerLeave}
      onPointerMove={handlePointerMove}
    >
      <rect
        class="app-logo-background"
        width={APP_LOGO_SIZE}
        height={APP_LOGO_SIZE}
        rx={APP_LOGO_CORNER}
        ry={APP_LOGO_CORNER}
      />
      <g class="app-logo-eye-motion">
        <polyline class="app-logo-eye app-logo-eye-left" points={APP_LOGO_EYE_POINTS.left} />
      </g>
      <g class="app-logo-eye-motion">
        <polyline class="app-logo-eye app-logo-eye-right" points={APP_LOGO_EYE_POINTS.right} />
      </g>
    </svg>
  );
}
