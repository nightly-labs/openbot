import * as Clipboard from "expo-clipboard";
import { GlassView } from "expo-glass-effect";
import * as Linking from "expo-linking";
import { router, useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import AppWindow from "lucide-react-native/icons/app-window";
import ArrowLeft from "lucide-react-native/icons/arrow-left";
import CodeXml from "lucide-react-native/icons/code-xml";
import Ellipsis from "lucide-react-native/icons/ellipsis";
import FileCode from "lucide-react-native/icons/file-code";
import FileText from "lucide-react-native/icons/file-text";
import Sheet from "lucide-react-native/icons/sheet";
import Workflow from "lucide-react-native/icons/workflow";
import { type ReactNode, useEffect, useState } from "react";
import { ScrollView, View, type ViewStyle } from "react-native";
import Animated, { cubicBezier, Easing, Keyframe } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useUniwind } from "uniwind";
import { showFailureAlert } from "@/features/analytics/failure-reports";
import { shareLocalAttachment } from "@/features/chat/components/attachment-preview";
import { ChatGlassIconButton } from "@/features/chat/components/chat-glass-icon-button";
import { ChatMarkdown } from "@/features/chat/components/chat-markdown";
import { CodeDocument } from "@/features/chat/components/code-document";
import DiagramCanvas from "@/features/chat/components/diagram-canvas.dom";
import { SpreadsheetFilePreview } from "@/features/chat/components/file-document-preview";
import { HtmlPage } from "@/features/chat/components/html-page";
import HtmlPreview from "@/features/chat/components/html-preview.dom";
import { PdfPreview } from "@/features/chat/components/pdf-preview";
import { PREVIEW_TEXT_LIMIT } from "@/features/chat/model/attachment-file-preview";
import { type CodePreviewEntry, codePreview } from "@/features/chat/model/code-preview-store";
import { useMermaidDiagram } from "@/features/chat/model/mermaid-diagrams";
import { type MenuAction, MenuView } from "@/shared/components/menu-view";
import { SheetScrollEdgeEffect } from "@/shared/components/sheet-scroll-edge-effect";
import { expoGoDomOptions } from "@/shared/lib/expo-go-dom";
import { haptics } from "@/shared/lib/haptics";
import { useReducedMotion } from "@/shared/lib/motion";
import { useText } from "@/shared/lib/text";
import { useLiquidGlass } from "@/shared/lib/use-liquid-glass";

type PreviewView = "preview" | "code";

const SWITCH_DURATION = 200;
const SWITCH_EASING = cubicBezier(0.23, 1, 0.32, 1);
const HIDDEN_SCALE = 0.98;
/** The header title rises into place when the view changes, in step with the views. */
const TITLE_ENTER = new Keyframe({
  0: { opacity: 0, transform: [{ translateY: 4 }] },
  100: { opacity: 1, transform: [{ translateY: 0 }], easing: Easing.bezier(0.23, 1, 0.32, 1) },
}).duration(SWITCH_DURATION);
/** The floating header: its buttons are 48 points high, 8 points under the safe area, as in the chat. */
const HEADER_OFFSET = 8;
const HEADER_HEIGHT = 48;

function webLink(href: string): string | null {
  try {
    const url = new URL(href);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * A ```html page or a ```mermaid diagram from a reply, or a file from the chat, on a screen of its
 * own, with the floating glass header of the chat: Back on the left and a menu on the right that
 * switches between the preview and the code, copies the code and shares a file. The edge swipe
 * also goes back. Both views stay mounted, so the page does not load again when the user switches.
 * A text file has only the code view, and a PDF or a spreadsheet only the preview.
 */
export function CodePreviewScreen() {
  const { previewId } = useLocalSearchParams<{ previewId: string }>();
  const entry = codePreview(previewId);

  // The blocks are kept in memory only, so a screen restored after a restart has nothing to show.
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
  // A page, a diagram and a Markdown file have both views. A text file is its code.
  const switchable = entry.kind === "html" || entry.kind === "mermaid" || entry.kind === "markdown";
  const documentFile = entry.kind === "pdf" || entry.kind === "spreadsheet";
  const [view, setView] = useState<PreviewView>(entry.kind === "text" ? "code" : "preview");
  const [wrap, setWrap] = useState(false);
  const headerBottom = insets.top + HEADER_OFFSET + HEADER_HEIGHT + HEADER_OFFSET;
  const title =
    entry.file?.name ??
    (entry.kind === "html"
      ? t("mobile.chat.preview.htmlTitle")
      : entry.kind === "mermaid"
        ? t("mobile.chat.preview.mermaidTitle")
        : t("mobile.chat.preview.markdownTitle"));
  // The header names what the screen shows now: the page, the diagram or the document, or its code.
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
  // An HTML page keeps its whole source for the page view; the code view shows only the first part.
  const codeText = entry.source.slice(0, PREVIEW_TEXT_LIMIT);
  const truncatedNote =
    entry.truncated || codeText.length < entry.source.length
      ? t("mobile.chat.preview.truncated", { limit: format.number(PREVIEW_TEXT_LIMIT) })
      : null;
  const file = entry.file;

  const select = (next: PreviewView) => {
    if (next === view) return;
    void haptics.selection();
    setView(next);
  };
  const copy = async () => {
    try {
      await Clipboard.setStringAsync(entry.source);
      void haptics.notification("success");
    } catch (error) {
      void haptics.notification("error");
      showFailureAlert(error, "turn", t("mobile.chat.code.copyFailed"), t("mobile.chat.copyFailedMessage"));
    }
  };
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
    // Wrapping matters only to the code, so the menu offers it there.
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
          // An HTML file runs its scripts, as on desktop; a ```html block from a reply does not.
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
          <MarkdownPreview
            source={entry.source}
            note={truncatedNote}
            insets={{ top: headerBottom, bottom: insets.bottom }}
          />
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
      {documentFile ? null : (
        <SwitchLayer shown={view === "code"} reducedMotion={reducedMotion}>
          <CodeDocument
            text={codeText}
            language={entry.language}
            title={headerTitle}
            wrap={wrap}
            topInset={headerBottom}
            bottomInset={insets.bottom}
            note={truncatedNote}
          />
        </SwitchLayer>
      )}

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
          <ArrowLeft color={String(foreground)} size={24} strokeWidth={2} />
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

/** A glass capsule of the header height, as the chat header draws its title. The menu owns the touch. */
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

/** A Markdown file, drawn as the chat draws a reply, with selectable text. */
function MarkdownPreview({
  source,
  note,
  insets,
}: {
  source: string;
  /** Says that the file goes on past what the screen shows. */
  note: string | null;
  insets: { top: number; bottom: number };
}) {
  const sides = useSafeAreaInsets();
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="never"
      contentContainerStyle={{
        paddingTop: insets.top,
        paddingBottom: insets.bottom + 24,
        paddingLeft: sides.left + 20,
        paddingRight: sides.right + 20,
      }}
      scrollIndicatorInsets={{ top: insets.top, bottom: insets.bottom }}
    >
      <ChatMarkdown body={source} color={undefined} finished selectable />
      {note ? (
        <Typography.Paragraph type="body-sm" className="pt-4 text-muted">
          {note}
        </Typography.Paragraph>
      ) : null}
    </ScrollView>
  );
}

/** The diagram from the shared renderer. It is usually ready, because the chat card drew it. */
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

/** One of the two views. The one that leaves fades and sinks back a little; the new one rises. */
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
