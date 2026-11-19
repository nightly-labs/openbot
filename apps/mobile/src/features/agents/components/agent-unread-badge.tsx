import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { View } from "react-native";
import { useCSSVariable } from "uniwind";
import { useText } from "@/shared/lib/text";

const DESKTOP_AVATAR = 46;
const FELT = 16 / DESKTOP_AVATAR;
const RING = 3.5 / DESKTOP_AVATAR;
const END_OFFSET = 3 / DESKTOP_AVATAR;
const BOTTOM_OFFSET = 1 / DESKTOP_AVATAR;
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
  const felt = Math.round(avatarSize * FELT);
  const ring = Math.round(avatarSize * RING);
  const fontSize = Math.round(avatarSize * DIGITS);
  return (
    <View
      pointerEvents="none"
      className="absolute items-center justify-center rounded-full"
      style={{
        right: -Math.round(avatarSize * END_OFFSET) - ring,
        bottom: -Math.round(avatarSize * BOTTOM_OFFSET) - ring,
        minWidth: felt + ring * 2,
        height: felt + ring * 2,
        paddingHorizontal: Math.round(felt * 0.2),
        borderWidth: ring,
        borderColor: ringColor ?? String(background),
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
  );
}
