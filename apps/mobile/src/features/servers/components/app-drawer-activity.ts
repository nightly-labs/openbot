import { createContext, useContext } from "react";
import { makeMutable, type SharedValue } from "react-native-reanimated";

/**
 * Whether the drawer is open or moving, so the home screen under it is covered, on the UI thread. A
 * frame callback reads it without rendering React again. Outside the drawer shell, always false.
 */
export const AppDrawerShownOnUIContext = createContext<SharedValue<boolean>>(makeMutable(false));

/** True while the drawer is open or moving. Its identity does not change. */
export function useAppDrawerShownOnUI(): SharedValue<boolean> {
  return useContext(AppDrawerShownOnUIContext);
}
