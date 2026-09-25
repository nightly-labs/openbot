import { Image } from "expo-image";
import { router } from "expo-router";
import { HeaderHeightContext } from "expo-router/react-navigation";
import { useContext, useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { clamp, focalTranslation, rubberBandClamp } from "@/features/chat/model/image-viewer-geometry";
import { SheetSaveAction } from "@/shared/components/sheet-save-action";
import {
  type AvatarCrop,
  type AvatarCropSource,
  currentAvatarCropRequest,
  finishAvatarCrop,
} from "@/shared/lib/avatar-crop-request";
import { isIOS } from "@/shared/lib/platform";

const MARGIN = 16;
const MAX_SCALE = 5;
const SETTLE_SPRING = { damping: 34, stiffness: 320, mass: 1 } as const;

/** Move and scale a picked photo inside a circle, as the avatar will show it. */
export function AvatarCropScreen() {
  const [request] = useState(currentAvatarCropRequest);
  const readCrop = useRef<(() => AvatarCrop) | null>(null);
  const headerHeight = useContext(HeaderHeightContext) ?? 0;
  const insets = useSafeAreaInsets();
  const [frame, setFrame] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => {
    if (!request) router.back();
    // Going back without a choice cancels the photo.
    return () => {
      if (request) finishAvatarCrop(request, null);
    };
  }, [request]);

  const top = isIOS ? headerHeight : 0;
  const area = frame ? { width: frame.width, height: frame.height - top - insets.bottom } : null;
  const side = area ? Math.floor(Math.min(area.width, area.height) - MARGIN * 2) : 0;
  return (
    <View
      className="flex-1 bg-sheet"
      style={{ overflow: "hidden" }}
      onLayout={(event) => setFrame(event.nativeEvent.layout)}
    >
      <SheetSaveAction
        dirty
        canSave={Boolean(request && side > 0)}
        pending={false}
        label="Choose"
        onSave={() => {
          const crop = readCrop.current?.();
          if (!request || !crop) return;
          finishAvatarCrop(request, crop);
          router.back();
        }}
      />
      {request && area && side > 0 ? (
        <CropArea
          source={request.source}
          side={side}
          centerX={area.width / 2}
          centerY={top + area.height / 2}
          extent={area.width + area.height + top}
          readCrop={readCrop}
        />
      ) : null}
    </View>
  );
}

function CropArea({
  source,
  side,
  centerX,
  centerY,
  extent,
  readCrop,
}: {
  source: AvatarCropSource;
  side: number;
  centerX: number;
  centerY: number;
  /** Wide enough for the dimmed ring around the circle to reach every corner of the screen. */
  extent: number;
  readCrop: { current: (() => AvatarCrop) | null };
}) {
  // At scale 1 the photo just covers the circle's square.
  const base = side / Math.max(Math.min(source.width, source.height), 1);
  const shown = { width: source.width * base, height: source.height * base };
  const scale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const startScale = useSharedValue(1);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const focalOffsetX = useSharedValue(0);
  const focalOffsetY = useSharedValue(0);
  const pinching = useSharedValue(false);

  readCrop.current = () => {
    const pixels = base * scale.get();
    const size = Math.max(1, Math.floor(Math.min(side / pixels, source.width, source.height)));
    const x = source.width / 2 - tx.get() / pixels - size / 2;
    const y = source.height / 2 - ty.get() / pixels - size / 2;
    return {
      originX: Math.round(clamp(x, 0, source.width - size)),
      originY: Math.round(clamp(y, 0, source.height - size)),
      width: size,
      height: size,
    };
  };

  function bound(length: number, atScale: number) {
    "worklet";
    return Math.max(0, (length * atScale - side) / 2);
  }

  function settle() {
    "worklet";
    const target = clamp(scale.get(), 1, MAX_SCALE);
    const boundX = bound(shown.width, target);
    const boundY = bound(shown.height, target);
    scale.set(withSpring(target, SETTLE_SPRING));
    tx.set(withSpring(clamp(tx.get(), -boundX, boundX), SETTLE_SPRING));
    ty.set(withSpring(clamp(ty.get(), -boundY, boundY), SETTLE_SPRING));
  }

  function stop() {
    "worklet";
    cancelAnimation(scale);
    cancelAnimation(tx);
    cancelAnimation(ty);
  }

  // Two fingers scale about the point between them and move the photo with it.
  const pinch = Gesture.Pinch()
    .onStart((event) => {
      stop();
      pinching.set(true);
      startScale.set(scale.get());
      focalOffsetX.set(event.focalX - centerX - tx.get());
      focalOffsetY.set(event.focalY - centerY - ty.get());
    })
    .onUpdate((event) => {
      const next = rubberBandClamp(startScale.get() * event.scale, 1, MAX_SCALE, MAX_SCALE);
      scale.set(next);
      tx.set(focalTranslation(event.focalX - centerX, focalOffsetX.get(), startScale.get(), next));
      ty.set(focalTranslation(event.focalY - centerY, focalOffsetY.get(), startScale.get(), next));
    })
    .onEnd(() => {
      pinching.set(false);
      settle();
    });

  const pan = Gesture.Pan()
    .maxPointers(1)
    .onStart(() => {
      stop();
      startX.set(tx.get());
      startY.set(ty.get());
    })
    .onUpdate((event) => {
      if (pinching.get()) return;
      const boundX = bound(shown.width, scale.get());
      const boundY = bound(shown.height, scale.get());
      tx.set(rubberBandClamp(startX.get() + event.translationX, -boundX, boundX, side));
      ty.set(rubberBandClamp(startY.get() + event.translationY, -boundY, boundY, side));
    })
    .onEnd(() => {
      if (!pinching.get()) settle();
    });

  const pictureStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.get() }, { translateY: ty.get() }, { scale: scale.get() }],
  }));

  return (
    <GestureDetector gesture={Gesture.Simultaneous(pinch, pan)}>
      <View
        style={StyleSheet.absoluteFill}
        collapsable={false}
        accessible
        accessibilityRole="image"
        accessibilityLabel="Photo crop"
        accessibilityHint="Drag to move the photo. Pinch to scale it."
      >
        <Animated.View
          style={[
            {
              position: "absolute",
              left: centerX - shown.width / 2,
              top: centerY - shown.height / 2,
              width: shown.width,
              height: shown.height,
            },
            pictureStyle,
          ]}
        >
          <Image
            source={source.uri}
            contentFit="fill"
            transition={0}
            accessible={false}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
        {/* A thick round border leaves a clear circle and dims the rest of the photo. */}
        <View
          pointerEvents="none"
          className="border-black/60"
          style={{
            position: "absolute",
            left: centerX - side / 2 - extent,
            top: centerY - side / 2 - extent,
            width: side + extent * 2,
            height: side + extent * 2,
            borderRadius: side / 2 + extent,
            borderWidth: extent,
          }}
        />
        <View
          pointerEvents="none"
          className="border-white/70"
          style={{
            position: "absolute",
            left: centerX - side / 2,
            top: centerY - side / 2,
            width: side,
            height: side,
            borderRadius: side / 2,
            borderWidth: StyleSheet.hairlineWidth,
          }}
        />
      </View>
    </GestureDetector>
  );
}
