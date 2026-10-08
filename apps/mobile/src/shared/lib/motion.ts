import { useReducedMotion as useSystemReducedMotion } from "react-native-reanimated";
import { type MotionPreference, useMotionPreferences } from "../../features/settings/model/motion";

/**
 * True when the system Reduce Motion setting is on, or when Settings turns animations off in the app.
 * Use it in place of Reanimated's `useReducedMotion`, which reads only the system setting.
 */
export function useReducedMotion(): boolean {
  const system = useSystemReducedMotion();
  const animations = useMotionPreferences((state) => state.allAnimations);
  return system || !animations;
}

/** True when one animation plays: Settings keeps it on, and motion is not reduced. */
export function useMotionPreference(name: Exclude<MotionPreference, "allAnimations">): boolean {
  const reduced = useReducedMotion();
  const enabled = useMotionPreferences((state) => state[name]);
  return enabled && !reduced;
}
