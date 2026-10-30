import { Typography } from "heroui-native";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import { View } from "react-native";
import { useCSSVariable } from "uniwind";

/** A value and the disclosure chevron at the end of a navigation row. */
export function TrailingValue({ value, tone }: { value: string; tone?: "warning" }) {
  const muted = String(useCSSVariable("--openbot-text-grouped-secondary"));
  return (
    <View className="shrink flex-row items-center gap-1" style={{ maxWidth: "60%" }}>
      <Typography.Paragraph
        numberOfLines={1}
        className={tone === "warning" ? "shrink text-warning-text" : "shrink text-grouped-secondary"}
      >
        {value}
      </Typography.Paragraph>
      <ChevronRight size={18} color={muted} strokeWidth={1.5} />
    </View>
  );
}
