import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { View } from "react-native";
import { useCSSVariable } from "uniwind";
import { useText } from "@/shared/lib/text";

/** The desktop sidebar badge, in parts of its 46 px avatar: the felt, its ring, its offsets and its digits. */
const DESKTOP_AVATAR = 46;
const FELT = 16 / DESKTOP_AVATAR;
const RING = 3.5 / DESKTOP_AVATAR;
const END_OFFSET = 3 / DESKTOP_AVATAR;
const BOTTOM_OFFSET = 1 / DESKTOP_AVATAR;
const DIGITS = 14 / DESKTOP_AVATAR;

/**
 * The unread count on the bottom corner of an agent's avatar, as on the desktop sidebar: bold cream
 * digits on a plum felt pill, in the same proportions to the avatar. Its ring has the colour under the
 * avatar, so it cuts the badge out of the face. It takes the place of the wait mark, which outranks it.
 * The count stops at 99. A one-digit count is a round ball; a longer count grows the pill toward the face.
 */
export function AgentUnreadBadge({
  count,
  avatarSize,
  ringColor,
}: {
  count: number;
  avatarSize: number;
  /** The colour under the avatar. The screen background when unset. */
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
        // The felt keeps the place of the desktop felt; the ring grows outwards from it.
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
      <Typography.Paragraph
        className="font-extrabold"
        style={{ color: String(cream), fontSize, lineHeight: felt }}
        numberOfLines={1}
      >
        {format.number(Math.min(count, 99))}
      </Typography.Paragraph>
    </View>
  );
}
