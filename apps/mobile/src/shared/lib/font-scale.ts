import { useWindowDimensions } from "react-native";
import { useTextScale } from "@/features/settings/model/text-size-store";

export function useFontScale(): number {
  const { fontScale } = useWindowDimensions();
  return fontScale * useTextScale();
}
