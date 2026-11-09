import type { JSX } from "@solidjs/web";
import { createContext, useContext } from "solid-js";

/**
 * Whether motion that loops by itself may run here, such as the avatar of a working agent. A window
 * that stays above the other apps all day, such as the Dynamic Island or the agent dock, allows it only
 * while the user looks at it. Each frame there makes macOS compose the screen again, so the other apps
 * stuttered while an agent worked. The surface also pauses its CSS loops, such as a spinner.
 */
const AmbientMotionContext = createContext<() => boolean>(() => true);

export function AmbientMotion(props: { when: boolean; children: JSX.Element }): JSX.Element {
  return <AmbientMotionContext value={() => props.when}>{props.children}</AmbientMotionContext>;
}

export function useAmbientMotion(): () => boolean {
  return useContext(AmbientMotionContext);
}
