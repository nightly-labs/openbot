import { GlassView } from "expo-glass-effect";
import * as Linking from "expo-linking";
import { router, useLocalSearchParams } from "expo-router";
import { Spinner, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import AppWindow from "lucide-react-native/icons/app-window";
import ArrowLeft from "lucide-react-native/icons/arrow-left";
import ChevronLeft from "lucide-react-native/icons/chevron-left";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import CodeXml from "lucide-react-native/icons/code-xml";
import Ellipsis from "lucide-react-native/icons/ellipsis";
import FileCode from "lucide-react-native/icons/file-code";
import FileText from "lucide-react-native/icons/file-text";
import Sheet from "lucide-react-native/icons/sheet";
import Workflow from "lucide-react-native/icons/workflow";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { FlatList, View, type ViewStyle } from "react-native";
import Animated, { cubicBezier, Easing, Keyframe } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useUniwind } from "uniwind";
import { shareLocalAttachment } from "@/features/chat/components/attachment-preview";
import { ScrollingCodeBlock } from "@/features/chat/components/chat-code-block";
import { ChatGlassIconButton, ChatGlassLabel } from "@/features/chat/components/chat-glass-icon-button";
import { ChatMarkdown } from "@/features/chat/components/chat-markdown";
import { CodeDocument } from "@/features/chat/components/code-document";
import DiagramCanvas from "@/features/chat/components/diagram-canvas.dom";
import { SpreadsheetFilePreview } from "@/features/chat/components/file-document-preview";
import { HtmlPage } from "@/features/chat/components/html-page";
import HtmlPreview from "@/features/chat/components/html-preview.dom";
import { PdfPreview } from "@/features/chat/components/pdf-preview";
import { copyToClipboard } from "@/features/chat/components/use-copy-message";
import { type CodePreviewEntry, codePreview } from "@/features/chat/model/code-preview-store";
import { type MarkdownPreviewPart, markdownPreviewSeries } from "@/features/chat/model/markdown-preview-parts";
import { useMermaidDiagram } from "@/features/chat/model/mermaid-diagrams";
import { textPreviewParts } from "@/features/chat/model/text-preview-parts";
import { type MenuAction, MenuView } from "@/shared/components/menu-view";
import { SheetScrollEdgeEffect } from "@/shared/components/sheet-scroll-edge-effect";
import { expoGoDomOptions } from "@/shared/lib/expo-go-dom";
import { haptics } from "@/shared/lib/haptics";
import { useReducedMotion } from "@/shared/lib/motion";
import { useText } from "@/shared/lib/text";
import { MIRROR_IN_RTL } from "@/shared/lib/text-direction";
import { useLiquidGlass } from "@/shared/lib/use-liquid-glass";

type PreviewView = "preview" | "code";

const SWITCH_DURATION = 200;
const SWITCH_EASING = cubicBezier(0.23, 1, 0.32, 1);
const HIDDEN_SCALE = 0.98;
const TITLE_ENTER = new Keyframe({
  0: { opacity: 0, transform: [{ translateY: 4 }] },
  100: { opacity: 1, transform: [{ translateY: 0 }], easing: Easing.bezier(0.23, 1, 0.32, 1) },
}).duration(SWITCH_DURATION);
const HEADER_OFFSET = 8;
const HEADER_HEIGHT = 48;
const PART_BAR_OFFSET = 8;

function webLink(href: string): string | null {
  try {
    const url = new URL(href);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

export function CodePreviewScreen() {
  const { previewId } = useLocalSearchParams<{ previewId: string }>();
  const entry = codePreview(previewId);

  useEffect(() => {
    if (!entry && router.canGoBack()) router.back();
  }, [entry]);
  return entry ? <PreviewContent entry={entry} /> : null;
}

function PreviewContent({ entry }: { entry: CodePreviewEntry }) {
  const { t, format } = useText();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const liquidGlass = useLiquidGlass();
  const { theme } = useUniwind();
  const [foreground, background, fieldBackground] = useThemeColor(["foreground", "background", "default"]);
  const switchable = entry.kind === "html" || entry.kind === "mermaid" || entry.kind === "markdown";
  const documentFile = entry.kind === "pdf" || entry.kind === "spreadsheet";
  const [view, setView] = useState<PreviewView>(entry.kind === "text" ? "code" : "preview");
  const [codeOpened, setCodeOpened] = useState(view === "code");
  if (view === "code" && !codeOpened) setCodeOpened(true);
  const [wrap, setWrap] = useState(false);
  const headerBottom = insets.top + HEADER_OFFSET + HEADER_HEIGHT + HEADER_OFFSET;
  const title =
    entry.file?.name ??
    entry.title ??
    (entry.kind === "html"
      ? t("mobile.chat.preview.htmlTitle")
      : entry.kind === "mermaid"
        ? t("mobile.chat.preview.mermaidTitle")
        : t("mobile.chat.preview.markdownTitle"));
  const headerTitle =
    view === "code" && switchable
      ? entry.kind === "html"
        ? t("mobile.chat.preview.htmlCode")
        : entry.kind === "mermaid"
          ? t("mobile.chat.preview.mermaidCode")
          : t("mobile.chat.preview.markdownCode")
      : title;
  const HeaderIcon =
    view === "code" && switchable
      ? CodeXml
      : entry.kind === "html"
        ? AppWindow
        : entry.kind === "mermaid"
          ? Workflow
          : entry.kind === "text"
            ? FileCode
            : entry.kind === "spreadsheet"
              ? Sheet
              : FileText;
  const textParts = useMemo(() => (codeOpened ? textPreviewParts(entry.source) : null), [codeOpened, entry.source]);
  const [textPart, setTextPart] = useState(0);
  const partCount = textParts?.length ?? 0;
  const shownPart = textParts?.[Math.min(textPart, partCount - 1)];
  const selectPart = (next: number) => {
    void haptics.impact("soft");
    setTextPart(next);
  };
  const codeText = shownPart ? entry.source.slice(shownPart.start, shownPart.end) : "";
  const file = entry.file;

  const select = (next: PreviewView) => {
    if (next === view) return;
    void haptics.selection();
    setView(next);
  };
  const copy = () => copyToClipboard(entry.source, "mobile.chat.code.copyFailed", t);
  const wrapAction: MenuAction = {
    id: "wrap",
    title: t("mobile.chat.preview.wrapLines"),
    image: "text.word.spacing",
    state: wrap ? "on" : "off",
  };
  const shareAction: MenuAction = { id: "share", title: t("mobile.chat.preview.share"), image: "square.and.arrow.up" };
  const copyAction: MenuAction = { id: "copy", title: t("mobile.chat.code.copy"), image: "doc.on.doc" };
  const viewActions: MenuAction[] = [
    {
      id: "view",
      title: "",
      displayInline: true,
      subactions: [
        {
          id: "preview",
          title: t("mobile.chat.preview.preview"),
          image: "eye",
          state: view === "preview" ? "on" : "off",
        },
        {
          id: "code",
          title: t("mobile.chat.preview.code"),
          image: "chevron.left.forwardslash.chevron.right",
          state: view === "code" ? "on" : "off",
        },
      ],
    },
  ];
  const actions: MenuAction[] = [
    ...(switchable ? viewActions : []),
    ...(view === "code" ? [wrapAction] : []),
    ...(documentFile ? [] : [copyAction]),
    ...(file ? [shareAction] : []),
  ];

  return (
    <View className="flex-1 bg-background">
      <SwitchLayer shown={view === "preview"} reducedMotion={reducedMotion}>
        {entry.kind === "text" ? null : entry.kind === "pdf" && file ? (
          <PdfPreview uri={file.uri} title={title} insets={{ top: headerBottom, bottom: insets.bottom }} />
        ) : entry.kind === "spreadsheet" && file ? (
          <SpreadsheetFilePreview uri={file.uri} title={title} insets={{ top: headerBottom, bottom: insets.bottom }} />
        ) : entry.kind === "html" && file && HtmlPage ? (
          <HtmlPage
            source={entry.source}
            title={title}
            mode="screen"
            insets={{ top: headerBottom, bottom: insets.bottom }}
          />
        ) : entry.kind === "html" ? (
          <HtmlPreview
            source={entry.source}
            title={title}
            mode="screen"
            topInset={headerBottom}
            bottomInset={insets.bottom}
            background={String(background)}
            onOpenLink={async (href) => {
              const url = webLink(href);
              if (url) await Linking.openURL(url);
            }}
            dom={{ ...expoGoDomOptions, style: { flex: 1 }, containerStyle: { flex: 1 }, scrollEnabled: false }}
          />
        ) : entry.kind === "markdown" ? (
          <MarkdownPreview source={entry.source} insets={{ top: headerBottom, bottom: insets.bottom }} />
        ) : entry.kind === "mermaid" ? (
          <DiagramPreview
            source={entry.source}
            title={title}
            dark={theme === "dark"}
            insets={{ top: headerBottom, bottom: insets.bottom }}
            background={String(background)}
          />
        ) : null}
      </SwitchLayer>
      {documentFile || !codeOpened ? null : (
        <SwitchLayer shown={view === "code"} reducedMotion={reducedMotion}>
          <CodeDocument
            key={textPart}
            text={codeText}
            firstLine={shownPart?.firstLine ?? 1}
            language={entry.language}
            title={headerTitle}
            wrap={wrap}
            topInset={headerBottom}
            bottomInset={partCount > 1 ? insets.bottom + PART_BAR_OFFSET + HEADER_HEIGHT : insets.bottom}
          />
        </SwitchLayer>
      )}
      {view === "code" && partCount > 1 ? (
        <View
          className="absolute inset-x-0 z-20 flex-row items-center justify-center gap-2"
          pointerEvents="box-none"
          style={{
            bottom: insets.bottom + PART_BAR_OFFSET,
            paddingLeft: insets.left + 16,
            paddingRight: insets.right + 16,
          }}
        >
          <ChatGlassIconButton
            accessibilityLabel={t("mobile.chat.preview.previousPart")}
            disabled={textPart === 0}
            fallbackBackground={fieldBackground}
            liquidGlassAvailable={liquidGlass}
            onPress={() => selectPart(textPart - 1)}
          >
            <ChevronLeft color={String(foreground)} size={24} strokeWidth={2} style={MIRROR_IN_RTL} />
          </ChatGlassIconButton>
          <ChatGlassLabel fallbackBackground={fieldBackground} liquidGlassAvailable={liquidGlass}>
            <Typography.Paragraph type="body-sm" className="font-semibold text-foreground">
              {t("mobile.chat.preview.part", { part: format.number(textPart + 1), total: format.number(partCount) })}
            </Typography.Paragraph>
          </ChatGlassLabel>
          <ChatGlassIconButton
            accessibilityLabel={t("mobile.chat.preview.nextPart")}
            disabled={textPart === partCount - 1}
            fallbackBackground={fieldBackground}
            liquidGlassAvailable={liquidGlass}
            onPress={() => selectPart(textPart + 1)}
          >
            <ChevronRight color={String(foreground)} size={24} strokeWidth={2} style={MIRROR_IN_RTL} />
          </ChatGlassIconButton>
        </View>
      ) : null}

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
        <GlassCapsule liquidGlass={liquidGlass} fallbackBackground={fieldBackground} style={{ flexShrink: 1 }}>
          <Animated.View
            key={view}
            entering={reducedMotion ? undefined : TITLE_ENTER}
            className="min-w-0 shrink flex-row items-center gap-2 px-4"
            accessibilityRole="header"
          >
            <HeaderIcon color={String(foreground)} size={18} />
            <Typography.Paragraph className="min-w-0 shrink" weight="semibold" numberOfLines={1}>
              {headerTitle}
            </Typography.Paragraph>
          </Animated.View>
        </GlassCapsule>
        <View className="flex-1" />
        <MenuView
          actions={actions}
          onPressAction={({ nativeEvent }) => {
            if (nativeEvent.event === "copy") void copy();
            else if (nativeEvent.event === "share" && file) void shareLocalAttachment(file);
            else if (nativeEvent.event === "wrap") {
              void haptics.selection();
              setWrap((current) => !current);
            } else if (nativeEvent.event === "preview" || nativeEvent.event === "code") select(nativeEvent.event);
          }}
          style={{ height: HEADER_HEIGHT, width: HEADER_HEIGHT }}
        >
          <GlassCapsule liquidGlass={liquidGlass} fallbackBackground={fieldBackground} style={{ width: HEADER_HEIGHT }}>
            <View
              accessible
              accessibilityRole="button"
              accessibilityLabel={t("mobile.chat.preview.options")}
              className="flex-1 items-center justify-center"
            >
              <Ellipsis color={String(foreground)} size={24} strokeWidth={2} />
            </View>
          </GlassCapsule>
        </MenuView>
      </View>
      <SheetScrollEdgeEffect
        style={{ height: headerBottom + 18, left: 0, position: "absolute", right: 0, top: 0, zIndex: 10 }}
      />
    </View>
  );
}

function GlassCapsule({
  liquidGlass,
  fallbackBackground,
  style,
  children,
}: {
  liquidGlass: boolean;
  fallbackBackground: ViewStyle["backgroundColor"];
  style?: ViewStyle;
  children: ReactNode;
}) {
  return (
    <GlassView
      glassEffectStyle={liquidGlass ? "regular" : "none"}
      style={{
        height: HEADER_HEIGHT,
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: liquidGlass ? "transparent" : fallbackBackground,
        borderCurve: "continuous",
        borderRadius: HEADER_HEIGHT / 2,
        overflow: "hidden",
        ...style,
      }}
    >
      {children}
    </GlassView>
  );
}

const PART_GAP = 10;

function MarkdownPreview({ source, insets }: { source: string; insets: { top: number; bottom: number } }) {
  const sides = useSafeAreaInsets();
  const text = useMemo(() => source.replace(/\r\n?/gu, "\n"), [source]);
  const [series, setSeries] = useState(() => markdownPreviewSeries(text));
  const readNext = () =>
    setSeries((current) => {
      if (current.next === null) return current;
      const next = markdownPreviewSeries(text, current.next, current.definitions);
      return { ...next, parts: [...current.parts, ...next.parts] };
    });
  return (
    <FlatList<MarkdownPreviewPart>
      data={series.parts}
      keyExtractor={(part) => part.key}
      contentInsetAdjustmentBehavior="never"
      contentContainerStyle={{
        paddingTop: insets.top,
        paddingBottom: insets.bottom + 24,
        paddingLeft: sides.left + 20,
        paddingRight: sides.right + 20,
      }}
      scrollIndicatorInsets={{ top: insets.top, bottom: insets.bottom }}
      initialNumToRender={4}
      windowSize={5}
      removeClippedSubviews
      onEndReached={readNext}
      onEndReachedThreshold={2}
      renderItem={({ item, index }) => (
        <View style={{ paddingTop: index === 0 ? 0 : PART_GAP }}>
          {item.kind === "code" ? (
            <ScrollingCodeBlock text={item.text} pieces={item.pieces} language={item.language} />
          ) : (
            <ChatMarkdown body={item.source} color={undefined} finished selectable />
          )}
        </View>
      )}
      ListFooterComponent={series.next === null ? undefined : <Spinner className="self-center pt-4" />}
    />
  );
}

function DiagramPreview({
  source,
  title,
  dark,
  insets,
  background,
}: {
  source: string;
  title: string;
  dark: boolean;
  insets: { top: number; bottom: number };
  background: string;
}) {
  const { t } = useText();
  const diagram = useMermaidDiagram(source, dark);
  if (diagram?.status !== "ready")
    return (
      <View className="flex-1 items-center justify-center px-6">
        <Typography.Paragraph className="text-center text-muted">
          {diagram?.status === "failed" ? t("mobile.chat.preview.failed") : t("mobile.chat.preview.drawing")}
        </Typography.Paragraph>
      </View>
    );
  return (
    <DiagramCanvas
      url={diagram.svgUrl}
      alt={title}
      insets={insets}
      background={background}
      dom={{ ...expoGoDomOptions, style: { flex: 1 }, containerStyle: { flex: 1 }, scrollEnabled: false }}
    />
  );
}

function SwitchLayer({
  shown,
  reducedMotion,
  children,
}: {
  shown: boolean;
  reducedMotion: boolean;
  children: ReactNode;
}) {
  return (
    <Animated.View
      pointerEvents={shown ? "auto" : "none"}
      accessibilityElementsHidden={!shown}
      importantForAccessibility={shown ? "auto" : "no-hide-descendants"}
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        opacity: shown ? 1 : 0,
        transform: [{ scale: shown || reducedMotion ? 1 : HIDDEN_SCALE }],
        transitionProperty: ["opacity", "transform"],
        transitionDuration: SWITCH_DURATION,
        transitionTimingFunction: SWITCH_EASING,
      }}
    >
      {children}
    </Animated.View>
  );
}
