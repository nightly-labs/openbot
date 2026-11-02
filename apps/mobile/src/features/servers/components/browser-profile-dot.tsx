import { avatarHueSwatch } from "@openbot/brand/bloub-avatar";
import type { AvatarHue } from "@openbot/contracts/ipc";
import { View } from "react-native";
import { useCSSVariable } from "uniwind";

/**
 * The color mark of a browser profile, as the desktop tab labels show it. The shared profile is gray,
 * which no named profile can be, and an agent's own session has no color. The name beside it says
 * the same, so screen readers skip it.
 */
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
