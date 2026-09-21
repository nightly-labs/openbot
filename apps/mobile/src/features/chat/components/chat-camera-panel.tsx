import { type CameraType, CameraView } from "expo-camera";
import { Button, Typography } from "heroui-native";
import { ChevronLeft, SwitchCamera } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { cubicBezier, useReducedMotion } from "react-native-reanimated";

// The preview arrives when the hardware is ready, which is not when the panel
// opens. It fades in over the surface it was given rather than popping in.
const PREVIEW_FADE = 180;
const PREVIEW_EASING = cubicBezier(0.23, 1, 0.32, 1);

/**
 * The camera itself, with no surface of its own. `ChatAttachmentPanel` owns the
 * card this fills, so the same card can carry the options and the camera and
 * morph between them instead of swapping one view for another.
 */
export function ChatCameraContent({
  onBusyChange,
  onCancel,
  onCaptured,
}: {
  /** True while a capture is in flight, when the panel must not be dismissed. */
  onBusyChange: (busy: boolean) => void;
  onCancel: () => void;
  /**
   * A photo exists at this uri. Holding it is the panel's business and waits
   * for the card to leave: reading and encoding a full-size photo on the
   * frames of that exit is what made it stutter.
   */
  onCaptured: (uri: string) => void;
}) {
  const camera = useRef<CameraView>(null);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [facing, setFacing] = useState<CameraType>("back");
  const [error, setError] = useState<string | null>(null);
  const reduceMotion = useReducedMotion();
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function capture() {
    if (!ready || busyRef.current || !camera.current) return;
    busyRef.current = true;
    setBusy(true);
    onBusyChange(true);
    setError(null);
    try {
      const photo = await camera.current.takePictureAsync({ quality: 1 });
      if (!mounted.current) return;
      if (!photo?.uri) throw new Error("Could not take the photo. Try again.");
      // Clear busy before handing the photo over: the panel refuses to leave
      // while a capture is in flight, and this one has landed.
      busyRef.current = false;
      setBusy(false);
      onBusyChange(false);
      onCaptured(photo.uri);
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : "Could not take the photo. Try again.");
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
      onBusyChange(false);
    }
  }
  return (
    <>
      <Animated.View
        pointerEvents="none"
        style={{
          position: "absolute",
          inset: 0,
          opacity: ready ? 1 : 0,
          transitionProperty: "opacity",
          transitionDuration: reduceMotion ? 0 : PREVIEW_FADE,
          transitionTimingFunction: PREVIEW_EASING,
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
      </Animated.View>
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
          onPress={onCancel}
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
    </>
  );
}
