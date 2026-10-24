import { createContext, useContext } from "react";
import { makeMutable, type SharedValue } from "react-native-reanimated";

/**
 * Whether the drawer is open or moving, so the home screen under it is covered. The value changes
 * only when the drawer leaves or reaches its closed place, not on each frame of its motion. A separate
 * context from the drawer actions, so the change renders only the components that read it.
 */
export const AppDrawerShownContext = createContext(false);

/** The same state on the UI thread, for a frame callback that must not render React again. */
export const AppDrawerShownOnUIContext = createContext<SharedValue<boolean>>(makeMutable(false));

/** True while the drawer is open or moving. Outside the drawer shell, always false. */
export function useAppDrawerShown(): boolean {
  return useContext(AppDrawerShownContext);
}

/** The UI thread value of `useAppDrawerShown`. Its identity does not change. */
export function useAppDrawerShownOnUI(): SharedValue<boolean> {
  return useContext(AppDrawerShownOnUIContext);
}
