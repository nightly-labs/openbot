import { type MenuAction, MenuView } from "@expo/ui/community/menu";
import * as Clipboard from "expo-clipboard";
import { GlassView } from "expo-glass-effect";
import * as Linking from "expo-linking";
import { router, useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { AppWindow, ArrowLeft, CodeXml, Ellipsis, Workflow } from "lucide-react-native";
import { type ReactNode, useEffect, useState } from "react";
import { Alert, View, type ViewStyle } from "react-native";
import Animated, { cubicBezier, Easing, Keyframe, useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useUniwind } from "uniwind";
import { ChatGlassIconButton } from "@/features/chat/components/chat-glass-icon-button";
import { CodeDocument } from "@/features/chat/components/code-document";
import DiagramCanvas from "@/features/chat/components/diagram-canvas.dom";
import HtmlPreview from "@/features/chat/components/html-preview.dom";
import { type CodePreviewEntry, codePreview } from "@/features/chat/model/code-preview-store";
import { useMermaidDiagram } from "@/features/chat/model/mermaid-diagrams";
import { SheetScrollEdgeEffect } from "@/shared/components/sheet-scroll-edge-effect";
import { haptics } from "@/shared/lib/haptics";
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
 * A ```html page or a ```mermaid diagram from a reply, on a screen of its own, with the floating
 * glass header of the chat: Back on the left and a menu on the right that switches between the
 * preview and the code and copies the code. The edge swipe also goes back. Both views stay
 * mounted, so the page does not load again when the user switches.
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
  const { t } = useText();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const liquidGlass = useLiquidGlass();
  const { theme } = useUniwind();
  const [foreground, background, fieldBackground] = useThemeColor(["foreground", "background", "default"]);
  const [view, setView] = useState<PreviewView>("preview");
  const [wrap, setWrap] = useState(false);
  const headerBottom = insets.top + HEADER_OFFSET + HEADER_HEIGHT + HEADER_OFFSET;
  const title = entry.kind === "html" ? t("mobile.chat.preview.htmlTitle") : t("mobile.chat.preview.mermaidTitle");
  // The header names what the screen shows now: the page or the diagram, or its code.
  const headerTitle =
    view === "code"
      ? entry.kind === "html"
        ? t("mobile.chat.preview.htmlCode")
        : t("mobile.chat.preview.mermaidCode")
      : title;
  const HeaderIcon = view === "code" ? CodeXml : entry.kind === "html" ? AppWindow : Workflow;

  const select = (next: PreviewView) => {
    if (next === view) return;
    void haptics.selection();
    setView(next);
  };
  const copy = async () => {
    try {
      await Clipboard.setStringAsync(entry.source);
      void haptics.notification("success");
    } catch {
      void haptics.notification("error");
      Alert.alert(t("mobile.chat.code.copyFailed"), t("mobile.chat.copyFailedMessage"));
    }
  };
  const wrapAction: MenuAction = {
    id: "wrap",
    title: t("mobile.chat.preview.wrapLines"),
    image: "text.word.spacing",
    state: wrap ? "on" : "off",
  };
  const actions: MenuAction[] = [
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
    // Wrapping matters only to the code, so the menu offers it there.
    ...(view === "code" ? [wrapAction] : []),
    { id: "copy", title: t("mobile.chat.code.copy"), image: "doc.on.doc" },
  ];

  return (
    <View className="flex-1 bg-background">
      <SwitchLayer shown={view === "preview"} reducedMotion={reducedMotion}>
        {entry.kind === "html" ? (
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
            dom={{ style: { flex: 1 }, containerStyle: { flex: 1 }, scrollEnabled: false }}
          />
        ) : (
          <DiagramPreview
            source={entry.source}
            title={title}
            dark={theme === "dark"}
            insets={{ top: headerBottom, bottom: insets.bottom }}
            background={String(background)}
          />
        )}
      </SwitchLayer>
      <SwitchLayer shown={view === "code"} reducedMotion={reducedMotion}>
        <CodeDocument
          text={entry.source}
          language={entry.language}
          title={headerTitle}
          wrap={wrap}
          topInset={headerBottom}
          bottomInset={insets.bottom}
        />
      </SwitchLayer>

      <View
        className="absolute inset-x-0 z-20 flex-row items-center gap-2 px-4"
        pointerEvents="box-none"
        style={{ top: insets.top + HEADER_OFFSET }}
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
      dom={{ style: { flex: 1 }, containerStyle: { flex: 1 }, scrollEnabled: false }}
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
