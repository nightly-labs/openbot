import type { AttachmentSummary } from "@openbot/contracts/ipc";
import { Image } from "expo-image";
import { router } from "expo-router";
import { Skeleton, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import ImageOff from "lucide-react-native/icons/image-off";
import Images from "lucide-react-native/icons/images";
import { useEffect, useRef, useState } from "react";
import { Pressable, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  cancelAnimation,
  type SharedValue,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN, scheduleOnUI } from "react-native-worklets";
import { haptics } from "@/shared/lib/haptics";
import { useReducedMotion } from "@/shared/lib/motion";
import { longPressDelay } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";
import { END_X } from "@/shared/lib/text-direction";
import { FILL, FRAME_RADIUS, MAX_FRAME_WIDTH } from "../model/attachment-frame";
import { sameShape } from "../model/image-dimensions";
import type { GalleryTile } from "../model/image-gallery-layout";
import { storeImageGallery } from "../model/image-gallery-store";
import {
  dragPose,
  frontSlot,
  shouldThrow,
  stackDepth,
  stackPose,
  throwProgress,
  throwReach,
  throwVelocity,
} from "../model/image-stack-motion";
import { rubberBandClamp } from "../model/image-viewer-geometry";
import { rememberImageDimensions, useAttachmentFile } from "./attachment-preview";
import { isViewableImage, useChatImageSource } from "./chat-image-viewer";
import { UPLOAD_BLUR_RADIUS, useUploadReveal } from "./upload-progress";

const TILE_RADIUS = 10;
const CARD_WIDTH = 196;
const CARD_HEIGHT = 252;
// Room around the front card for the cards that show behind it.
const SPREAD = 20;
const LIFT = 14;
const ACTION_ICON_INSET = 11;
// Settles without passing its place: a position past the next card would start the next throw.
const STACK_SPRING = { damping: 30, stiffness: 260, mass: 1, overshootClamping: true } as const;
const SETTLE_SPRING = { damping: 26, stiffness: 320, mass: 1 } as const;

interface StackMotion {
  position: SharedValue<number>;
  dragX: SharedValue<number>;
  direction: SharedValue<number>;
}

/**
 * The images of one message as a stack of cards. A tap opens the conversation's viewer on
 * the front card; a sideways swipe sends it to the back. The count under the stack opens all the
 * images on a screen of their own.
 */
export function ChatImageGallery({
  attachments,
  uploads,
  serverId,
  alignment,
}: {
  attachments: readonly AttachmentSummary[];
  /** The sent fraction of each image, from 0 to 1, while the message that carries them is sending. */
  uploads?: readonly (number | undefined)[];
  serverId: string;
  /** The side of the chat the message is on. The count sits on that side, as the actions do. */
  alignment: "left" | "right";
}) {
  const { t } = useText();
  const muted = useThemeColor("muted");
  const reduced = useReducedMotion();
  const { width } = useWindowDimensions();
  const cardWidth = Math.min(CARD_WIDTH, Math.min(MAX_FRAME_WIDTH, width - 80) - SPREAD * 2);
  const count = attachments.length;
  const keys = attachments.map((attachment) => attachment.id);
  // A stack at the end fans out as the mirror image of one at the start, and a card that a screen
  // reader moves swings toward the open side of the chat. The alignment is the side in the layout, so
  // a right-to-left layout puts it on the other side of the screen.
  const mirror = (alignment === "right" ? -1 : 1) * END_X;
  const viewer = useChatImageSource(null, 0);
  const hiddenSource = viewer.hiddenSource;
  const position = useSharedValue(0);
  const dragX = useSharedValue(0);
  const direction = useSharedValue(-1);
  // Where the position comes to rest, so a finger that stops a moving stack lands it there.
  const target = useSharedValue(0);
  const motion: StackMotion = { position, dragX, direction };
  // React hears the front card only to name it to a screen reader and to open it.
  const [front, setFront] = useState(0);
  const retries = useRef(new Map<number, () => boolean>());
  // Images the phone is still sending are only on the phone, so the viewer and the gallery screen wait for the host.
  const sent = attachments.every(isViewableImage);

  function openSlot(slot: number) {
    const attachment = attachments[slot];
    if (!attachment || !isViewableImage(attachment) || retries.current.get(slot)?.()) return;
    viewer.open?.(attachment);
  }

  // A card that goes to the back is a physical move, so it gets an impact, not a selection tick.
  function tick() {
    void haptics.impact("light");
  }

  /** Sends the front card to the back, from `progress` of the way, at `velocity`. */
  function throwFront(side: number, progress: number, velocity: number) {
    "worklet";
    const base = Math.round(position.get());
    const next = base + 1;
    target.set(next);
    direction.set(side);
    position.set(base + progress);
    dragX.set(0);
    const settled = (finished?: boolean) => {
      "worklet";
      if (finished) scheduleOnRN(setFront, frontSlot(next, count));
    };
    position.set(
      reduced ? withTiming(next, { duration: 200 }, settled) : withSpring(next, { ...STACK_SPRING, velocity }, settled),
    );
    scheduleOnRN(tick);
  }

  /** Brings the back card to the front: the throw played backwards. */
  function bringBack() {
    "worklet";
    const previous = Math.round(position.get()) - 1;
    target.set(previous);
    direction.set(mirror);
    dragX.set(0);
    const settled = (finished?: boolean) => {
      "worklet";
      if (finished) scheduleOnRN(setFront, frontSlot(previous, count));
    };
    position.set(
      reduced ? withTiming(previous, { duration: 200 }, settled) : withSpring(previous, STACK_SPRING, settled),
    );
    scheduleOnRN(tick);
  }

  // The viewer may page to another image of this message. That card comes to the front behind it,
  // so the picture flies back to the card that is in front, and the stack shows what was seen last.
  useAnimatedReaction(
    () => hiddenSource.get(),
    (key) => {
      const slot = key === null ? -1 : keys.indexOf(key);
      if (slot < 0) return;
      const base = Math.round(position.get());
      const offset = stackDepth(slot, base, count);
      if (offset === 0) return;
      cancelAnimation(position);
      dragX.set(0);
      target.set(base + offset);
      position.set(base + offset);
      scheduleOnRN(setFront, slot);
    },
  );

  const pan = Gesture.Pan()
    .maxPointers(1)
    .activeOffsetX([-12, 12])
    .failOffsetY([-12, 12])
    .onStart(() => {
      // A card still on its way to the back lands first, so the finger takes the new front card.
      if (Math.abs(position.get() - target.get()) > 0.001) {
        cancelAnimation(position);
        position.set(target.get());
        scheduleOnRN(setFront, frontSlot(target.get(), count));
      }
      cancelAnimation(dragX);
    })
    .onUpdate((event) => {
      const reach = throwReach(cardWidth);
      dragX.set(rubberBandClamp(event.translationX, -reach, reach, cardWidth));
    })
    .onEnd((event, success) => {
      const drag = dragX.get();
      if (success && shouldThrow(drag, event.velocityX, cardWidth)) {
        const progress = throwProgress(drag, cardWidth);
        const side = drag === 0 ? Math.sign(event.velocityX) || -1 : Math.sign(drag);
        throwFront(side, progress, throwVelocity(event.velocityX, progress, cardWidth));
        return;
      }
      dragX.set(withSpring(0, { ...SETTLE_SPRING, velocity: event.velocityX }));
    });

  const tap = Gesture.Tap()
    .maxDistance(10)
    .onEnd((_event, success) => {
      if (success) scheduleOnRN(openSlot, frontSlot(position.get(), count));
    });

  const frontAttachment = attachments[front] ?? attachments[0];
  return (
    <View style={{ width: cardWidth + SPREAD * 2 }} className="gap-1">
      <GestureDetector gesture={Gesture.Race(pan, tap)}>
        <View
          collapsable={false}
          accessible
          accessibilityRole="adjustable"
          accessibilityState={{ busy: uploads !== undefined }}
          accessibilityLabel={t("mobile.chat.attachment.preview", { name: frontAttachment?.name ?? "" })}
          accessibilityValue={{ text: t("mobile.chat.imageViewer.position", { current: front + 1, total: count }) }}
          accessibilityActions={[{ name: "activate" }, { name: "increment" }, { name: "decrement" }]}
          onAccessibilityAction={(event) => {
            const action = event.nativeEvent.actionName;
            if (action === "activate") openSlot(front);
            else if (action === "increment") scheduleOnUI(throwFront, mirror, 0, 0);
            else scheduleOnUI(bringBack);
          }}
          style={{ width: cardWidth + SPREAD * 2, height: CARD_HEIGHT + LIFT * 2 }}
        >
          {attachments.map((attachment, slot) => (
            <StackCard
              key={attachment.id}
              attachment={attachment}
              serverId={serverId}
              slot={slot}
              upload={uploads?.[slot]}
              count={count}
              width={cardWidth}
              reduced={reduced}
              mirror={mirror}
              motion={motion}
              retries={retries.current}
            />
          ))}
        </View>
      </GestureDetector>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !sent }}
        disabled={!sent}
        hitSlop={8}
        className={`flex-row items-center gap-1 ${alignment === "right" ? "self-end" : "self-start"}`}
        // The count keeps the inset of an 18-point action icon centred in its 40-point button, on
        // the side of the message, so the stacks of the two sides are mirror images.
        style={({ pressed }) => ({
          opacity: pressed ? 0.55 : 1,
          paddingLeft: alignment === "right" ? 0 : ACTION_ICON_INSET,
          paddingRight: alignment === "right" ? ACTION_ICON_INSET : 0,
        })}
        onPress={() => {
          void haptics.selection();
          const galleryId = storeImageGallery({ serverId, images: attachments });
          router.push({ pathname: "/image-gallery/[galleryId]", params: { galleryId } });
        }}
      >
        <Images size={14} color={String(muted)} />
        <Typography.Paragraph type="body-xs" className="text-muted">
          {t("mobile.chat.imageGallery.count", { count })}
        </Typography.Paragraph>
      </Pressable>
    </View>
  );
}

/** One card of the stack. Its pose comes from the stack's position on the UI thread. */
function StackCard({
  attachment,
  serverId,
  slot,
  upload,
  count,
  width,
  reduced,
  mirror,
  motion,
  retries,
}: {
  attachment: AttachmentSummary;
  serverId: string;
  slot: number;
  upload?: number;
  count: number;
  width: number;
  reduced: boolean;
  /** 1 for a stack on the left of the chat, -1 for one on the right. */
  mirror: number;
  motion: StackMotion;
  retries: Map<number, () => boolean>;
}) {
  const muted = useThemeColor("muted");
  const { localUri, uri, dimensions, query } = useAttachmentFile(serverId, attachment, true);
  const [loaded, setLoaded] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const source = useChatImageSource(isViewableImage(attachment) ? attachment.id : null, FRAME_RADIUS);
  const failed = Boolean(query.error) || imageFailed;
  // As on a single image: the card is blurred while it uploads and comes into focus as it leaves the phone.
  const { shownUpload, revealStyle } = useUploadReveal(upload);
  // A tap on a card that failed loads it again instead of opening the viewer.
  useEffect(() => {
    retries.set(slot, () => {
      if (!failed) return false;
      setImageFailed(false);
      void query.refetch();
      return true;
    });
    return () => {
      retries.delete(slot);
    };
  });

  const poseStyle = useAnimatedStyle(() => {
    const position = motion.position.get();
    const depth = stackDepth(slot, position, count);
    const pose = stackPose(depth, count, width, motion.direction.get(), !reduced, mirror);
    const drag = depth < 0.001 || depth > count - 0.001 ? dragPose(motion.dragX.get(), width) : { x: 0, rotate: 0 };
    // The whole card hides while the viewer holds its picture, its shadow too.
    const hidden = source.hiddenSource.get() === attachment.id;
    return {
      opacity: hidden ? 0 : pose.opacity,
      zIndex: pose.zIndex,
      transform: [
        { translateX: pose.x + drag.x },
        { translateY: pose.y },
        { rotate: `${pose.rotate + drag.rotate}deg` },
        { scale: pose.scale },
      ],
    };
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: "absolute",
          left: SPREAD,
          top: LIFT,
          width,
          height: CARD_HEIGHT,
          borderRadius: FRAME_RADIUS,
          borderCurve: "continuous",
          boxShadow: "0 4px 16px rgba(0, 0, 0, 0.22)",
        },
        poseStyle,
      ]}
    >
      <Animated.View
        ref={source.origin}
        collapsable={false}
        className="bg-control"
        style={{ ...FILL, borderRadius: FRAME_RADIUS, borderCurve: "continuous", overflow: "hidden" }}
      >
        {failed ? (
          <View className="items-center justify-center" style={FILL}>
            <ImageOff size={22} color={String(muted)} />
          </View>
        ) : (
          <>
            <Skeleton isLoading={!loaded} className="rounded-none" style={FILL} />
            {shownUpload !== undefined && uri ? (
              <Image
                source={uri}
                blurRadius={UPLOAD_BLUR_RADIUS}
                transition={0}
                contentFit="cover"
                accessible={false}
                style={FILL}
              />
            ) : null}
            <Animated.View style={[FILL, revealStyle]}>
              <Image
                source={uri}
                transition={localUri ? 0 : 220}
                contentFit="cover"
                accessible={false}
                style={FILL}
                onLoad={({ source: decoded }) => {
                  setLoaded(true);
                  if (decoded.width <= 0 || decoded.height <= 0) return;
                  const size = { width: decoded.width, height: decoded.height };
                  if (dimensions && sameShape(dimensions, size)) return;
                  rememberImageDimensions(attachment.id, size);
                }}
                onError={() => setImageFailed(true)}
              />
            </Animated.View>
          </>
        )}
      </Animated.View>
    </Animated.View>
  );
}

/**
 * One image of the gallery screen's grid. A tap opens the screen's viewer on it, and a failed
 * image loads again.
 */
export function ChatGalleryTile({
  attachment,
  serverId,
  tile,
  onLongPress,
}: {
  attachment: AttachmentSummary;
  serverId: string;
  tile: GalleryTile;
  /** Opens the menu of the tile. The native context menu does not cancel the tap without it. */
  onLongPress?: () => void;
}) {
  const { t } = useText();
  const muted = useThemeColor("muted");
  const { pending, localUri, uri, dimensions, query } = useAttachmentFile(serverId, attachment, true);
  const [loaded, setLoaded] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const source = useChatImageSource(attachment.id, TILE_RADIUS);
  const failed = Boolean(query.error) || imageFailed;

  return (
    <Animated.View
      ref={source.origin}
      collapsable={false}
      style={[
        {
          position: "absolute",
          left: tile.left,
          top: tile.top,
          width: tile.width,
          height: tile.height,
          borderRadius: TILE_RADIUS,
          borderCurve: "continuous",
          overflow: "hidden",
        },
        source.hiddenStyle,
      ]}
    >
      {/* A plain pressable, so every layer fills the tile exactly. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          failed
            ? t("mobile.chat.attachment.retryImage")
            : t("mobile.chat.attachment.preview", { name: attachment.name })
        }
        accessibilityState={{ disabled: pending || (!uri && !failed), busy: !failed && !loaded }}
        // A tile with a menu keeps its long press while the image loads; only the tap waits for it.
        disabled={!onLongPress && (pending || (!uri && !failed))}
        onPress={() => {
          if (pending || (!uri && !failed)) return;
          if (!failed) {
            source.open?.(attachment);
            return;
          }
          setImageFailed(false);
          void query.refetch();
        }}
        delayLongPress={longPressDelay}
        onLongPress={onLongPress}
        style={FILL}
      >
        {failed ? (
          <View className="items-center justify-center bg-control" style={FILL}>
            <ImageOff size={22} color={String(muted)} />
          </View>
        ) : (
          <>
            <Skeleton isLoading={!loaded} className="rounded-none" style={FILL} />
            <Image
              source={uri}
              transition={localUri ? 0 : 220}
              contentFit="cover"
              accessible={false}
              style={FILL}
              onLoad={({ source: decoded }) => {
                setLoaded(true);
                if (decoded.width <= 0 || decoded.height <= 0) return;
                // The decoder has the final word on the shape, which the viewer opens the image in.
                const size = { width: decoded.width, height: decoded.height };
                if (dimensions && sameShape(dimensions, size)) return;
                rememberImageDimensions(attachment.id, size);
              }}
              onError={() => setImageFailed(true)}
            />
          </>
        )}
      </Pressable>
    </Animated.View>
  );
}
