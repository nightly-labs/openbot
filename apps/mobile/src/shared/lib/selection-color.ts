import type { ColorValue } from "react-native";

import { isAndroid } from "@/shared/lib/platform";

export function selectionColorProps(color: ColorValue | undefined) {
  return isAndroid ? { cursorColor: color, selectionHandleColor: color } : { selectionColor: color };
}
