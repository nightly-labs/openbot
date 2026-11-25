import { AMBIENT_MOTION_PAUSED_ATTRIBUTE, AmbientMotion } from "@openbot/ui/ambient-motion";
import type { JSX } from "@solidjs/web";
import { createEffect, createMemo, createSignal, onSettled } from "solid-js";
import { usePlatform } from "./platform";

export function WindowAmbientMotion(props: { children: JSX.Element }): JSX.Element {
  const platform = usePlatform();
  if (platform.landingPreview) return props.children;
  const [pointerOn, setPointerOn] = createSignal(false);
  const allowed = createMemo(() => platform.appFocused() || pointerOn());

  onSettled(() => {
    const move = () => setPointerOn(true);
    const leaveWindow = (event: PointerEvent) => {
      if (event.relatedTarget === null) setPointerOn(false);
    };
    const forget = () => setPointerOn(false);
    const forgetWhenHidden = () => {
      if (document.hidden) forget();
    };
    document.addEventListener("pointermove", move, { passive: true });
    document.addEventListener("pointerout", leaveWindow);
    document.addEventListener("visibilitychange", forgetWhenHidden);
    window.addEventListener("blur", forget);
    return () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerout", leaveWindow);
      document.removeEventListener("visibilitychange", forgetWhenHidden);
      window.removeEventListener("blur", forget);
    };
  });

  createEffect(allowed, (on) => {
    document.documentElement.toggleAttribute(AMBIENT_MOTION_PAUSED_ATTRIBUTE, !on);
    return () => document.documentElement.removeAttribute(AMBIENT_MOTION_PAUSED_ATTRIBUTE);
  });

  return <AmbientMotion when={allowed()}>{props.children}</AmbientMotion>;
}
