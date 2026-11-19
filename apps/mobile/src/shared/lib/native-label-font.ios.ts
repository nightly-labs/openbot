import { font } from "@expo/ui/swift-ui/modifiers";
import { useMemo } from "react";
import { useTextScale } from "@/features/settings/model/text-size-store";
import { APP_FONT } from "@/shared/lib/app-font";

const BODY_SIZE = 17;

export function useNativeLabelFont() {
  const scale = useTextScale();
  return useMemo(() => [font({ family: APP_FONT, textStyle: "body", size: BODY_SIZE * scale })], [scale]);
}
