import { Host } from "@expo/ui";
import { ColorPicker } from "@expo/ui/swift-ui";
import { type AvatarColor, isAvatarColor } from "@openbot/contracts/ipc";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { useNativeLabelFont } from "@/shared/lib/native-label-font";
import { useText } from "@/shared/lib/text";
import type { MessageColorPickerProps } from "./message-color-picker.types";

/** A drag in the system picker reports each frame. The color is saved when it stays this long. */
const SAVE_DELAY_MS = 400;

/** `#RRGGBB` or `#RRGGBBAA` from SwiftUI as a lower-case `#rrggbb`. */
function opaqueColor(selection: string): AvatarColor | null {
  const color = selection.slice(0, 7).toLowerCase();
  return isAvatarColor(color) ? color : null;
}

/** iOS: the system color picker, with its grid, spectrum, sliders and eyedropper. */
export function MessageColorPicker({ value, disabled, dark, onChange }: MessageColorPickerProps) {
  const { t } = useText();
  const labelFont = useNativeLabelFont();
  const [draft, setDraft] = useState<AvatarColor | null>(null);
  const pending = useRef<{ timer: ReturnType<typeof setTimeout>; color: AvatarColor } | null>(null);
  const latestOnChange = useRef(onChange);
  latestOnChange.current = onChange;
  // Leaving the screen saves a color that is still waiting.
  useEffect(
    () => () => {
      if (!pending.current) return;
      clearTimeout(pending.current.timer);
      latestOnChange.current(pending.current.color);
    },
    [],
  );
  return (
    <View className="px-4 py-3">
      <Host matchContents={{ vertical: true }} style={{ width: "100%" }} colorScheme={dark ? "dark" : "light"}>
        <ColorPicker
          label={t("mobile.settings.appearance.messageColorPick")}
          selection={draft ?? value}
          supportsOpacity={false}
          modifiers={labelFont}
          onSelectionChange={(selection) => {
            const color = opaqueColor(selection);
            if (disabled || !color) return;
            setDraft(color);
            if (pending.current) clearTimeout(pending.current.timer);
            pending.current = {
              color,
              timer: setTimeout(() => {
                pending.current = null;
                setDraft(null);
                latestOnChange.current(color);
              }, SAVE_DELAY_MS),
            };
          }}
        />
      </Host>
    </View>
  );
}
