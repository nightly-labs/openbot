import { Image } from "expo-image";
import { Typography } from "heroui-native";
import { X } from "lucide-react-native";
import { useState } from "react";
import { Pressable, View, type ViewStyle } from "react-native";
import Animated, { cubicBezier, Easing, Keyframe, LinearTransition, ReduceMotion } from "react-native-reanimated";
import { useText } from "@/shared/lib/text";
import { attachmentTypeLabel } from "./attachment-preview";
import type { ChatAttachment } from "./use-chat-attachments";

const ATTACHMENT_TILE_SIZE = 112;
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
// A new file grows in from slightly smaller, never from nothing; a removed one shrinks as it fades.
// The rest of the row then slides into the space, so the order the user chose stays readable.
const TILE_ENTER = new Keyframe({
  0: { opacity: 0, transform: [{ scale: 0.9 }] },
  100: { opacity: 1, transform: [{ scale: 1 }], easing: EASE_OUT },
})
  .duration(220)
  .reduceMotion(ReduceMotion.System);
const TILE_EXIT = new Keyframe({
  0: { opacity: 1, transform: [{ scale: 1 }] },
  100: { opacity: 0, transform: [{ scale: 0.9 }], easing: EASE_OUT },
})
  .duration(160)
  .reduceMotion(ReduceMotion.System);
const PRESS_EASING = cubicBezier(0.23, 1, 0.32, 1);
const TILE_REFLOW = LinearTransition.duration(220).easing(EASE_OUT).reduceMotion(ReduceMotion.System);

export function localPreviewUri(item: Pick<ChatAttachment, "mimeType" | "uri" | "base64">): string | null {
  if (!item.mimeType.startsWith("image/")) return null;
  return item.uri ?? `data:${item.mimeType};base64,${item.base64}`;
}

/**
 * One file waiting in the composer. Tapping it opens its preview, where it can be replaced or
 * removed on its own. No native menu here: a SwiftUI menu inside the composer's glass makes iOS
 * morph the whole composer into the menu.
 */
export function ComposerAttachmentTile({
  item,
  index,
  count,
  disabled,
  foreground,
  raised,
  onPreview,
  onRemove,
}: {
  item: ChatAttachment;
  index: number;
  count: number;
  disabled: boolean;
  foreground: ViewStyle["backgroundColor"];
  raised: ViewStyle["backgroundColor"];
  onPreview: () => void;
  onRemove: () => void;
}) {
  const { t, format } = useText();
  const image = localPreviewUri(item);
  const type = attachmentTypeLabel(item.name, item.mimeType, t);
  const [pressed, setPressed] = useState(false);
  return (
    <Animated.View
      entering={TILE_ENTER}
      exiting={TILE_EXIT}
      layout={TILE_REFLOW}
      style={{ width: ATTACHMENT_TILE_SIZE, height: ATTACHMENT_TILE_SIZE }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("mobile.chat.attachment.preview", { name: item.name })}
        accessibilityHint={t("mobile.chat.attachment.tileHint", {
          type,
          size: format.fileSize(item.size),
          position: index + 1,
          total: count,
        })}
        onPress={onPreview}
        onPressIn={() => setPressed(true)}
        onPressOut={() => setPressed(false)}
      >
        <Animated.View
          className="size-28 overflow-hidden rounded-2xl bg-control p-3"
          style={{
            borderCurve: "continuous",
            transform: [{ scale: pressed ? 0.97 : 1 }],
            transitionProperty: "transform",
            transitionDuration: 120,
            transitionTimingFunction: PRESS_EASING,
          }}
        >
          {image ? (
            <Image
              source={image}
              contentFit="cover"
              transition={0}
              accessibilityLabel={item.name}
              style={{ position: "absolute", inset: 0 }}
            />
          ) : (
            <>
              <View className="self-start rounded-md bg-success/15 px-1.5 py-0.5">
                <Typography.Paragraph type="body-xs" className="font-semibold text-success-text">
                  {type}
                </Typography.Paragraph>
              </View>
              <Typography.Paragraph numberOfLines={2} type="body-xs" className="mt-auto font-medium text-foreground">
                {item.name}
              </Typography.Paragraph>
              <Typography.Paragraph type="body-xs" className="text-muted">
                {format.fileSize(item.size)}
              </Typography.Paragraph>
            </>
          )}
        </Animated.View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("mobile.chat.attachment.remove", { name: item.name })}
        accessibilityState={{ disabled }}
        disabled={disabled}
        hitSlop={8}
        // A HeroUI icon button fills a quarter of the tile here. The badge has to read as an
        // overlay on the file, not a control beside it, so it keeps its 44 pt target through hitSlop.
        className="absolute top-1.5 right-1.5 size-7 items-center justify-center rounded-full"
        style={{ backgroundColor: raised }}
        onPress={onRemove}
      >
        <X color={String(foreground)} size={15} strokeWidth={2.4} />
      </Pressable>
    </Animated.View>
  );
}
