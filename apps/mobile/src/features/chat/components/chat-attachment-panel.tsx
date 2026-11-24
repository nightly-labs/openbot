import { GlassView } from "expo-glass-effect";
import { Typography } from "heroui-native";
import type { LucideIcon } from "lucide-react-native";
import Camera from "lucide-react-native/icons/camera";
import Images from "lucide-react-native/icons/images";
import Paperclip from "lucide-react-native/icons/paperclip";
import Sparkles from "lucide-react-native/icons/sparkles";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { BackHandler, Keyboard, Pressable, StyleSheet, useWindowDimensions, View, type ViewStyle } from "react-native";
import { Pressable as GesturePressable } from "react-native-gesture-handler";
import Animated, {
  cubicBezier,
  Extrapolation,
  interpolate,
  ReduceMotion,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";
import { useFullScreenCameraPreference } from "@/features/settings/model/camera-mode";
import { useColumnWidth } from "@/shared/components/adaptive-split";
import { haptics } from "@/shared/lib/haptics";
import { useReducedMotion } from "@/shared/lib/motion";
import { isAndroid } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";
import { END_X } from "@/shared/lib/text-direction";
import { ChatCameraContent } from "./chat-camera-panel";
import { type ComposerContextMeter, ComposerContextRing } from "./composer-context-ring";
import { FullScreenCameraTip } from "./full-screen-camera-tip";
import type { ChatAttachmentAnchor, ChatAttachments } from "./use-chat-attachments";

const OPTION_ROW = 48;
const OPTIONS_MIN_WIDTH = 236;
const OPTIONS_PADDING = 8;
const OPTIONS_EDGE_GAP = 12;
const ROW_PADDING = 16;
const ROW_ICON = 21;
const ROW_GAP = 14;
const ROW_CHROME = ROW_PADDING * 2 + ROW_ICON + ROW_GAP;
const DIVIDER_SPACE = 9;
const optionsHeight = (rows: number, divided: boolean) =>
  OPTION_ROW * rows + OPTIONS_PADDING * 2 + (divided ? DIVIDER_SPACE : 0);
const BAR_INSET = 16;
const MENU_GAP = 8;
const SURFACE_RADIUS = 28;
const MORPH = { duration: 320, dampingRatio: 1, reduceMotion: ReduceMotion.System };
const CAMERA_TOP_GAP = 12;
const MIN_CAMERA_HEIGHT = 240;
const GLASS_FADE = 0.22;
const PRESS_FADE = 120;
const PRESS_EASING = cubicBezier(0.23, 1, 0.32, 1);
const ROW_STAGGER = 0.1;

const RowPressable = isAndroid ? GesturePressable : Pressable;

function AttachmentOption({
  accessibilityLabel,
  busy,
  disabled,
  foreground,
  glyph,
  icon: Icon,
  index,
  label,
  onPress,
  progress,
  value,
}: {
  accessibilityLabel?: string;
  busy?: boolean;
  disabled: boolean;
  foreground: ViewStyle["backgroundColor"];
  glyph?: ReactNode;
  icon?: LucideIcon;
  index: number;
  label: string;
  onPress: () => void;
  progress: SharedValue<number>;
  value?: string;
}) {
  const [pressed, setPressed] = useState(false);
  const reduceMotion = useReducedMotion();
  const entryStyle = useAnimatedStyle(() => {
    const start = 0.15 + index * ROW_STAGGER;
    const arrived = interpolate(progress.get(), [start, start + 0.5], [0, 1], Extrapolation.CLAMP);
    return { opacity: arrived, transform: [{ translateY: interpolate(arrived, [0, 1], [8, 0]) }] };
  });
  return (
    <Animated.View style={entryStyle}>
      <Animated.View
        style={{
          transform: [{ scale: pressed ? 0.97 : 1 }],
          transitionProperty: "transform",
          transitionDuration: reduceMotion ? 0 : PRESS_FADE,
          transitionTimingFunction: PRESS_EASING,
        }}
      >
        <RowPressable
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel ?? label}
          accessibilityState={{ disabled, busy }}
          disabled={disabled}
          pressRetentionOffset={12}
          style={{
            minHeight: OPTION_ROW,
            flexDirection: "row",
            alignItems: "center",
            gap: ROW_GAP,
            paddingHorizontal: ROW_PADDING,
            paddingVertical: 10,
          }}
          onPressIn={() => {
            setPressed(true);
            void haptics.selection();
          }}
          onPressOut={() => setPressed(false)}
          onPress={onPress}
        >
          {glyph ?? (Icon ? <Icon color={String(foreground)} size={ROW_ICON} strokeWidth={1.9} /> : null)}
          <Typography.Paragraph className="min-w-0 shrink">{label}</Typography.Paragraph>
          {value ? (
            <Typography.Paragraph className="ms-auto text-muted" style={{ fontVariant: ["tabular-nums"] }}>
              {value}
            </Typography.Paragraph>
          ) : null}
        </RowPressable>
      </Animated.View>
    </Animated.View>
  );
}

export function ChatAttachmentPanel({
  anchor,
  appActive,
  attachments,
  context,
  fallbackBackground,
  foreground,
  keyboardHeight,
  keyboardOffset,
  liquidGlassAvailable,
  onClose,
  onUseSkill,
  progress,
}: {
  anchor: ChatAttachmentAnchor;
  appActive: boolean;
  attachments: ChatAttachments;
  context?: ComposerContextMeter;
  fallbackBackground: ViewStyle["backgroundColor"];
  foreground: ViewStyle["backgroundColor"];
  keyboardHeight: SharedValue<number>;
  keyboardOffset: number;
  liquidGlassAvailable: boolean;
  onClose: () => void;
  onUseSkill?: () => void;
  progress: SharedValue<number>;
}) {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const safeWidth = useColumnWidth() - insets.left - insets.right;
  const startInset = END_X === 1 ? insets.left : insets.right;
  const { t, format } = useText();
  const [mode, setMode] = useState<"options" | "camera">("options");
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const busyRef = useRef(false);
  const reduceMotion = useReducedMotion();
  const [glassLit, setGlassLit] = useState(true);
  const captured = useRef<string | null>(null);
  const morph = useSharedValue(0);
  const cameraWidth = Math.min(440, safeWidth - BAR_INSET * 2);
  const [keyboardInset] = useState(() => Math.max(0, (Keyboard.metrics()?.height ?? 0) - keyboardOffset));
  const rowCount = 3 + (onUseSkill ? 1 : 0) + (context ? 1 : 0);
  const roomTop = height - insets.top - keyboardInset - CAMERA_TOP_GAP;
  const openBottom = Math.max(
    anchor.bottom,
    Math.min(
      anchor.barTop + MENU_GAP,
      roomTop - Math.max(MIN_CAMERA_HEIGHT, optionsHeight(rowCount, Boolean(context))),
    ),
  );
  const rise = openBottom - anchor.bottom;
  const cameraHeight = Math.min(height * 0.58, roomTop - openBottom);
  const optionsShift = anchor.barStart - anchor.left;
  const cameraShift = startInset + (safeWidth - cameraWidth) / 2 - anchor.left;
  const maxListWidth = Math.max(
    OPTIONS_MIN_WIDTH,
    Math.min(cameraWidth, startInset + safeWidth - anchor.barStart - OPTIONS_EDGE_GAP),
  );
  const contextValue =
    context && !context.compacting ? format.percent(context.share, { maximumFractionDigits: 0 }) : undefined;
  const labels = {
    useSkill: t("mobile.chat.attachment.useSkill"),
    files: t("mobile.chat.attachment.files"),
    photos: t("mobile.chat.attachment.photos"),
    camera: t("mobile.chat.attachment.camera"),
    context: t("mobile.chat.context.title"),
  };
  const [listWidth, setListWidth] = useState<number | null>(null);
  const listHeight = useSharedValue(optionsHeight(rowCount, Boolean(context)));
  const openedRef = useRef(false);

  const finish = useCallback(() => {
    const uri = captured.current;
    captured.current = null;
    onClose();
    if (uri) void attachments.addPhoto(uri);
  }, [attachments, onClose]);

  const dismiss = useCallback(() => {
    if (closingRef.current || busyRef.current) return;
    closingRef.current = true;
    setClosing(true);
    setGlassLit(false);
    progress.set(
      withSpring(0, MORPH, (finished) => {
        if (finished) scheduleOnRN(finish);
      }),
    );
  }, [finish, progress]);

  const showOptions = useCallback(() => {
    if (busyRef.current) return;
    setMode("options");
    morph.set(withSpring(0, MORPH));
  }, [morph]);

  useEffect(() => {
    const back = BackHandler.addEventListener("hardwareBackPress", () => {
      if (mode === "camera") showOptions();
      else dismiss();
      return true;
    });
    return () => back.remove();
  }, [dismiss, mode, showOptions]);

  const surfaceStyle = useAnimatedStyle(() => {
    const presented = progress.get();
    const shape = morph.get();
    const openWidth = interpolate(shape, [0, 1], [listWidth ?? OPTIONS_MIN_WIDTH, cameraWidth]);
    const openHeight = interpolate(shape, [0, 1], [listHeight.get(), cameraHeight]);
    return {
      width: interpolate(presented, [0, 1], [anchor.size, openWidth]),
      height: interpolate(presented, [0, 1], [anchor.size, openHeight]),
      opacity: liquidGlassAvailable ? 1 : interpolate(presented, [0, 0.35], [0, 1], Extrapolation.CLAMP),
      transform: [
        { translateX: END_X * presented * (optionsShift + (cameraShift - optionsShift) * shape) },
        { translateY: -rise },
      ],
    };
  });
  const liftStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -Math.max(0, keyboardHeight.get() - keyboardOffset) }],
  }));
  const optionsStyle = useAnimatedStyle(() => ({
    opacity: 1 - morph.get(),
    transform: [{ scale: interpolate(progress.get(), [0, 1], [anchor.size / (listWidth ?? OPTIONS_MIN_WIDTH), 1]) }],
  }));
  const cameraStyle = useAnimatedStyle(() => ({ opacity: morph.get() }));

  function choose(run: () => unknown) {
    dismiss();
    void run();
  }

  async function chooseCamera() {
    if (useFullScreenCameraPreference.getState().fullScreen) {
      choose(attachments.takePhoto);
      return;
    }
    if (!(await attachments.requestCamera())) {
      dismiss();
      return;
    }
    setMode("camera");
    morph.set(withSpring(1, MORPH));
  }

  return (
    <View style={StyleSheet.absoluteFill} accessibilityViewIsModal onAccessibilityEscape={dismiss}>
      <Pressable style={StyleSheet.absoluteFill} accessible={false} onPress={dismiss} />
      {listWidth === null ? (
        <View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{ position: "absolute", left: 0, top: 0, width: maxListWidth - ROW_CHROME, opacity: 0 }}
        >
          <View
            style={{ alignSelf: "flex-start" }}
            onLayout={({ nativeEvent }) => {
              const width = Math.ceil(nativeEvent.layout.width) + ROW_CHROME;
              setListWidth(Math.min(maxListWidth, Math.max(OPTIONS_MIN_WIDTH, width)));
            }}
          >
            {(onUseSkill ? [labels.useSkill] : []).concat(labels.files, labels.photos, labels.camera).map((label) => (
              <Typography.Paragraph key={label}>{label}</Typography.Paragraph>
            ))}
            {context ? (
              <View style={{ flexDirection: "row", gap: ROW_GAP }}>
                <Typography.Paragraph>{labels.context}</Typography.Paragraph>
                <Typography.Paragraph>{format.percent(1, { maximumFractionDigits: 0 })}</Typography.Paragraph>
              </View>
            ) : null}
          </View>
        </View>
      ) : null}
      <Animated.View
        pointerEvents={closing ? "none" : "box-none"}
        accessibilityElementsHidden={closing}
        importantForAccessibility={closing ? "no-hide-descendants" : "auto"}
        style={[{ position: "absolute", left: anchor.left, bottom: anchor.bottom }, liftStyle]}
      >
        <Animated.View
          style={[{ borderRadius: SURFACE_RADIUS, borderCurve: "continuous", overflow: "hidden" }, surfaceStyle]}
        >
          <GlassView
            glassEffectStyle={{
              style: liquidGlassAvailable && glassLit ? "regular" : "none",
              animate: true,
              animationDuration: reduceMotion ? 0 : GLASS_FADE,
            }}
            style={{
              position: "absolute",
              left: 0,
              bottom: 0,
              width: cameraWidth,
              height: cameraHeight,
              backgroundColor: liquidGlassAvailable ? "transparent" : fallbackBackground,
            }}
          />
          <Animated.View
            pointerEvents={mode === "options" ? "auto" : "none"}
            onLayout={({ nativeEvent }) => {
              listHeight.set(nativeEvent.layout.height);
              if (openedRef.current || closingRef.current) return;
              openedRef.current = true;
              progress.set(withSpring(1, MORPH));
            }}
            style={[
              {
                position: "absolute",
                left: 0,
                bottom: 0,
                width: listWidth ?? OPTIONS_MIN_WIDTH,
                display: listWidth === null ? "none" : "flex",
                paddingVertical: OPTIONS_PADDING,
                transformOrigin: END_X === 1 ? "0% 100%" : "100% 100%",
              },
              optionsStyle,
            ]}
          >
            {onUseSkill ? (
              <AttachmentOption
                index={context ? 4 : 3}
                icon={Sparkles}
                label={labels.useSkill}
                foreground={foreground}
                progress={progress}
                disabled={false}
                onPress={() => choose(onUseSkill)}
              />
            ) : null}
            <AttachmentOption
              index={context ? 3 : 2}
              icon={Paperclip}
              label={labels.files}
              foreground={foreground}
              progress={progress}
              disabled={attachments.preparing}
              onPress={() => choose(attachments.chooseFiles)}
            />
            <AttachmentOption
              index={context ? 2 : 1}
              icon={Images}
              label={labels.photos}
              foreground={foreground}
              progress={progress}
              disabled={attachments.preparing}
              onPress={() => choose(attachments.choosePhotos)}
            />
            <AttachmentOption
              index={context ? 1 : 0}
              icon={Camera}
              label={labels.camera}
              foreground={foreground}
              progress={progress}
              disabled={attachments.preparing}
              onPress={() => void chooseCamera()}
            />
            {context ? (
              <>
                <View
                  className="bg-separator"
                  style={{
                    height: StyleSheet.hairlineWidth,
                    marginVertical: (DIVIDER_SPACE - StyleSheet.hairlineWidth) / 2,
                    marginHorizontal: ROW_PADDING,
                  }}
                />
                <AttachmentOption
                  index={0}
                  glyph={<ComposerContextRing meter={context} />}
                  label={labels.context}
                  accessibilityLabel={context.label}
                  busy={context.compacting}
                  value={contextValue}
                  foreground={foreground}
                  progress={progress}
                  disabled={false}
                  onPress={() => choose(context.onPress)}
                />
              </>
            ) : null}
          </Animated.View>
          <Animated.View
            pointerEvents={mode === "camera" && !closing && appActive ? "auto" : "none"}
            style={[
              { position: "absolute", left: 0, bottom: 0, width: cameraWidth, height: cameraHeight },
              cameraStyle,
            ]}
          >
            {mode === "camera" && !closing && appActive ? (
              <ChatCameraContent
                onBusyChange={(busy) => {
                  busyRef.current = busy;
                }}
                onCancel={showOptions}
                onCaptured={(uri) => {
                  captured.current = uri;
                  dismiss();
                }}
              />
            ) : null}
            {mode === "camera" && !closing && appActive ? (
              <FullScreenCameraTip outerRadius={SURFACE_RADIUS} onUseFullScreen={() => choose(attachments.takePhoto)} />
            ) : null}
          </Animated.View>
        </Animated.View>
      </Animated.View>
    </View>
  );
}
