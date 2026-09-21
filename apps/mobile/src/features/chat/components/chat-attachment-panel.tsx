import { GlassView } from "expo-glass-effect";
import { Typography } from "heroui-native";
import { Camera, Images, type LucideIcon, Paperclip } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { BackHandler, Keyboard, Pressable, StyleSheet, useWindowDimensions, View, type ViewStyle } from "react-native";
import Animated, {
  cubicBezier,
  Extrapolation,
  interpolate,
  ReduceMotion,
  type SharedValue,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";
import { haptics } from "@/shared/lib/haptics";
import { ChatCameraContent } from "./chat-camera-panel";
import type { ChatAttachmentAnchor, ChatAttachments } from "./use-chat-attachments";

// iOS presents a SwiftUI `Menu` in a window of its own: it cannot be measured,
// transformed, or reopened, and with the keyboard up it refuses to sit on the
// control it belongs to. The attachment menu has to become the camera and come
// back, so it is ours. This is the documented exception to the native
// system-chrome rule in apps/mobile/AGENTS.md, taken as a product decision.
const OPTION_ROW = 48;
const OPTIONS_WIDTH = 236;
const OPTIONS_PADDING = 8;
const OPTIONS_HEIGHT = OPTION_ROW * 3 + OPTIONS_PADDING * 2;
const SURFACE_RADIUS = 28;
// One shape change, no overshoot: there is no finger on the card, and a card
// that springs past its own size reads as a toy. `ReduceMotion.System` lets
// Reanimated land every one of these on the spot when the setting is on.
const MORPH = { duration: 320, dampingRatio: 1, reduceMotion: ReduceMotion.System };
// Room the camera leaves below the top safe area.
const CAMERA_TOP_GAP = 12;
// The material's own fade. An opacity on the card is what broke the glass, so
// the card leaves by dissolving its material instead, through the animated
// style the library itself exposes.
const GLASS_FADE = 0.22;
const PRESS_FADE = 120;
const PRESS_EASING = cubicBezier(0.23, 1, 0.32, 1);
// Each row starts this much later than the one below it. Only opacity and a
// short rise, so a row is pressable from the first frame it is drawn.
const ROW_STAGGER = 0.1;

function AttachmentOption({
  disabled,
  foreground,
  icon: Icon,
  index,
  label,
  onPress,
  progress,
}: {
  disabled: boolean;
  foreground: ViewStyle["backgroundColor"];
  icon: LucideIcon;
  index: number;
  label: string;
  onPress: () => void;
  progress: SharedValue<number>;
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
      {/* The press scale lives on its own node: a CSS transition and an
          animated style must not share one. */}
      <Animated.View
        style={{
          transform: [{ scale: pressed ? 0.97 : 1 }],
          transitionProperty: "transform",
          transitionDuration: reduceMotion ? 0 : PRESS_FADE,
          transitionTimingFunction: PRESS_EASING,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityState={{ disabled }}
          disabled={disabled}
          pressRetentionOffset={12}
          style={{ height: OPTION_ROW, flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 16 }}
          onPressIn={() => {
            setPressed(true);
            void haptics.selection();
          }}
          onPressOut={() => setPressed(false)}
          onPress={onPress}
        >
          <Icon color={String(foreground)} size={21} strokeWidth={1.9} />
          <Typography.Paragraph className="flex-1">{label}</Typography.Paragraph>
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}

/**
 * The attachment card. It grows out of the plus, holds the options, morphs into
 * the camera and back, and collapses into the plus again.
 */
export function ChatAttachmentPanel({
  anchor,
  attachments,
  fallbackBackground,
  foreground,
  keyboardHeight,
  keyboardOffset,
  liquidGlassAvailable,
  onClose,
  progress,
}: {
  /**
   * The plus the card grows out of, from the screen's left and bottom edges,
   * before the keyboard lifts the composer.
   */
  anchor: ChatAttachmentAnchor;
  attachments: ChatAttachments;
  fallbackBackground: ViewStyle["backgroundColor"];
  foreground: ViewStyle["backgroundColor"];
  /** The composer's own lift. The card rides it, so it stays on the plus. */
  keyboardHeight: SharedValue<number>;
  keyboardOffset: number;
  liquidGlassAvailable: boolean;
  onClose: () => void;
  /**
   * 0 with the card gone, 1 with it open. Shared with the composer, so the
   * plus comes back on the same frame the card stops covering it.
   */
  progress: SharedValue<number>;
}) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<"options" | "camera">("options");
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const busyRef = useRef(false);
  const reduceMotion = useReducedMotion();
  // The material is lit for as long as the card is staying. It dissolves the
  // moment the card is told to leave, so the rows, the material and the size
  // all finish together and nothing is left sitting on the plus.
  const [glassLit, setGlassLit] = useState(true);
  // A photo taken but not yet held. It waits for the card to be gone.
  const captured = useRef<string | null>(null);
  const morph = useSharedValue(0);
  const cameraWidth = Math.min(440, width - 24);
  // Read once, for this card's whole life: the keyboard is not dismissed for
  // the camera any more, and the glass behind the card must never be resized.
  // The card already rides the keyboard's lift, so the camera takes the room
  // that is left above it.
  const [keyboardInset] = useState(() => Math.max(0, (Keyboard.metrics()?.height ?? 0) - keyboardOffset));
  const cameraHeight = Math.min(height * 0.58, height - insets.top - anchor.bottom - keyboardInset - CAMERA_TOP_GAP);
  // The card keeps the plus's left edge while it is the options list, and
  // centres itself once it is the camera.
  const cameraShift = (width - cameraWidth) / 2 - anchor.left;

  useEffect(() => {
    progress.set(withSpring(1, MORPH));
  }, [progress]);

  // Runs once the card has finished leaving, so the heavy part of holding a
  // photo has the thread to itself.
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

  // No opacity here, and none on anything above the glass. An animated
  // opacity on a GlassView's ancestor makes iOS composite that subtree
  // offscreen, and UIVisualEffectView cannot sample a backdrop through it: the
  // card then draws as a plain view with no material at all.
  // https://github.com/expo/expo/issues/41024
  // The card grows out of the plus, so it needs no fade of its own; what has
  // to cross-fade is the content, which sits beside the glass, not above it.
  const surfaceStyle = useAnimatedStyle(() => {
    const presented = progress.get();
    const shape = morph.get();
    const openWidth = interpolate(shape, [0, 1], [OPTIONS_WIDTH, cameraWidth]);
    const openHeight = interpolate(shape, [0, 1], [OPTIONS_HEIGHT, cameraHeight]);
    return {
      // The card is the plus until it is anything else, so it never appears
      // from nothing and never has to travel to reach its own corner.
      width: interpolate(presented, [0, 1], [anchor.size, openWidth]),
      height: interpolate(presented, [0, 1], [anchor.size, openHeight]),
      transform: [{ translateX: interpolate(presented, [0, 1], [0, cameraShift * shape]) }],
    };
  });
  // The composer is lifted by the keyboard and this overlay is not, so the
  // card takes the same lift. Reading the height rather than a copy keeps the
  // two together through an interactive dismissal, frame by frame.
  const liftStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -Math.max(0, keyboardHeight.get() - keyboardOffset) }],
  }));
  // The options scale with the card from the same corner. Revealing them
  // through the growing clip alone read as the list unrolling to the right,
  // because the card widens from the plus while the rows kept their full size.
  const optionsStyle = useAnimatedStyle(() => ({
    opacity: 1 - morph.get(),
    transform: [{ scale: interpolate(progress.get(), [0, 1], [anchor.size / OPTIONS_WIDTH, 1]) }],
  }));
  const cameraStyle = useAnimatedStyle(() => ({ opacity: morph.get() }));

  function choose(run: () => unknown) {
    // The picker presents itself over the card, so the card leaves at the same
    // time instead of holding the user for the length of its own exit.
    dismiss();
    void run();
  }

  async function chooseCamera() {
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
      <Animated.View
        pointerEvents={closing ? "none" : "box-none"}
        accessibilityElementsHidden={closing}
        importantForAccessibility={closing ? "no-hide-descendants" : "auto"}
        style={[{ position: "absolute", left: anchor.left, bottom: anchor.bottom }, liftStyle]}
      >
        <Animated.View
          style={[{ borderRadius: SURFACE_RADIUS, borderCurve: "continuous", overflow: "hidden" }, surfaceStyle]}
        >
          {/* The glass keeps one size for its whole life. It is the only glass
              surface in the app that was resized, and resizing it every frame
              down to the plus's own 32 pt left it with no material at all.
              The window above carries the morph instead, and reveals more of
              the same material as it opens. */}
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
          {/* The card's own width and height carry the morph: a scale would
              smear its corner radius and its text. Both contents keep their
              own size while it resizes around them, so nothing inside the card
              re-lays-out on a frame, and the card is out of flow, so nothing
              outside it does either. */}
          <Animated.View
            pointerEvents={mode === "options" ? "auto" : "none"}
            style={[
              {
                position: "absolute",
                left: 0,
                bottom: 0,
                width: OPTIONS_WIDTH,
                paddingVertical: OPTIONS_PADDING,
                // The card grows from its own bottom-left, so the rows do too.
                transformOrigin: "0% 100%",
              },
              optionsStyle,
            ]}
          >
            <AttachmentOption
              index={2}
              icon={Paperclip}
              label="Files"
              foreground={foreground}
              progress={progress}
              disabled={attachments.preparing}
              onPress={() => choose(attachments.chooseFiles)}
            />
            <AttachmentOption
              index={1}
              icon={Images}
              label="Photos"
              foreground={foreground}
              progress={progress}
              disabled={attachments.preparing}
              onPress={() => choose(attachments.choosePhotos)}
            />
            <AttachmentOption
              index={0}
              icon={Camera}
              label="Camera"
              foreground={foreground}
              progress={progress}
              disabled={attachments.preparing}
              onPress={() => void chooseCamera()}
            />
          </Animated.View>
          <Animated.View
            pointerEvents={mode === "camera" && !closing ? "auto" : "none"}
            style={[
              { position: "absolute", left: 0, bottom: 0, width: cameraWidth, height: cameraHeight },
              cameraStyle,
            ]}
          >
            {/* The preview stops the moment the card is told to leave. A live
                capture session inside a view that changes size every frame and
                is clipped by a mask makes iOS composite the card offscreen on
                each of those frames, which is why only this exit stuttered and
                the one from the options never did. */}
            {mode === "camera" && !closing ? (
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
          </Animated.View>
        </Animated.View>
      </Animated.View>
    </View>
  );
}
