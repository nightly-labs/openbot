import type { ChatPreviewKind } from "@openbot/contracts/chat-preview";
import { Image } from "expo-image";
import { router } from "expo-router";
import { Skeleton, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { ChevronRight, CodeXml, Workflow } from "lucide-react-native";
import { memo, useState } from "react";
import { Pressable, useWindowDimensions, View } from "react-native";
import Animated, { cubicBezier, useReducedMotion } from "react-native-reanimated";
import { useUniwind } from "uniwind";
import { storeCodePreview } from "@/features/chat/model/code-preview-store";
import { useMermaidDiagram } from "@/features/chat/model/mermaid-diagrams";
import { expoGoDomOptions } from "@/shared/lib/expo-go-dom";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";
import HtmlPreview from "./html-preview.dom";

/** The lines of code that the card shows while the block streams, or when it cannot draw it. */
const EXCERPT_LINES = 4;
const PRESS_EASING = cubicBezier(0.23, 1, 0.32, 1);
/** The picture is landscape: twice as wide as it is high. */
const PREVIEW_ASPECT = 2;
/** A wide, flat diagram is not drawn lower than this. */
const DIAGRAM_MIN_HEIGHT = 72;
/** The card is as wide as the bubble allows, as an image attachment is. */
const CARD_SIDE_SPACE = 80;

/**
 * A ```html or ```mermaid block in a reply: a card with a header and a small picture of the page
 * or the diagram, so the block does not fill the conversation. A tap opens it on a screen of its
 * own. While the block streams, the card shows its first lines of code instead.
 */
export const ChatCodePreview = memo(function ChatCodePreview({
  kind,
  text,
  language,
  streaming = false,
}: {
  kind: ChatPreviewKind;
  text: string;
  language?: string;
  streaming?: boolean;
}) {
  const { t } = useText();
  const reducedMotion = useReducedMotion();
  const [muted, foreground] = useThemeColor(["muted", "foreground"]);
  const [pressed, setPressed] = useState(false);
  const [width, setWidth] = useState(0);
  const screen = useWindowDimensions();
  const previewHeight = Math.round(width / PREVIEW_ASPECT);
  const title = kind === "html" ? t("mobile.chat.preview.htmlTitle") : t("mobile.chat.preview.mermaidTitle");
  const lineCount = text.split("\n").length;
  const Icon = kind === "html" ? CodeXml : Workflow;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={t("mobile.chat.preview.openHint")}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      style={{ width: screen.width - CARD_SIDE_SPACE, maxWidth: "100%" }}
      // The picture fills the card inside its 1-point border.
      onLayout={(event) => setWidth(Math.round(event.nativeEvent.layout.width) - 2)}
      onPress={() => {
        void haptics.impact("soft");
        const previewId = storeCodePreview({ kind, source: text, language });
        router.push({ pathname: "/code-preview/[previewId]", params: { previewId } });
      }}
    >
      <Animated.View
        className="overflow-hidden border border-separator bg-control/50"
        style={{
          borderRadius: 18,
          borderCurve: "continuous",
          transform: [{ scale: pressed && !reducedMotion ? 0.97 : 1 }],
          transitionProperty: "transform",
          transitionDuration: 120,
          transitionTimingFunction: PRESS_EASING,
        }}
      >
        <View className="flex-row items-center gap-2.5 border-b border-separator px-3 py-2.5">
          <Icon size={18} color={String(foreground)} />
          <View className="min-w-0 shrink grow flex-row items-baseline gap-2">
            <Typography.Paragraph type="body-sm" className="shrink font-semibold text-foreground" numberOfLines={1}>
              {title}
            </Typography.Paragraph>
            <Typography.Paragraph type="body-xs" className="text-muted" numberOfLines={1}>
              {t("mobile.chat.preview.lines", { count: lineCount })}
            </Typography.Paragraph>
          </View>
          <ChevronRight size={18} color={String(muted)} />
        </View>
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {streaming ? (
            <CodeExcerpt text={text} />
          ) : width <= 0 ? null : kind === "html" ? (
            <HtmlCardPreview text={text} title={title} height={previewHeight} />
          ) : (
            <DiagramCardPreview text={text} title={title} width={width} height={previewHeight} />
          )}
        </View>
      </Animated.View>
    </Pressable>
  );
});

function CodeExcerpt({ text }: { text: string }) {
  // Each line keeps its row in the block, which is a stable key while the block streams.
  const excerpt = text
    .split("\n")
    .map((line, row) => ({ line, row }))
    .filter(({ line }) => line.trim())
    .slice(0, EXCERPT_LINES);
  return (
    <View className="gap-0.5 px-3 py-2.5">
      {excerpt.map(({ line, row }, index) => (
        <Typography.Code
          key={row}
          numberOfLines={1}
          className="bg-transparent p-0 text-muted"
          // The last line fades, so the excerpt reads as the start of a longer block.
          style={{ fontSize: 12, lineHeight: 17, opacity: index === EXCERPT_LINES - 1 ? 0.45 : 1 }}
        >
          {line}
        </Typography.Code>
      ))}
    </View>
  );
}

/** The page at a phone width, scaled down to the card. It takes no touches, so the card opens it. */
function HtmlCardPreview({ text, title, height }: { text: string; title: string; height: number }) {
  const background = useThemeColor("background");
  return (
    <View style={{ height }} pointerEvents="none">
      <HtmlPreview
        source={text}
        title={title}
        mode="card"
        background={String(background)}
        dom={{
          ...expoGoDomOptions,
          style: { flex: 1 },
          containerStyle: { flex: 1 },
          pointerEvents: "none",
          scrollEnabled: false,
        }}
      />
    </View>
  );
}

/**
 * The diagram from the shared renderer at the full width of the card. A tall diagram shows its
 * top and the card cuts the rest; the screen shows it whole.
 */
function DiagramCardPreview({
  text,
  title,
  width,
  height,
}: {
  text: string;
  title: string;
  width: number;
  height: number;
}) {
  const { t } = useText();
  const { theme } = useUniwind();
  const diagram = useMermaidDiagram(text, theme === "dark");
  if (!diagram || diagram.status === "failed") return <CodeExcerpt text={text} />;
  if (diagram.status === "drawing")
    return (
      <Skeleton
        isLoading
        accessible
        accessibilityLabel={t("mobile.chat.preview.drawing")}
        className="rounded-none"
        style={{ height }}
      />
    );
  if (!diagram.pngUrl || !diagram.width) return <CodeExcerpt text={text} />;
  const imageHeight = (width * diagram.height) / diagram.width;
  const frameHeight = Math.max(DIAGRAM_MIN_HEIGHT, Math.min(height, imageHeight));
  return (
    <View
      style={{
        height: frameHeight,
        overflow: "hidden",
        justifyContent: imageHeight < frameHeight ? "center" : "flex-start",
      }}
    >
      <Image
        source={diagram.pngUrl}
        contentFit="fill"
        transition={150}
        accessibilityLabel={title}
        style={{ width, height: imageHeight }}
      />
    </View>
  );
}
