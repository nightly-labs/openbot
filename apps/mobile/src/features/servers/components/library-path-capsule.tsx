import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import ChevronsUpDown from "lucide-react-native/icons/chevrons-up-down";
import FolderIcon from "lucide-react-native/icons/folder";
import FolderPlus from "lucide-react-native/icons/folder-plus";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBottomFieldMetrics } from "@/shared/components/bottom-field-metrics";
import { GlassCapsule } from "@/shared/components/glass-capsule";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";
import { useLiquidGlass } from "@/shared/lib/use-liquid-glass";

/** The room that the capsule takes at the bottom of the Library, so the last tiles scroll above it. */
export function useLibraryCapsuleRoom(): number {
  const { height, bottomGap } = useBottomFieldMetrics();
  return height + bottomGap + 12;
}

/**
 * The folder capsule at the bottom of the Library, where the thumb reaches it, as home search: the
 * path of the place that the page shows. A tap opens the folder sheet. The "+" beside it makes a
 * folder in the place, when the place is an agent or a folder that this person organizes.
 */
export function LibraryPathCapsule({
  segments,
  onOpen,
  onAdd,
}: {
  /** "Nova", "Reports", "2026": the agent and the folders down to the place. */
  segments: readonly string[];
  onOpen: () => void;
  onAdd?: (() => void) | undefined;
}) {
  const { t } = useText();
  const insets = useSafeAreaInsets();
  const liquidGlass = useLiquidGlass();
  const [foreground, muted, fieldBackground] = useThemeColor(["foreground", "muted", "default"]);
  const { height, bottomGap } = useBottomFieldMetrics();
  const path = segments.join(" › ");
  return (
    <View
      className="absolute flex-row items-center gap-2"
      pointerEvents="box-none"
      style={{ bottom: bottomGap, left: insets.left + 16, right: insets.right + 16 }}
    >
      <View className="min-w-0 flex-1">
        <GlassCapsule liquidGlass={liquidGlass} fallbackBackground={fieldBackground} height={height}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("mobile.server.library.folders.path", { path: segments.join(", ") })}
            accessibilityHint={t("mobile.server.library.folders.pathHint")}
            className="flex-1 flex-row items-center gap-2.5 pr-4 pl-4"
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
            onPress={() => {
              void haptics.impact("soft");
              onOpen();
            }}
          >
            <FolderIcon color={String(foreground)} size={18} strokeWidth={2} />
            {/* The end of a long path is the place, so the start is cut. */}
            <Typography.Paragraph
              numberOfLines={1}
              ellipsizeMode="head"
              className="min-w-0 flex-1 font-medium"
              style={{ fontSize: 16, lineHeight: 20, color: String(foreground) }}
            >
              {path}
            </Typography.Paragraph>
            <ChevronsUpDown color={String(muted)} size={16} strokeWidth={2} />
          </Pressable>
        </GlassCapsule>
      </View>
      {onAdd ? (
        <GlassCapsule liquidGlass={liquidGlass} fallbackBackground={fieldBackground} width={height} height={height}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("mobile.server.library.folders.new")}
            className="flex-1 items-center justify-center"
            hitSlop={4}
            style={({ pressed }) => ({ opacity: pressed ? 0.55 : 1 })}
            onPress={() => {
              void haptics.impact("light");
              onAdd();
            }}
          >
            <FolderPlus color={String(foreground)} size={21} strokeWidth={2} />
          </Pressable>
        </GlassCapsule>
      ) : null}
    </View>
  );
}
