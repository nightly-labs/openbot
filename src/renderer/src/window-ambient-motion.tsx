import { AMBIENT_MOTION_PAUSED_ATTRIBUTE, AmbientMotion } from "@openbot/ui/ambient-motion";
import type { JSX } from "@solidjs/web";
import { createEffect, createMemo, createSignal, onSettled } from "solid-js";
import { usePlatform } from "./platform";

/**
 * Lets a working agent move in this window only while the user looks at it: the window has the focus,
 * or the pointer is on it. A window that stays open beside another app otherwise drew each frame of the
 * avatars and of the loops of a working agent, and macOS composed the screen again for each one, so the
 * other app stuttered. The working state stays on screen, still. A hidden window already draws nothing.
 */
export function WindowAmbientMotion(props: { children: JSX.Element }): JSX.Element {
  const platform = usePlatform();
  const [pointerOn, setPointerOn] = createSignal(false);
  const allowed = createMemo(() => platform.appFocused() || pointerOn());

  onSettled(() => {
    const move = () => setPointerOn(true);
    // A pointer that leaves the window has no next element.
    const leave = (event: PointerEvent) => {
      if (event.relatedTarget === null) setPointerOn(false);
    };
    // Another app can come over the pointer without a pointer event, so the pointer must move again.
    const blur = () => setPointerOn(false);
    document.addEventListener("pointermove", move, { passive: true });
    document.addEventListener("pointerout", leave);
    window.addEventListener("blur", blur);
    return () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerout", leave);
      window.removeEventListener("blur", blur);
    };
  });

  createEffect(allowed, (on) => {
    document.documentElement.toggleAttribute(AMBIENT_MOTION_PAUSED_ATTRIBUTE, !on);
    return () => document.documentElement.removeAttribute(AMBIENT_MOTION_PAUSED_ATTRIBUTE);
  });

  return <AmbientMotion when={allowed()}>{props.children}</AmbientMotion>;
}
