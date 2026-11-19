import { avatarHueSwatch } from "@openbot/brand/bloub-avatar";
import type { AvatarHue } from "@openbot/contracts/ipc";
import { View } from "react-native";
import { useCSSVariable } from "uniwind";

export function BrowserProfileDot({ hue, size = 12 }: { hue: AvatarHue | "shared" | null; size?: number }) {
  const muted = String(useCSSVariable("--openbot-text-grouped-secondary"));
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: hue === null ? "transparent" : hue === "shared" ? muted : avatarHueSwatch(hue),
        borderWidth: hue === null ? 1.5 : 0,
        borderColor: muted,
      }}
    />
  );
}
