import { createContext, useContext } from "react";
import { makeMutable, type SharedValue } from "react-native-reanimated";

export const AppDrawerShownOnUIContext = createContext<SharedValue<boolean>>(makeMutable(false));

export function useAppDrawerShownOnUI(): SharedValue<boolean> {
  return useContext(AppDrawerShownOnUIContext);
}
