import { Typography } from "heroui-native";
import type { ReactNode } from "react";
import { useWindowDimensions, View } from "react-native";
import { useTextScale } from "@/features/settings/model/text-size-store";
import { typeScale } from "@/shared/lib/type-scale";

export const CHAT_ROW_AVATAR_SIZE = 62;
export const PINNED_AVATAR_SIZE = 70;
const TITLE_MIN_WIDTH = 64;
const NAME_TITLE_GAP = 6;

export function ChatRowHeading({
  name,
  title,
  leading,
  trailing,
}: {
  name: string;
  title: string;
  leading?: ReactNode;
  trailing: ReactNode;
}) {
  const textScale = useWindowDimensions().fontScale * useTextScale();
  return (
    <View className="flex-row items-center gap-2">
      {leading}
      <View
        style={{
          flex: 1,
          minWidth: 0,
          height: Math.ceil(typeScale.chatName.lineHeight * textScale),
          flexDirection: "row",
          flexWrap: "wrap",
          alignItems: "baseline",
          columnGap: NAME_TITLE_GAP,
          overflow: "hidden",
        }}
      >
        <Typography.Paragraph
          className="font-semibold"
          numberOfLines={1}
          style={[typeScale.chatName, { flexShrink: 1 }]}
        >
          {name}
        </Typography.Paragraph>
        {title ? (
          <Typography.Paragraph
            className="text-muted"
            numberOfLines={1}
            style={[typeScale.chatDetail, { flexGrow: 1, flexBasis: 0, minWidth: TITLE_MIN_WIDTH * textScale }]}
          >
            {title}
          </Typography.Paragraph>
        ) : null}
      </View>
      {trailing}
    </View>
  );
}

export function ChatRowTime({ label }: { label: string }) {
  return (
    <Typography.Paragraph className="text-muted" style={typeScale.chatTime}>
      {label}
    </Typography.Paragraph>
  );
}
