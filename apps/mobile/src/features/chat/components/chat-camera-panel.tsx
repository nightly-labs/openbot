import { type CameraType, CameraView } from "expo-camera";
import { Button, Typography } from "heroui-native";
import { ChevronLeft, SwitchCamera } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { BackHandler, Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import Animated, { FadeInUp, ReduceMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// The requested camera is a floating panel inside chat, not a navigation sheet.
export function ChatCameraPanel({
  onClose,
  onPhoto,
}: {
  onClose: () => void;
  onPhoto: (uri: string) => Promise<void>;
}) {
  const camera = useRef<CameraView>(null);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [facing, setFacing] = useState<CameraType>("back");
  const [error, setError] = useState<string | null>(null);
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    const back = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!busyRef.current) onClose();
      return true;
    });
    return () => back.remove();
  }, [onClose]);
  async function capture() {
    if (!ready || busyRef.current || !camera.current) return;
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
      style={StyleSheet.absoluteFill}
      accessibilityViewIsModal
      onAccessibilityEscape={() => {
        if (!busyRef.current) onClose();
      }}
    >
      <Pressable
        style={StyleSheet.absoluteFill}
        accessible={false}
        onPress={() => {
          if (!busyRef.current) onClose();
        }}
      />
      <Animated.View
        entering={FadeInUp.duration(200).reduceMotion(ReduceMotion.System)}
        className="absolute self-center overflow-hidden rounded-[32px] bg-control"
        style={{
          bottom: Math.max(insets.bottom, 12),
          width: Math.min(440, width - 24),
          height: Math.min(height * 0.58, height - insets.top - insets.bottom - 24),
        }}
      >
        <CameraView
          key={facing}
          ref={camera}
          style={StyleSheet.absoluteFill}
          facing={facing}
          mode="picture"
          onCameraReady={() => setReady(true)}
          onMountError={() => {
            setReady(false);
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
            isDisabled={busy}
            onPress={onClose}
          >
            <ChevronLeft color="white" size={25} />
          </Button>
          <Button
            isIconOnly
            variant="secondary"
            className="size-16 rounded-full border-4 border-white/50 bg-white"
            accessibilityLabel="Take photo"
            isDisabled={!ready || busy}
            onPress={() => void capture()}
          />
          <Button
            isIconOnly
            variant="secondary"
            className="size-12 rounded-full bg-black/60"
            accessibilityLabel="Switch camera"
            isDisabled={busy}
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
