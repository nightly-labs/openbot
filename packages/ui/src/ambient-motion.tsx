import type { JSX } from "@solidjs/web";
import { createContext, useContext } from "solid-js";

/**
 * Whether motion that loops by itself may run here, such as the avatar of a working agent. A window
 * allows it only while the user looks at it. Each frame makes macOS compose the screen again, so the
 * other apps stuttered while an agent worked. The Dynamic Island and the agent dock stay above the
 * other apps all day; the main window is often open beside another app. The surface also pauses its
 * CSS loops, such as a spinner.
 */
const AmbientMotionContext = createContext<() => boolean>(() => true);

/** The root attribute of a main window that the user does not look at. Its CSS loops then pause. */
export const AMBIENT_MOTION_PAUSED_ATTRIBUTE = "data-openbot-ambient-motion-paused";

export function AmbientMotion(props: { when: boolean; children: JSX.Element }): JSX.Element {
  return <AmbientMotionContext value={() => props.when}>{props.children}</AmbientMotionContext>;
}

export function useAmbientMotion(): () => boolean {
  return useContext(AmbientMotionContext);
}
