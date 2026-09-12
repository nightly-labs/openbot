import { type CameraType, CameraView } from "expo-camera";
import { Button, Typography } from "heroui-native";
import { ChevronLeft, SwitchCamera } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { BackHandler, Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import Animated, {
  cancelAnimation,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";
import type { ChatCameraOrigin } from "./use-chat-attachments";

const PANEL_MOTION = { duration: 300, dampingRatio: 1, reduceMotion: ReduceMotion.System };

// The requested camera is a floating panel inside chat, not a navigation sheet.
export function ChatCameraPanel({
  onClose,
  onPhoto,
  origin,
}: {
  origin?: ChatCameraOrigin;
  onClose: () => void;
  onPhoto: (uri: string) => Promise<void>;
}) {
  const camera = useRef<CameraView>(null);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [opened, setOpened] = useState(false);
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const presented = useRef(false);
  const root = useRef<View>(null);
  const [bounds, setBounds] = useState<ChatCameraOrigin | null>(null);
  const [facing, setFacing] = useState<CameraType>("back");
  const [error, setError] = useState<string | null>(null);
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const panelWidth = Math.min(440, (bounds?.width ?? width) - 24);
  const panelHeight = Math.min(height * 0.58, (bounds?.height ?? height) - insets.top - insets.bottom - 24);
  const bottom = Math.max(insets.bottom, 12);
  const centerX = (bounds?.x ?? 0) + (bounds?.width ?? width) / 2;
  const centerY = (bounds?.y ?? 0) + (bounds?.height ?? height) - bottom - panelHeight / 2;
  const progress = useSharedValue(0);
  // Keep the native preview at its final dimensions. Only its container transforms.
  const panelStyle = useAnimatedStyle(() => {
    const p = progress.get();
    const remaining = 1 - p;
    return {
      opacity: Math.min(1, p * 4),
      transform: [
        { translateX: reduceMotion || !origin ? 0 : (origin.x + origin.width / 2 - centerX) * remaining },
        { translateY: reduceMotion ? 0 : (origin ? origin.y + origin.height / 2 - centerY : 24) * remaining },
        { scaleX: reduceMotion ? 1 : 1 - (1 - (origin ? origin.width / panelWidth : 0.95)) * remaining },
        { scaleY: reduceMotion ? 1 : 1 - (1 - (origin ? origin.height / panelHeight : 0.95)) * remaining },
      ],
    };
  });
  useEffect(() => {
    if (!opened || (origin && !bounds) || presented.current || closingRef.current) return;
    presented.current = true;
    progress.set(withSpring(1, PANEL_MOTION));
  }, [bounds, opened, origin, progress]);
  useEffect(() => () => cancelAnimation(progress), [progress]);
  const close = useCallback(() => {
    if (busyRef.current || closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    if (!presented.current) {
      onClose();
      return;
    }
    progress.set(
      withSpring(0, PANEL_MOTION, (finished) => {
        if (finished) scheduleOnRN(onClose);
      }),
    );
  }, [onClose, progress]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    const back = BackHandler.addEventListener("hardwareBackPress", () => {
      close();
      return true;
    });
    return () => back.remove();
  }, [close]);
  async function capture() {
    if (!ready || busyRef.current || closingRef.current || !camera.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const photo = await camera.current.takePictureAsync({ quality: 1 });
      if (!mounted.current) return;
      if (!photo?.uri) throw new Error("Could not take the photo. Try again.");
      await onPhoto(photo.uri);
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : "Could not take the photo. Try again.");
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <View
      ref={root}
      collapsable={false}
      style={StyleSheet.absoluteFill}
      accessibilityViewIsModal
      onAccessibilityEscape={close}
      onLayout={() => root.current?.measureInWindow((x, y, width, height) => setBounds({ x, y, width, height }))}
    >
      <Pressable style={StyleSheet.absoluteFill} accessible={false} onPress={close} />
      <Animated.View
        pointerEvents={opened && !closing ? "auto" : "none"}
        accessibilityElementsHidden={!opened}
        importantForAccessibility={opened ? "auto" : "no-hide-descendants"}
        className="absolute self-center overflow-hidden rounded-[32px] bg-control"
        style={[
          panelStyle,
          {
            bottom,
            width: panelWidth,
            height: panelHeight,
          },
        ]}
      >
        <CameraView
          key={facing}
          ref={camera}
          style={StyleSheet.absoluteFill}
          facing={facing}
          mode="picture"
          onCameraReady={() => {
            setReady(true);
            setOpened(true);
          }}
          onMountError={() => {
            setReady(false);
            setOpened(true);
            setError("Could not start the camera. Close it and try again.");
          }}
        />
        {error ? (
          <View className="absolute inset-x-4 top-4 rounded-2xl bg-black/70 p-3">
            <Typography.Paragraph accessibilityRole="alert" className="text-white">
              {error}
            </Typography.Paragraph>
          </View>
        ) : null}
        <View className="absolute inset-x-5 bottom-5 flex-row items-center justify-between">
          <Button
            isIconOnly
            variant="secondary"
            className="size-12 rounded-full bg-black/60"
            accessibilityLabel="Close camera"
            isDisabled={busy || closing}
            onPress={close}
          >
            <ChevronLeft color="white" size={25} />
          </Button>
          <Button
            isIconOnly
            variant="secondary"
            className="size-16 rounded-full border-4 border-white/50 bg-white"
            accessibilityLabel="Take photo"
            isDisabled={!ready || busy || closing}
            onPress={() => void capture()}
          />
          <Button
            isIconOnly
            variant="secondary"
            className="size-12 rounded-full bg-black/60"
            accessibilityLabel="Switch camera"
            isDisabled={busy || closing}
            onPress={() => {
              setReady(false);
              setError(null);
              setFacing((current) => (current === "back" ? "front" : "back"));
            }}
          >
            <SwitchCamera color="white" size={23} />
          </Button>
        </View>
      </Animated.View>
    </View>
  );
}
