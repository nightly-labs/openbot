import { GlassView } from "expo-glass-effect";
import { router, useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import ArrowLeft from "lucide-react-native/icons/arrow-left";
import Ellipsis from "lucide-react-native/icons/ellipsis";
import { useEffect, useState } from "react";
import { ScrollView, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { savesToPhotos, useAttachmentFiles } from "@/features/chat/components/attachment-preview";
import { ChatGlassIconButton } from "@/features/chat/components/chat-glass-icon-button";
import { ChatGalleryTile } from "@/features/chat/components/chat-image-gallery";
import { ChatImageViewerProvider } from "@/features/chat/components/chat-image-viewer";
import { galleryTiles } from "@/features/chat/model/image-gallery-layout";
import { type ImageGalleryEntry, imageGallery } from "@/features/chat/model/image-gallery-store";
import { type MenuAction, MenuView } from "@/shared/components/menu-view";
import { SheetScrollEdgeEffect } from "@/shared/components/sheet-scroll-edge-effect";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";
import { MIRROR_IN_RTL } from "@/shared/lib/text-direction";
import { useLiquidGlass } from "@/shared/lib/use-liquid-glass";

/** The floating header: its buttons are 48 points high, 8 points under the safe area, as in the chat. */
const HEADER_OFFSET = 8;
const HEADER_HEIGHT = 48;
const PADDING = 16;
const GAP = 4;

/**
 * Every image of one message, from the count under its stack. A tap opens the viewer on an image;
 * the menu saves all of them to Photos or shares all of them at once.
 */
export function ImageGalleryScreen() {
  const { galleryId } = useLocalSearchParams<{ galleryId: string }>();
  const entry = imageGallery(galleryId);

  // The galleries are kept in memory only, so a screen restored after a restart has nothing to show.
  useEffect(() => {
    if (!entry && router.canGoBack()) router.back();
  }, [entry]);
  return entry ? <GalleryContent entry={entry} /> : null;
}

function GalleryContent({ entry }: { entry: ImageGalleryEntry }) {
  const { t } = useText();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const liquidGlass = useLiquidGlass();
  const [foreground, fieldBackground] = useThemeColor(["foreground", "default"]);
  const files = useAttachmentFiles(entry.serverId, entry.images);
  const [saved, setSaved] = useState(false);
  const headerBottom = insets.top + HEADER_OFFSET + HEADER_HEIGHT + HEADER_OFFSET;
  const gridWidth = Math.max(width - insets.left - insets.right - PADDING * 2, 1);
  const layout = galleryTiles(entry.images.length, gridWidth, GAP);
  const title = t("mobile.chat.imageGallery.count", { count: entry.images.length });

  const save: MenuAction = {
    id: "save",
    title: saved ? t("mobile.chat.imageGallery.saved") : t("mobile.chat.imageGallery.saveAll"),
    image: saved ? "checkmark" : "square.and.arrow.down",
    attributes: { disabled: files.busy || saved },
  };
  // An SVG stays out of the photo library, so a gallery of SVG files only has Share.
  const actions: MenuAction[] = [
    ...(entry.images.some(savesToPhotos) ? [save] : []),
    {
      id: "share",
      title: t("mobile.chat.imageGallery.shareAll"),
      image: "square.and.arrow.up",
      attributes: { disabled: files.busy },
    },
  ];

  return (
    <ChatImageViewerProvider serverId={entry.serverId} images={entry.images}>
      <View className="flex-1 bg-background">
        <ScrollView
          contentInsetAdjustmentBehavior="never"
          alwaysBounceVertical={false}
          contentContainerStyle={{
            paddingTop: headerBottom + PADDING,
            paddingBottom: insets.bottom + PADDING,
            paddingLeft: insets.left + PADDING,
            paddingRight: insets.right + PADDING,
          }}
          scrollIndicatorInsets={{ top: headerBottom, bottom: insets.bottom }}
        >
          <View style={{ width: gridWidth, height: layout.height }}>
            {entry.images.map((attachment, index) => {
              const tile = layout.tiles[index];
              return tile ? (
                <ChatGalleryTile key={attachment.id} attachment={attachment} serverId={entry.serverId} tile={tile} />
              ) : null;
            })}
          </View>
        </ScrollView>

        <View
          className="absolute inset-x-0 z-20 flex-row items-center gap-2"
          pointerEvents="box-none"
          style={{ top: insets.top + HEADER_OFFSET, paddingLeft: insets.left + 16, paddingRight: insets.right + 16 }}
        >
          <ChatGlassIconButton
            accessibilityLabel={t("common.back")}
            fallbackBackground={fieldBackground}
            liquidGlassAvailable={liquidGlass}
            onPress={() => {
              void haptics.impact("soft");
              router.back();
            }}
          >
            <ArrowLeft color={String(foreground)} size={24} strokeWidth={2} style={MIRROR_IN_RTL} />
          </ChatGlassIconButton>
          <View className="min-w-0 flex-1 flex-row justify-center" pointerEvents="none">
            <GlassView
              glassEffectStyle={liquidGlass ? "regular" : "none"}
              style={{
                height: HEADER_HEIGHT,
                justifyContent: "center",
                paddingHorizontal: 16,
                backgroundColor: liquidGlass ? "transparent" : fieldBackground,
                borderCurve: "continuous",
                borderRadius: HEADER_HEIGHT / 2,
                overflow: "hidden",
                flexShrink: 1,
              }}
            >
              <Typography.Paragraph weight="semibold" numberOfLines={1} accessibilityRole="header">
                {title}
              </Typography.Paragraph>
            </GlassView>
          </View>
          <MenuView
            actions={actions}
            onPressAction={({ nativeEvent }) => {
              if (nativeEvent.event === "share") files.shareAll();
              else if (nativeEvent.event === "save")
                void files.saveAllToPhotos().then((done) => {
                  if (!done) return;
                  void haptics.notification("success");
                  setSaved(true);
                });
            }}
            style={{ height: HEADER_HEIGHT, width: HEADER_HEIGHT }}
          >
            <GlassView
              glassEffectStyle={liquidGlass ? "regular" : "none"}
              style={{
                height: HEADER_HEIGHT,
                width: HEADER_HEIGHT,
                backgroundColor: liquidGlass ? "transparent" : fieldBackground,
                borderRadius: HEADER_HEIGHT / 2,
                overflow: "hidden",
              }}
            >
              <View
                accessible
                accessibilityRole="button"
                accessibilityLabel={t("mobile.chat.imageGallery.options")}
                accessibilityState={{ busy: files.busy }}
                className="flex-1 items-center justify-center"
              >
                <Ellipsis color={String(foreground)} size={24} strokeWidth={2} />
              </View>
            </GlassView>
          </MenuView>
        </View>
        <SheetScrollEdgeEffect
          style={{ height: headerBottom + 18, left: 0, position: "absolute", right: 0, top: 0, zIndex: 10 }}
        />
      </View>
    </ChatImageViewerProvider>
  );
}
