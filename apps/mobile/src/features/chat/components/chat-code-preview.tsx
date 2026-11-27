import type { ChatPreviewKind } from "@openbot/contracts/chat-preview";
import { Image } from "expo-image";
import { router } from "expo-router";
import { Skeleton, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import CodeXml from "lucide-react-native/icons/code-xml";
import Workflow from "lucide-react-native/icons/workflow";
import { memo, useState } from "react";
import { Pressable, useWindowDimensions, View } from "react-native";
import Animated, { cubicBezier } from "react-native-reanimated";
import { useUniwind } from "uniwind";
import type { BubbleTone } from "@/features/chat/model/bubble-tone";
import { type CodePreviewEntry, storeCodePreview } from "@/features/chat/model/code-preview-store";
import { loadMermaidDiagram, useMermaidDiagram, useMermaidHeld } from "@/features/chat/model/mermaid-diagrams";
import { expoGoDomOptions } from "@/shared/lib/expo-go-dom";
import { haptics } from "@/shared/lib/haptics";
import { useReducedMotion } from "@/shared/lib/motion";
import { useText } from "@/shared/lib/text";
import { CODE_LAYOUT_STYLE, CODE_TEXT_STYLE, MIRROR_IN_RTL } from "@/shared/lib/text-direction";
import HtmlPreview from "./html-preview.dom";
import { RemoteContentHold } from "./remote-content-hold";
import { useHistoryShown } from "./use-history-shown";
import { useListSettled } from "./use-list-settled";

const EXCERPT_LINES = 4;
const PRESS_EASING = cubicBezier(0.23, 1, 0.32, 1);
const PREVIEW_ASPECT = 2;
const DIAGRAM_MIN_HEIGHT = 72;
const CARD_SIDE_SPACE = 80;
const knownCardWidths = new Map<number, number>();

export const ChatCodePreview = memo(function ChatCodePreview({
  kind,
  text,
  language,
  streaming = false,
  file,
  tone,
  remoteContent = false,
}: {
  kind: ChatPreviewKind;
  text: string;
  language?: string;
  streaming?: boolean;
  file?: CodePreviewEntry["file"];
  tone?: BubbleTone;
  remoteContent?: boolean;
}) {
  const { t } = useText();
  const reducedMotion = useReducedMotion();
  const settled = useListSettled();
  const historyShown = useHistoryShown();
  const [themeMuted, themeForeground] = useThemeColor(["muted", "foreground"]);
  const muted = tone?.muted ?? themeMuted;
  const foreground = tone?.foreground ?? themeForeground;
  const line = tone ? { borderColor: tone.line } : undefined;
  const [pressed, setPressed] = useState(false);
  const screen = useWindowDimensions();
  const [width, setWidth] = useState(() => knownCardWidths.get(screen.width) ?? 0);
  const previewHeight = Math.round(width / PREVIEW_ASPECT);
  const title = kind === "html" ? t("mobile.chat.preview.htmlTitle") : t("mobile.chat.preview.mermaidTitle");
  const lineCount = text.split("\n").length;
  const Icon = kind === "html" ? CodeXml : Workflow;
  const held = useMermaidHeld(text, remoteContent) && kind === "mermaid" && !streaming;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={t("mobile.chat.preview.openHint")}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      style={{ width: screen.width - CARD_SIDE_SPACE, maxWidth: "100%" }}
      onLayout={(event) => {
        const inner = Math.round(event.nativeEvent.layout.width) - 2;
        if (inner > 0) knownCardWidths.set(screen.width, inner);
        setWidth(inner);
      }}
      onPress={() => {
        void haptics.impact("soft");
        const previewId = storeCodePreview({ kind, source: text, language, remoteContent, ...(file ? { file } : {}) });
        router.push({ pathname: "/code-preview/[previewId]", params: { previewId } });
      }}
    >
      <Animated.View
        className={`overflow-hidden border ${tone ? "" : "border-separator bg-control/50"}`}
        style={{
          ...line,
          backgroundColor: tone?.panel,
          borderRadius: 18,
          borderCurve: "continuous",
          transform: [{ scale: pressed && !reducedMotion ? 0.97 : 1 }],
          transitionProperty: "transform",
          transitionDuration: 120,
          transitionTimingFunction: PRESS_EASING,
        }}
      >
        <View
          className={`flex-row items-center gap-2.5 border-b px-3 py-2.5 ${tone ? "" : "border-separator"}`}
          style={line}
        >
          <Icon size={18} color={String(foreground)} />
          <View className="min-w-0 shrink grow flex-row items-baseline gap-2">
            <Typography.Paragraph
              type="body-sm"
              className="shrink font-semibold text-foreground"
              numberOfLines={1}
              style={tone ? { color: tone.foreground } : undefined}
            >
              {title}
            </Typography.Paragraph>
            <Typography.Paragraph
              type="body-xs"
              className="text-muted"
              numberOfLines={1}
              style={tone ? { color: tone.muted } : undefined}
            >
              {t("mobile.chat.preview.lines", { count: lineCount })}
            </Typography.Paragraph>
          </View>
          <ChevronRight size={18} color={String(muted)} style={MIRROR_IN_RTL} />
        </View>
        {held ? (
          <RemoteContentHold
            message={t("mobile.chat.preview.diagramRemoteContent")}
            action={t("mobile.chat.preview.loadDiagram")}
            color={tone?.muted}
            onPress={() => loadMermaidDiagram(text)}
          />
        ) : null}
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {held ? null : streaming ? (
            <CodeExcerpt text={text} color={tone?.muted} />
          ) : width <= 0 ? (
            <View style={{ aspectRatio: PREVIEW_ASPECT }} />
          ) : !settled || (kind === "html" && !historyShown) ? (
            <View style={{ height: previewHeight }} />
          ) : kind === "html" ? (
            <HtmlCardPreview text={text} title={title} height={previewHeight} />
          ) : (
            <DiagramCardPreview
              text={text}
              title={title}
              width={width}
              height={previewHeight}
              draw={historyShown}
              remoteContent={remoteContent}
            />
          )}
        </View>
      </Animated.View>
    </Pressable>
  );
});

function CodeExcerpt({ text, color }: { text: string; color?: string }) {
  const excerpt = text
    .split("\n")
    .map((line, row) => ({ line, row }))
    .filter(({ line }) => line.trim())
    .slice(0, EXCERPT_LINES);
  return (
    <View className="gap-0.5 px-3 py-2.5" style={CODE_LAYOUT_STYLE}>
      {excerpt.map(({ line, row }, index) => (
        <Typography.Code
          key={row}
          numberOfLines={1}
          className="bg-transparent p-0 text-muted"
          style={[
            CODE_TEXT_STYLE,
            { fontSize: 12, lineHeight: 17, opacity: index === EXCERPT_LINES - 1 ? 0.45 : 1 },
            color ? { color } : undefined,
          ]}
        >
          {line}
        </Typography.Code>
      ))}
    </View>
  );
}

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

function DiagramCardPreview({
  text,
  title,
  width,
  height,
  draw,
  remoteContent,
}: {
  text: string;
  title: string;
  width: number;
  height: number;
  draw: boolean;
  remoteContent: boolean;
}) {
  const { t } = useText();
  const { theme } = useUniwind();
  const diagram = useMermaidDiagram(text, theme === "dark", remoteContent, draw);
  if (diagram?.status === "failed" || diagram?.status === "held") return <CodeExcerpt text={text} />;
  if (!diagram || diagram.status === "drawing")
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
