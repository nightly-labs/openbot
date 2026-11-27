import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { View } from "react-native";
import { useCSSVariable } from "uniwind";
import { useAvatarHole } from "@/features/agents/components/avatar-cutout";
import { useText } from "@/shared/lib/text";

const DESKTOP_AVATAR = 46;
const LARGEST_BADGE_AVATAR = 54;
const FELT = 16 / DESKTOP_AVATAR;
const RING = 3 / LARGEST_BADGE_AVATAR;
const INSET = 1 / DESKTOP_AVATAR;
const DIGITS = 14 / DESKTOP_AVATAR;

export function AgentUnreadBadge({
  count,
  avatarSize,
  ringColor,
}: {
  count: number;
  avatarSize: number;
  ringColor?: string;
}) {
  const { format } = useText();
  const [background] = useThemeColor(["background"]);
  const [plum, cream] = useCSSVariable(["--openbot-felt-plum-bottom", "--openbot-felt-cream"]);
  const scale = Math.min(avatarSize, LARGEST_BADGE_AVATAR);
  const felt = Math.round(scale * FELT);
  const ring = Math.round(scale * RING);
  const inset = Math.round(scale * INSET);
  const fontSize = Math.round(scale * DIGITS);
  const reportHole = useAvatarHole();
  return (
    <View
      pointerEvents="none"
      className="absolute"
      onLayout={reportHole}
      style={{
        right: inset - ring,
        bottom: inset - ring,
        padding: ring,
        borderRadius: felt / 2 + ring,
        backgroundColor: reportHole ? "transparent" : (ringColor ?? String(background)),
      }}
    >
      <View
        className="items-center justify-center rounded-full"
        style={{
          minWidth: felt,
          height: felt,
          paddingHorizontal: Math.round(felt * 0.2),
          backgroundColor: String(plum),
        }}
      >
        {count > 0 ? (
          <Typography.Paragraph
            className="font-extrabold"
            style={{ color: String(cream), fontSize, lineHeight: felt }}
            numberOfLines={1}
          >
            {format.number(Math.min(count, 99))}
          </Typography.Paragraph>
        ) : null}
      </View>
    </View>
  );
}
