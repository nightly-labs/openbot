import { useWindowDimensions } from "react-native";
import { useTextScale } from "@/features/settings/model/text-size-store";

/**
 * The scale of the drawn text: the text size of the phone settings times the text size of
 * Settings › Appearance. Use it for layout that follows the text, as `fontScale` of
 * `useWindowDimensions` was before the app had its own text size.
 */
export function useFontScale(): number {
  const { fontScale } = useWindowDimensions();
  return fontScale * useTextScale();
}
