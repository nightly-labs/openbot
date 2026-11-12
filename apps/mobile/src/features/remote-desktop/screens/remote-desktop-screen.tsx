import type { MobileTextKey } from "@openbot/i18n/mobile";
import * as Clipboard from "expo-clipboard";
import { GlassView } from "expo-glass-effect";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { Button, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import ArrowDown from "lucide-react-native/icons/arrow-down";
import ArrowLeft from "lucide-react-native/icons/arrow-left";
import ArrowRight from "lucide-react-native/icons/arrow-right";
import ArrowUp from "lucide-react-native/icons/arrow-up";
import CircleQuestionMark from "lucide-react-native/icons/circle-question-mark";
import ClipboardList from "lucide-react-native/icons/clipboard-list";
import Ellipsis from "lucide-react-native/icons/ellipsis";
import Keyboard from "lucide-react-native/icons/keyboard";
import KeyboardOff from "lucide-react-native/icons/keyboard-off";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import {
  AppState,
  ScrollView,
  TextInput,
  type TextInputInstance,
  type TextInputKeyPressEvent,
  View,
  type ViewStyle,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import { useUniwind } from "uniwind";
import { checkDeviceUnlock } from "@/features/app-lock/model/app-lock";
import { ChatGlassButton, ChatGlassIconButton } from "@/features/chat/components/chat-glass-icon-button";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { type MenuAction, MenuView } from "@/shared/components/menu-view";
import { toolbarMenuItems } from "@/shared/components/toolbar-menu-items";
import { haptics } from "@/shared/lib/haptics";
import { useReducedMotion } from "@/shared/lib/motion";
import { NATIVE_BAR_HEIGHT } from "@/shared/lib/native-bar";
import { isIOS } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";
import { MIRROR_IN_RTL } from "@/shared/lib/text-direction";
import { useAppForeground } from "@/shared/lib/use-app-foreground";
import { useLiquidGlass } from "@/shared/lib/use-liquid-glass";
import { menuIcon } from "../model/menu-icons";
import {
  endRemoteDesktopSession,
  type RemoteDesktopHost,
  type RemoteDesktopViewerSession,
  readRemoteDesktopHost,
  selectRemoteDesktopDisplay,
  startRemoteDesktopSession,
} from "../model/remote-desktop-api";
import {
  receiveRemoteDesktopStats,
  setRemoteDesktopStatsOpen,
  useRemoteDesktopStatsOpen,
} from "../model/remote-desktop-stats";
import { typedChange } from "../model/remote-keys";
import { remoteViewerProxyNative } from "../model/remote-viewer-proxy-native";
import {
  type ViewerQuality,
  type ViewerTouchMode,
  viewerCall,
  viewerPageScript,
  viewerQualityFps,
  viewerTouchModeValue,
} from "../model/viewer-page-script";
import { startViewerProxy, type ViewerProxy, type ViewerRoute } from "../model/viewer-proxy";

/** As on desktop: room for Moonlight's own WebRTC timeout and for the host to start its stream. */
const STREAM_READY_TIMEOUT_MS = 60_000;
/**
 * A new display restarts the host's stream: the viewer reports the old stream's end, then loads
 * again. A switch that shows no picture in this time failed.
 */
const DISPLAY_SWITCH_MS = 30_000;
const KEEP_AWAKE_TAG = "remote-desktop";
/** The floating controls are 48 points, 8 points from the safe area, as in the chat and the browser. */
const CONTROL_SIZE = 48;
const CONTROL_OFFSET = 8;
const KEY_HEIGHT = 40;
/** A key with an icon is round, so the icons of the bar line up. */
const ICON_KEY_WIDTH = 48;
const TITLE_HEIGHT = isIOS ? NATIVE_BAR_HEIGHT : CONTROL_SIZE;
const TITLE_MAX_WIDTH = 220;
/** The hidden field is emptied past this length, so its text never grows with a long session. */
const KEYBOARD_FIELD_MAX_LENGTH = 256;
/** A paste goes as key presses, so it is kept short. */
const PASTE_MAX_LENGTH = 2_000;
const NOTICE_MS = 2_200;

// The choices of this app run. A new stream starts with them.
let chosenQuality: ViewerQuality = "smooth";
let chosenTouchMode: ViewerTouchMode = "trackpad";

type Phase =
  | { type: "starting" }
  | { type: "viewing"; url: string; script: string; host: RemoteDesktopHost; session: RemoteDesktopViewerSession }
  | { type: "failed"; message: string }
  | { type: "paused" };

/**
 * The viewer's own state. A failure keeps the page. While the display changes, the old stream's end
 * is kept as `lastError`, and shows only when the new stream does not come.
 */
type ViewerStatus =
  | { kind: "connecting" }
  | { kind: "switching"; display: string; lastError: string | null }
  | { kind: "connected"; route: ViewerRoute | null }
  | { kind: "failed"; message: string };

type Modifier = "ControlLeft" | "AltLeft" | "MetaLeft" | "ShiftLeft";

const COMMAND_KEY_LABEL = {
  darwin: "mobile.server.remoteDesktop.keyCommand",
  win32: "mobile.server.remoteDesktop.keyWindows",
  linux: "mobile.server.remoteDesktop.keySuper",
} as const satisfies Record<RemoteDesktopHost["platform"], MobileTextKey>;

function failureText(error: unknown): string | null {
  return error instanceof Error && error.message ? error.message : null;
}

export function RemoteDesktopScreen() {
  const { t } = useText();
  const insets = useSafeAreaInsets();
  const liquidGlass = useLiquidGlass();
  const reducedMotion = useReducedMotion();
  const [foregroundColor, fieldBackground, accent, accentForeground, background] = useThemeColor([
    "foreground",
    "default",
    "accent",
    "accent-foreground",
    "background",
  ]);
  const iconColor = String(foregroundColor);
  const { theme } = useUniwind();
  const appearance = theme === "dark" ? "dark" : "light";
  const { serverId } = useLocalSearchParams<{ serverId: string }>();
  const { servers, canControlComputer, remoteDesktopConnection } = useMobileWorkspace();
  const server = servers.find((item) => item.id === serverId);
  const appForeground = useAppForeground();
  const [phase, setPhase] = useState<Phase>({ type: "starting" });
  const [viewer, setViewer] = useState<ViewerStatus>({ kind: "connecting" });
  const [covered, setCovered] = useState(AppState.currentState !== "active");
  const [keyboardShown, setKeyboardShown] = useState(false);
  const [modifiers, setModifiers] = useState<ReadonlySet<Modifier>>(new Set());
  const [touchMode, setTouchMode] = useState<ViewerTouchMode>(chosenTouchMode);
  const [notice, setNotice] = useState<string | null>(null);
  // The library gives `WebView` the props `WebViewProps & P` with `P = undefined`, which is `never`.
  const webView = useRef<WebView<object>>(null);
  const keyboardField = useRef<TextInputInstance>(null);
  const typed = useRef("");
  // The open session and proxy, so a later start, a return to the background and the end close them.
  const running = useRef<{ proxy: ViewerProxy | null; sessionId: string | null; generation: number }>({
    proxy: null,
    sessionId: null,
    generation: 0,
  });

  // The unlock prompt shows: on Android 9 and 10 it is an activity of its own, and the app reads as
  // in the background. A session that passes it has unlocked once, so Retry does not ask again.
  const unlocking = useRef(false);
  const unlocked = useRef(false);
  const scriptFor = useCallback(
    (display: RemoteDesktopHost["displays"][number] | undefined) =>
      viewerPageScript(chosenQuality, chosenTouchMode, display, String(background), {
        top: insets.top + (isIOS ? NATIVE_BAR_HEIGHT : CONTROL_OFFSET + CONTROL_SIZE),
        bottom: insets.bottom + CONTROL_OFFSET + CONTROL_SIZE,
      }),
    [background, insets.top, insets.bottom],
  );

  const stop = useCallback(async () => {
    const current = running.current;
    current.generation += 1;
    const { proxy, sessionId } = current;
    current.proxy = null;
    current.sessionId = null;
    await proxy?.stop();
    const connection = remoteDesktopConnection(serverId);
    if (sessionId && connection) await endRemoteDesktopSession(connection, sessionId).catch(() => undefined);
  }, [remoteDesktopConnection, serverId]);

  const start = useCallback(
    async (unlock: boolean) => {
      // The generation is read before the wait: a second start during the wait makes this one old.
      const stopping = stop();
      const generation = running.current.generation;
      await stopping;
      const current = () => running.current.generation === generation;
      setPhase({ type: "starting" });
      setViewer({ kind: "connecting" });
      keyboardField.current?.blur();
      if (!remoteViewerProxyNative)
        return setPhase({ type: "failed", message: t("mobile.server.remoteDesktop.appUpdate") });
      if (!canControlComputer(serverId))
        return setPhase({ type: "failed", message: t("mobile.server.remoteDesktop.unsupported") });
      if (unlock) {
        // The phone's owner, not only a person who holds an unlocked phone, controls the computer.
        unlocking.current = true;
        const result = await checkDeviceUnlock(
          t("mobile.server.remoteDesktop.unlockPrompt"),
          t("common.cancel"),
        ).finally(() => {
          unlocking.current = false;
        });
        if (!current()) return;
        if (result === "cancel" || result === "failed") {
          router.back();
          return;
        }
        unlocked.current = true;
      }
      const connection = remoteDesktopConnection(serverId);
      if (!connection) return setPhase({ type: "failed", message: t("mobile.server.remoteDesktop.offline") });
      try {
        const host = await readRemoteDesktopHost(connection);
        if (!current()) return;
        if (!host.ready) return setPhase({ type: "failed", message: t("mobile.server.remoteDesktop.notReady") });
        const session = await startRemoteDesktopSession(connection);
        if (!current()) {
          await endRemoteDesktopSession(connection, session.id).catch(() => undefined);
          return;
        }
        running.current.sessionId = session.id;
        const proxy = await startViewerProxy(
          connection,
          session.id,
          (report) => {
            if (!current()) return;
            if (report.state === "connected") return setViewer({ kind: "connected", route: report.route });
            if (report.state === "connecting")
              return setViewer((previous) => (previous.kind === "switching" ? previous : { kind: "connecting" }));
            const message = report.message ?? t("mobile.server.remoteDesktop.failed");
            setViewer((previous) =>
              previous.kind === "switching" ? { ...previous, lastError: message } : { kind: "failed", message },
            );
          },
          receiveRemoteDesktopStats,
        );
        if (!current()) {
          await proxy?.stop();
          return;
        }
        if (!proxy) return setPhase({ type: "failed", message: t("mobile.server.remoteDesktop.appUpdate") });
        running.current.proxy = proxy;
        const display = session.displays.find((item) => item.id === session.selectedDisplayId) ?? session.displays[0];
        setPhase({
          type: "viewing",
          url: proxy.viewerUrl(session.viewerGrant),
          script: scriptFor(display),
          host,
          session,
        });
      } catch (error) {
        if (current())
          setPhase({ type: "failed", message: failureText(error) ?? t("mobile.server.remoteDesktop.failed") });
      }
    },
    [stop, canControlComputer, remoteDesktopConnection, serverId, t, scriptFor],
  );

  // Starts once, and ends the session when the screen closes. The workspace gives new functions on
  // its renders, so the effect reads the newest ones and does not run again for them.
  const lifecycle = useRef({ start, stop });
  lifecycle.current = { start, stop };
  useEffect(() => {
    void lifecycle.current.start(true);
    return () => void lifecycle.current.stop();
  }, []);

  // The stream ends when the app leaves the foreground: the phone cannot hold it, and nobody sees it.
  useEffect(() => {
    if (appForeground || unlocking.current || phase.type === "paused" || phase.type === "failed") return;
    void stop();
    setPhase({ type: "paused" });
  }, [appForeground, phase.type, stop]);

  // The app switcher shows a picture of the app. A cover keeps the computer's screen out of it.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => setCovered(state !== "active"));
    return () => subscription.remove();
  }, []);

  // The phone stays on, and on Android no screenshot or screen recording shows the computer.
  useEffect(() => {
    void activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => undefined);
    void remoteViewerProxyNative?.setSecure(true).catch(() => undefined);
    return () => {
      void deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => undefined);
      void remoteViewerProxyNative?.setSecure(false).catch(() => undefined);
    };
  }, []);

  const viewing = phase.type === "viewing" ? phase : null;
  const sessionId = viewing?.session.id ?? null;
  // A stream that shows no picture in time failed: the host says nothing more when its stream never starts.
  useEffect(() => {
    if (!sessionId || (viewer.kind !== "connecting" && viewer.kind !== "switching")) return;
    const switching = viewer.kind === "switching";
    const timer = setTimeout(
      () =>
        setViewer((previous) =>
          previous.kind === "switching"
            ? {
                kind: "failed",
                message:
                  previous.lastError ??
                  t("mobile.server.remoteDesktop.displaySwitchFailed", { name: previous.display }),
              }
            : previous.kind === "connecting"
              ? { kind: "failed", message: t("mobile.server.remoteDesktop.streamNotReady") }
              : previous,
        ),
      switching ? DISPLAY_SWITCH_MS : STREAM_READY_TIMEOUT_MS,
    );
    return () => clearTimeout(timer);
  }, [sessionId, viewer.kind, t]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  const ready = viewing !== null && viewer.kind === "connected";
  const call = (script: string) => webView.current?.injectJavaScript(script);

  // The page sends its stats while the stats sheet is open, and again after it loads again.
  const statsOpen = useRemoteDesktopStatsOpen();
  useEffect(() => {
    if (!statsOpen || !ready) return;
    const page = webView.current;
    page?.injectJavaScript(viewerCall("stats", true));
    return () => page?.injectJavaScript(viewerCall("stats", false));
  }, [statsOpen, ready]);
  const releaseModifiers = () => {
    for (const code of modifiers) call(viewerCall("modifier", code, false));
    if (modifiers.size > 0) setModifiers(new Set());
  };
  const pressKey = (code: string, key: string) => {
    void haptics.selection();
    call(viewerCall("key", code, key));
    releaseModifiers();
  };
  const toggleModifier = (code: Modifier) => {
    void haptics.selection();
    const down = !modifiers.has(code);
    call(viewerCall("modifier", code, down));
    const next = new Set(modifiers);
    if (down) next.add(code);
    else next.delete(code);
    setModifiers(next);
  };
  const type = (before: string, after: string) => {
    const change = typedChange(before, after);
    for (let index = 0; index < change.backspaces; index += 1) call(viewerCall("key", "Backspace", "Backspace"));
    if (change.text) call(viewerCall("type", change.text));
    // A held modifier is for one shortcut, such as Cmd+C.
    if (change.text || change.backspaces > 0) releaseModifiers();
  };
  const toggleKeyboard = () => {
    void haptics.impact("soft");
    if (keyboardShown) keyboardField.current?.blur();
    else keyboardField.current?.focus();
  };
  const paste = async () => {
    let text = "";
    try {
      text = await Clipboard.getStringAsync();
    } catch {
      void haptics.notification("error");
      setNotice(t("mobile.server.remoteDesktop.pasteFailed"));
      return;
    }
    if (!text) {
      setNotice(t("mobile.server.remoteDesktop.clipboardEmpty"));
      return;
    }
    call(viewerCall("type", text.slice(0, PASTE_MAX_LENGTH)));
    void haptics.notification("success");
    setNotice(t("mobile.server.remoteDesktop.pasted"));
  };
  const goBack = () => {
    void haptics.impact("soft");
    router.back();
  };
  const openHelp = () => {
    void haptics.impact("soft");
    keyboardField.current?.blur();
    router.push("/remote-desktop-help");
  };

  const displays = viewing?.session.displays ?? [];
  const options: MenuAction[] = [
    {
      id: "trackpad",
      title: t("mobile.server.remoteDesktop.trackpadMode"),
      image: menuIcon("trackpad", "cursorarrow.motionlines"),
      state: touchMode === "trackpad" ? "on" : "off",
    },
    {
      id: "fit",
      title: t("mobile.server.remoteDesktop.zoomFit"),
      image: menuIcon("fit", "arrow.down.right.and.arrow.up.left"),
    },
    ...(displays.length > 1
      ? [
          {
            id: "display",
            title: t("mobile.server.remoteDesktop.display"),
            image: menuIcon("display", "display.2"),
            subactions: displays.map(
              (display): MenuAction => ({
                id: `display:${display.id}`,
                title: display.label,
                state: display.id === viewing?.session.selectedDisplayId ? "on" : "off",
              }),
            ),
          } satisfies MenuAction,
        ]
      : []),
    {
      id: "quality",
      title: t("mobile.server.remoteDesktop.quality"),
      image: menuIcon("quality", "speedometer"),
      subactions: (
        [
          ["fast", "mobile.server.remoteDesktop.qualityFast"],
          ["smooth", "mobile.server.remoteDesktop.qualitySmooth"],
          ["saver", "mobile.server.remoteDesktop.qualitySaver"],
        ] as const
      ).map(
        ([value, key]): MenuAction => ({
          id: `quality:${value}`,
          title: t(key, { fps: viewerQualityFps(value) }),
          state: chosenQuality === value ? "on" : "off",
        }),
      ),
    },
    { id: "stats", title: t("mobile.server.remoteDesktop.stats"), image: menuIcon("stats", "chart.bar.xaxis") },
  ];
  const runOption = (id: string) => {
    const connection = remoteDesktopConnection(serverId);
    if (id === "trackpad") {
      void haptics.selection();
      const mode = touchMode === "trackpad" ? "direct" : "trackpad";
      chosenTouchMode = mode;
      setTouchMode(mode);
      call(viewerCall("touchMode", viewerTouchModeValue(mode)));
    } else if (id === "stats") {
      void haptics.impact("soft");
      keyboardField.current?.blur();
      setRemoteDesktopStatsOpen(true);
      router.push("/remote-desktop-stats");
    } else if (id === "fit") {
      void haptics.impact("soft");
      call(viewerCall("fit"));
    } else if (id.startsWith("display:") && viewing && connection) {
      const displayId = id.slice("display:".length);
      const display = viewing.session.displays.find((item) => item.id === displayId);
      if (!display || displayId === viewing.session.selectedDisplayId) return;
      void haptics.selection();
      const generation = running.current.generation;
      const previous = viewing.session.selectedDisplayId;
      setViewer({ kind: "switching", display: display.label, lastError: null });
      // The page loads again for the new display, and asks for a stream of that display's size.
      setPhase({
        ...viewing,
        script: scriptFor(display),
        session: { ...viewing.session, selectedDisplayId: displayId },
      });
      void selectRemoteDesktopDisplay(connection, displayId).catch((error: unknown) => {
        if (running.current.generation !== generation) return;
        // The host kept the display it had, so the phone shows that one as chosen again.
        setPhase((current) =>
          current.type === "viewing"
            ? { ...current, session: { ...current.session, selectedDisplayId: previous } }
            : current,
        );
        setViewer({
          kind: "failed",
          message: failureText(error) ?? t("mobile.server.remoteDesktop.displaySwitchFailed", { name: display.label }),
        });
      });
    } else if (id.startsWith("quality:")) {
      const quality = id === "quality:saver" ? "saver" : id === "quality:fast" ? "fast" : "smooth";
      if (quality === chosenQuality) return;
      void haptics.selection();
      chosenQuality = quality;
      // Moonlight reads its stream size and rate only when it starts.
      void start(false);
    }
  };

  const status = (() => {
    if (phase.type === "starting") return { text: t("mobile.server.remoteDesktop.connecting"), action: null };
    if (phase.type === "failed") return { text: phase.message, action: "retry" as const };
    if (phase.type === "paused") return { text: t("mobile.server.remoteDesktop.paused"), action: "reconnect" as const };
    if (viewer.kind === "connecting") return { text: t("mobile.server.remoteDesktop.connecting"), action: null };
    if (viewer.kind === "switching")
      return { text: t("mobile.server.remoteDesktop.switchingDisplay", { name: viewer.display }), action: null };
    if (viewer.kind === "failed") return { text: viewer.message, action: "retry" as const };
    return null;
  })();
  const route = viewer.kind === "connected" ? viewer.route : null;
  const subtitle =
    route === "relay"
      ? t("mobile.server.remoteDesktop.routeRelay")
      : route === "p2p"
        ? t("mobile.server.remoteDesktop.routeDirect")
        : null;
  const controlBottom = keyboardShown ? CONTROL_OFFSET : insets.bottom + CONTROL_OFFSET;
  const platform = viewing?.host.platform ?? "darwin";

  const titleView = (
    <View className="min-w-0 shrink justify-center" accessibilityRole="header" style={{ height: TITLE_HEIGHT }}>
      <Typography.Paragraph className="min-w-0 shrink" weight="semibold" numberOfLines={1}>
        {server?.name ?? t("mobile.server.remoteDesktop.title")}
      </Typography.Paragraph>
      {subtitle ? (
        <Typography.Paragraph type="body-xs" className="text-muted" numberOfLines={1}>
          {subtitle}
        </Typography.Paragraph>
      ) : null}
    </View>
  );

  const keyButton = (label: string, onPress: () => void, options?: { icon?: ReactNode; active?: boolean }) => (
    <ChatGlassButton
      key={label}
      accessibilityLabel={label}
      accessibilityValue={options?.active ? { text: t("mobile.server.remoteDesktop.keyHeld") } : undefined}
      className={`flex-1 flex-row items-center justify-center ${options?.icon ? "" : "px-3.5"}`}
      fallbackBackground={options?.active ? accent : fieldBackground}
      liquidGlassAvailable={liquidGlass && !options?.active}
      height={KEY_HEIGHT}
      width={options?.icon ? ICON_KEY_WIDTH : undefined}
      disabled={!ready}
      onPress={onPress}
    >
      {options?.icon ?? (
        <Typography.Paragraph
          type="body-sm"
          weight="semibold"
          style={options?.active ? { color: String(accentForeground) } : undefined}
        >
          {label}
        </Typography.Paragraph>
      )}
    </ChatGlassButton>
  );
  const arrowIcon = (Icon: typeof ArrowLeft) => <Icon color={iconColor} size={18} strokeWidth={2} />;

  return (
    <View className="flex-1 bg-background">
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <View style={{ flex: 1 }}>
          {viewing ? (
            <WebView
              ref={webView}
              key={viewing.session.id}
              source={{ uri: viewing.url }}
              injectedJavaScriptBeforeContentLoaded={viewing.script}
              // Only the viewer's own loopback address loads. The page has no `onMessage`, so it cannot call the app.
              // Every origin passes the list, so the handler below decides each load: the library opens a
              // URL that fails the list in another app, and the host's page must not open links or apps.
              originWhitelist={["*"]}
              onShouldStartLoadWithRequest={(request) => request.url.startsWith(viewing.url.split("/v1/")[0] ?? "")}
              onOpenWindow={() => undefined}
              setSupportMultipleWindows={false}
              javaScriptCanOpenWindowsAutomatically={false}
              incognito={isIOS}
              cacheEnabled={false}
              domStorageEnabled
              allowsInlineMediaPlayback
              mediaPlaybackRequiresUserAction={false}
              allowsLinkPreview={false}
              allowFileAccess={false}
              bounces={false}
              scrollEnabled={false}
              contentInsetAdjustmentBehavior="never"
              accessibilityLabel={t("mobile.server.remoteDesktop.screen", { name: server?.name ?? "" })}
              style={{ flex: 1, backgroundColor: String(background) }}
            />
          ) : null}
          {status ? (
            <View
              pointerEvents="box-none"
              className={`absolute inset-0 items-center justify-center gap-4 ${viewing ? "bg-background/60" : ""}`}
              style={{ paddingLeft: insets.left + 32, paddingRight: insets.right + 32 }}
            >
              <Typography.Paragraph align="center" className="text-muted">
                {status.text}
              </Typography.Paragraph>
              {status.action ? (
                <Button
                  variant="secondary"
                  onPress={() => {
                    void haptics.impact("soft");
                    // After the app was in the background the phone asks again; a retry does not.
                    void start(status.action === "reconnect" || !unlocked.current);
                  }}
                >
                  <Button.Label>
                    {status.action === "reconnect" ? t("mobile.server.remoteDesktop.reconnect") : t("common.retry")}
                  </Button.Label>
                </Button>
              ) : null}
            </View>
          ) : null}
          {notice ? (
            <Animated.View
              key={notice}
              entering={reducedMotion ? undefined : FadeIn.duration(160)}
              exiting={reducedMotion ? undefined : FadeOut.duration(160)}
              pointerEvents="none"
              accessibilityLiveRegion="polite"
              className="absolute self-center rounded-full bg-control px-4 py-2"
              style={{ bottom: controlBottom + CONTROL_SIZE + 12 }}
            >
              <Typography.Paragraph type="body-sm">{notice}</Typography.Paragraph>
            </Animated.View>
          ) : null}
          {viewing ? (
            <View
              pointerEvents="box-none"
              className="absolute inset-x-0"
              style={{ bottom: controlBottom, height: keyboardShown ? KEY_HEIGHT : CONTROL_SIZE }}
            >
              {keyboardShown ? (
                // The keys that a phone keyboard does not have, above the keyboard.
                <ScrollView
                  horizontal
                  keyboardShouldPersistTaps="always"
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: 8, paddingLeft: insets.left + 12, paddingRight: insets.right + 12 }}
                >
                  {keyButton(t("mobile.server.remoteDesktop.keyboardHide"), toggleKeyboard, {
                    icon: <KeyboardOff color={iconColor} size={18} strokeWidth={2} />,
                  })}
                  {keyButton(t("mobile.server.remoteDesktop.keyEscape"), () => pressKey("Escape", "Escape"))}
                  {keyButton(t("mobile.server.remoteDesktop.keyTab"), () => pressKey("Tab", "Tab"))}
                  {keyButton(t("mobile.server.remoteDesktop.keyControl"), () => toggleModifier("ControlLeft"), {
                    active: modifiers.has("ControlLeft"),
                  })}
                  {keyButton(
                    t(
                      platform === "darwin"
                        ? "mobile.server.remoteDesktop.keyOption"
                        : "mobile.server.remoteDesktop.keyAlt",
                    ),
                    () => toggleModifier("AltLeft"),
                    { active: modifiers.has("AltLeft") },
                  )}
                  {keyButton(t(COMMAND_KEY_LABEL[platform]), () => toggleModifier("MetaLeft"), {
                    active: modifiers.has("MetaLeft"),
                  })}
                  {keyButton(t("mobile.server.remoteDesktop.keyShift"), () => toggleModifier("ShiftLeft"), {
                    active: modifiers.has("ShiftLeft"),
                  })}
                  {keyButton(t("mobile.server.remoteDesktop.keyLeft"), () => pressKey("ArrowLeft", "ArrowLeft"), {
                    icon: arrowIcon(ArrowLeft),
                  })}
                  {keyButton(t("mobile.server.remoteDesktop.keyUp"), () => pressKey("ArrowUp", "ArrowUp"), {
                    icon: arrowIcon(ArrowUp),
                  })}
                  {keyButton(t("mobile.server.remoteDesktop.keyDown"), () => pressKey("ArrowDown", "ArrowDown"), {
                    icon: arrowIcon(ArrowDown),
                  })}
                  {keyButton(t("mobile.server.remoteDesktop.keyRight"), () => pressKey("ArrowRight", "ArrowRight"), {
                    icon: arrowIcon(ArrowRight),
                  })}
                </ScrollView>
              ) : (
                <View
                  pointerEvents="box-none"
                  className="absolute inset-0 flex-row items-center justify-center gap-4"
                  style={{ paddingLeft: insets.left + 16, paddingRight: insets.right + 16 }}
                >
                  <MenuView
                    actions={[
                      {
                        id: "paste",
                        title: t("mobile.server.remoteDesktop.pasteFromPhone"),
                        image: "doc.on.clipboard",
                      },
                    ]}
                    onPressAction={({ nativeEvent }) => {
                      if (ready && nativeEvent.event === "paste") void paste();
                    }}
                    style={{ height: CONTROL_SIZE, width: CONTROL_SIZE }}
                  >
                    <GlassCircle liquidGlass={liquidGlass} fallbackBackground={fieldBackground}>
                      <View
                        accessible
                        accessibilityRole="button"
                        accessibilityLabel={t("mobile.server.remoteDesktop.clipboard")}
                        className="flex-1 items-center justify-center"
                      >
                        <ClipboardList color={iconColor} size={22} strokeWidth={2} />
                      </View>
                    </GlassCircle>
                  </MenuView>
                  <ChatGlassIconButton
                    accessibilityLabel={t("mobile.server.remoteDesktop.keyboard")}
                    fallbackBackground={fieldBackground}
                    liquidGlassAvailable={liquidGlass}
                    disabled={!ready}
                    onPress={toggleKeyboard}
                  >
                    <Keyboard color={iconColor} size={22} strokeWidth={2} />
                  </ChatGlassIconButton>
                </View>
              )}
            </View>
          ) : null}
        </View>
      </KeyboardAvoidingView>

      {isIOS ? (
        // The native bar, as on the browser screen.
        <>
          <Stack.Toolbar placement="left">
            <Stack.Toolbar.Button icon="chevron.backward" accessibilityLabel={t("common.back")} onPress={goBack} />
            <Stack.Toolbar.View hidesSharedBackground>
              <View className="flex-row items-center" style={{ height: NATIVE_BAR_HEIGHT, maxWidth: TITLE_MAX_WIDTH }}>
                {titleView}
              </View>
            </Stack.Toolbar.View>
          </Stack.Toolbar>
          <Stack.Toolbar placement="right">
            <Stack.Toolbar.Button
              icon="questionmark.circle"
              accessibilityLabel={t("mobile.server.remoteDesktop.help")}
              onPress={openHelp}
            />
            <Stack.Toolbar.Menu icon="ellipsis" accessibilityLabel={t("mobile.server.remoteDesktop.options")}>
              {toolbarMenuItems(options, runOption)}
            </Stack.Toolbar.Menu>
          </Stack.Toolbar>
        </>
      ) : (
        <View
          className="absolute inset-x-0 z-20 flex-row items-center gap-3"
          pointerEvents="box-none"
          style={{ top: insets.top + CONTROL_OFFSET, paddingLeft: insets.left + 16, paddingRight: insets.right + 16 }}
        >
          <ChatGlassIconButton
            accessibilityLabel={t("common.back")}
            fallbackBackground={fieldBackground}
            liquidGlassAvailable={liquidGlass}
            onPress={goBack}
          >
            <ArrowLeft color={iconColor} size={24} strokeWidth={2} style={MIRROR_IN_RTL} />
          </ChatGlassIconButton>
          {titleView}
          <View className="flex-1" />
          <ChatGlassIconButton
            accessibilityLabel={t("mobile.server.remoteDesktop.help")}
            fallbackBackground={fieldBackground}
            liquidGlassAvailable={liquidGlass}
            onPress={openHelp}
          >
            <CircleQuestionMark color={iconColor} size={24} strokeWidth={2} />
          </ChatGlassIconButton>
          <MenuView
            actions={options}
            onPressAction={({ nativeEvent }) => runOption(nativeEvent.event)}
            style={{ height: CONTROL_SIZE, width: CONTROL_SIZE }}
          >
            <GlassCircle liquidGlass={liquidGlass} fallbackBackground={fieldBackground}>
              <View
                accessible
                accessibilityRole="button"
                accessibilityLabel={t("mobile.server.remoteDesktop.options")}
                className="flex-1 items-center justify-center"
              >
                <Ellipsis color={iconColor} size={24} strokeWidth={2} />
              </View>
            </GlassCircle>
          </MenuView>
        </View>
      )}

      {/* The app switcher takes its picture of the app under this cover. */}
      {covered ? <View pointerEvents="none" className="absolute inset-0 z-30 bg-background" /> : null}

      {/* The phone keyboard types into this field. What changes in it goes to the computer. */}
      <TextInput
        ref={keyboardField}
        accessibilityLabel={t("mobile.server.remoteDesktop.keyboardField")}
        autoCapitalize="none"
        autoComplete="off"
        autoCorrect={false}
        caretHidden
        contextMenuHidden
        importantForAutofill="no"
        keyboardAppearance={appearance}
        multiline
        smartInsertDelete={false}
        spellCheck={false}
        textContentType="none"
        style={{ position: "absolute", left: -100, top: 0, width: 1, height: 1, opacity: 0 }}
        onFocus={() => setKeyboardShown(true)}
        onBlur={() => setKeyboardShown(false)}
        onChangeText={(text) => {
          type(typed.current, text);
          typed.current = text;
          if (text.length > KEYBOARD_FIELD_MAX_LENGTH) {
            keyboardField.current?.clear();
            typed.current = "";
          }
        }}
        onKeyPress={(event: TextInputKeyPressEvent) => {
          // Backspace in an empty field changes no text, so the change handler never hears it.
          if (event.nativeEvent.key === "Backspace" && typed.current === "") pressKey("Backspace", "Backspace");
        }}
      />
    </View>
  );
}

/** A glass circle of the control size, as the browser draws one. The menu owns the touch. */
function GlassCircle({
  liquidGlass,
  fallbackBackground,
  children,
}: {
  liquidGlass: boolean;
  fallbackBackground: ViewStyle["backgroundColor"];
  children: ReactNode;
}) {
  return (
    <GlassView
      glassEffectStyle={liquidGlass ? "regular" : "none"}
      style={{
        width: CONTROL_SIZE,
        height: CONTROL_SIZE,
        borderRadius: CONTROL_SIZE / 2,
        borderCurve: "continuous",
        overflow: "hidden",
        backgroundColor: liquidGlass ? "transparent" : fallbackBackground,
      }}
    >
      {children}
    </GlassView>
  );
}
