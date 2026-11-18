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
import { useColumnWidth } from "@/shared/components/adaptive-split";
import { haptics } from "@/shared/lib/haptics";
import { useReducedMotion } from "@/shared/lib/motion";
import { isAndroid } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";
import { END_X } from "@/shared/lib/text-direction";
import { ChatCameraContent } from "./chat-camera-panel";
import { type ComposerContextMeter, ComposerContextRing } from "./composer-context-ring";
import type { ChatAttachmentAnchor, ChatAttachments } from "./use-chat-attachments";

// iOS presents a SwiftUI `Menu` in a window of its own: it cannot be measured,
// transformed, or reopened, and with the keyboard up it refuses to sit on the
// control it belongs to. The attachment menu has to become the camera and come
// back, so it is ours. This is the documented exception to the native
// system-chrome rule in apps/mobile/AGENTS.md, taken as a product decision.
const OPTION_ROW = 48;
// The list is at least this wide and grows to its longest label, so a long
// translation is read in full. Past the camera's width a label wraps.
const OPTIONS_MIN_WIDTH = 236;
const OPTIONS_PADDING = 8;
// Room the list leaves to the right of the safe area.
const OPTIONS_EDGE_GAP = 12;
// A row's width besides its label: the side padding, the icon and the gap.
const ROW_PADDING = 16;
const ROW_ICON = 21;
const ROW_GAP = 14;
const ROW_CHROME = ROW_PADDING * 2 + ROW_ICON + ROW_GAP;
// The line between the attachment rows and the Context row, with its room above and below.
const DIVIDER_SPACE = 9;
/**
 * The list's height before it is measured: Files, Photos and Camera, Use skill when the chat has
 * skills, and Context with its divider when the host reports the context.
 */
const optionsHeight = (rows: number, divided: boolean) =>
  OPTION_ROW * rows + OPTIONS_PADDING * 2 + (divided ? DIVIDER_SPACE : 0);
// The composer card's gap to the screen edges. The camera keeps the same edges, so it lines up
// with the card under it.
const BAR_INSET = 16;
// Room between the top of the composer card and the card that opens above it.
const MENU_GAP = 8;
const SURFACE_RADIUS = 28;
// One shape change, no overshoot: there is no finger on the card, and a card
// that springs past its own size reads as a toy. `ReduceMotion.System` lets
// Reanimated land every one of these on the spot when the setting is on.
const MORPH = { duration: 320, dampingRatio: 1, reduceMotion: ReduceMotion.System };
// Room the camera leaves below the top safe area.
const CAMERA_TOP_GAP = 12;
// The smallest camera that is still usable. Above a tall composer with the keyboard up, the card
// moves down over the composer to keep this height, as it did before it opened above the composer.
const MIN_CAMERA_HEIGHT = 240;
// The material's own fade. An opacity on the card is what broke the glass, so
// the card leaves by dissolving its material instead, through the animated
// style the library itself exposes.
const GLASS_FADE = 0.22;
const PRESS_FADE = 120;
const PRESS_EASING = cubicBezier(0.23, 1, 0.32, 1);
// Each row starts this much later than the one below it. Only opacity and a
// short rise, so a row is pressable from the first frame it is drawn.
const ROW_STAGGER = 0.1;

// On Android, the gesture handler Pressable, not the React Native one. That one measures the row
// from the shadow tree when the press starts and cancels the press when the finger leaves that box.
// With ANDROID_SYNCHRONOUSLY_UPDATE_UI_PROPS, the card's animated transforms reach the shadow tree
// about a second after the card stops, or at the next render: the first tap measured the closed card
// at the plus and did nothing. This one checks the touch in the row's own coordinates, which the
// transforms above it do not change. iOS commits the transforms to the shadow tree on each frame.
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
  /** For a row whose visible text does not say all of it, such as the Context row. */
  accessibilityLabel?: string;
  /** True while the row's value is being worked on, such as a compaction. */
  busy?: boolean;
  disabled: boolean;
  foreground: ViewStyle["backgroundColor"];
  /** Drawn in place of `icon`. */
  glyph?: ReactNode;
  icon?: LucideIcon;
  index: number;
  label: string;
  onPress: () => void;
  progress: SharedValue<number>;
  /** A short value at the row's end. */
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

/**
 * The attachment card. It grows out of the plus, holds the options, morphs into
 * the camera and back, and collapses into the plus again.
 */
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
  /**
   * The plus the card grows out of, from the screen's left and bottom edges,
   * before the keyboard lifts the composer.
   */
  anchor: ChatAttachmentAnchor;
  /** False while a system prompt or another app holds the foreground. */
  appActive: boolean;
  attachments: ChatAttachments;
  /** How full the chat's context is, for a host that reports it. A row below the attachment rows opens its sheet. */
  context?: ComposerContextMeter;
  fallbackBackground: ViewStyle["backgroundColor"];
  foreground: ViewStyle["backgroundColor"];
  /** The composer's own lift. The card rides it, so it stays on the plus. */
  keyboardHeight: SharedValue<number>;
  keyboardOffset: number;
  liquidGlassAvailable: boolean;
  onClose: () => void;
  /** Present when the chat's agent has skills: the row writes `@` in the field and offers them. */
  onUseSkill?: () => void;
  /**
   * 0 with the card gone, 1 with it open. Shared with the composer, so the
   * plus comes back on the same frame the card stops covering it.
   */
  progress: SharedValue<number>;
}) {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // The camera centres between the side insets: the rail of iPhone Duo and the edges in landscape.
  const safeWidth = useColumnWidth() - insets.left - insets.right;
  // The anchor and the card count from the start edge: the right in a right-to-left layout.
  const startInset = END_X === 1 ? insets.left : insets.right;
  const { t, format } = useText();
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
  const cameraWidth = Math.min(440, safeWidth - BAR_INSET * 2);
  // Read once, for this card's whole life: the keyboard is not dismissed for
  // the camera any more, and the glass behind the card must never be resized.
  // The card already rides the keyboard's lift, so the camera takes the room
  // that is left above it.
  const [keyboardInset] = useState(() => Math.max(0, (Keyboard.metrics()?.height ?? 0) - keyboardOffset));
  const rowCount = 3 + (onUseSkill ? 1 : 0) + (context ? 1 : 0);
  // The highest point the card can reach, from the screen's bottom edge, before the keyboard lift.
  const roomTop = height - insets.top - keyboardInset - CAMERA_TOP_GAP;
  // The card opens above the composer, not over it: the draft, the plus and Send stay in view.
  // When a tall composer leaves too little room above it, the card moves down over the composer,
  // but never below the plus, so the camera and the list stay below the top safe area.
  const openBottom = Math.max(
    anchor.bottom,
    Math.min(
      anchor.barTop + MENU_GAP,
      roomTop - Math.max(MIN_CAMERA_HEIGHT, optionsHeight(rowCount, Boolean(context))),
    ),
  );
  const rise = openBottom - anchor.bottom;
  const cameraHeight = Math.min(height * 0.58, roomTop - openBottom);
  // The options list takes the composer card's start edge. The camera takes the card's full width
  // and centres between the side insets, so its sides line up with the open composer.
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
  // The list's width comes from its longest label, measured once off the card.
  // The list must have a width of its own: inside the card it would be laid
  // out against the card's animated width on every frame. The card starts to
  // grow once the list's height is known, so it grows in one motion.
  const [listWidth, setListWidth] = useState<number | null>(null);
  const listHeight = useSharedValue(optionsHeight(rowCount, Boolean(context)));
  const openedRef = useRef(false);

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
    const openWidth = interpolate(shape, [0, 1], [listWidth ?? OPTIONS_MIN_WIDTH, cameraWidth]);
    const openHeight = interpolate(shape, [0, 1], [listHeight.get(), cameraHeight]);
    return {
      // The card grows from the plus's size, from its bottom corner above the plus. It stays above
      // the composer for its whole life: a card that passed over the plus covered the turning
      // plus and its close mark, and an opaque card made them flicker on Android.
      width: interpolate(presented, [0, 1], [anchor.size, openWidth]),
      height: interpolate(presented, [0, 1], [anchor.size, openHeight]),
      // Without glass the card is opaque, so it fades in its first part and out in its last part,
      // and does not leave a small square at the end of a close. Glass dissolves on its own, and an
      // opacity here would take its material away.
      opacity: liquidGlassAvailable ? 1 : interpolate(presented, [0, 0.35], [0, 1], Extrapolation.CLAMP),
      // It moves to the composer card's start edge as it opens.
      transform: [
        { translateX: END_X * presented * (optionsShift + (cameraShift - optionsShift) * shape) },
        { translateY: -rise },
      ],
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
    transform: [{ scale: interpolate(progress.get(), [0, 1], [anchor.size / (listWidth ?? OPTIONS_MIN_WIDTH), 1]) }],
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
                {/* The widest value, so the width does not change with the reading. */}
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
                // Hidden until it has its width, so it is laid out only once.
                display: listWidth === null ? "none" : "flex",
                paddingVertical: OPTIONS_PADDING,
                // The card grows from its own bottom corner at the plus, so the rows do too.
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
            {/* The preview stops the moment the card is told to leave, and
                for as long as the app is not in front. A live capture session
                inside a view that changes size every frame and is clipped by a
                mask makes iOS composite the card offscreen on each of those
                frames, which is why only this exit stuttered and the one from
                the options never did. */}
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
          </Animated.View>
        </Animated.View>
      </Animated.View>
    </View>
  );
}
