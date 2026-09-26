import { CameraView, type CameraViewProps, useCameraPermissions } from "expo-camera";
import { Stack } from "expo-router";
import { useIsFocused } from "expo-router/react-navigation";
import { StatusBar } from "expo-status-bar";
import { Alert, Button, Card, Spinner, Surface } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { Camera, ScanLine } from "lucide-react-native";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { AppState, Linking, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";

import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { mobileAnalytics } from "@/features/analytics/mobile-analytics";
import { isAndroid, isIOS } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";

type ScanState =
  | { status: "idle" }
  | { status: "connecting" }
  | { status: "error"; source: "camera" | "connection"; message: string };
const QR_SCANNER_SETTINGS: CameraViewProps["barcodeScannerSettings"] = { barcodeTypes: ["qr"] };

function ScannerStatus({
  pairing,
  scanState,
  onRetry,
}: {
  pairing: boolean;
  scanState: ScanState;
  onRetry: () => void;
}) {
  const { t } = useText();
  const [foreground, accent] = useThemeColor(["foreground", "accent"]);

  if (scanState.status === "error") {
    return (
      <Card variant="default" className="gap-4 rounded-3xl p-4">
        <Alert status="danger">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>
              {pairing ? t("mobile.auth.scanner.connectFailed") : t("mobile.auth.scanner.codeFailed")}
            </Alert.Title>
            <Alert.Description selectable>{scanState.message}</Alert.Description>
          </Alert.Content>
        </Alert>
        <Button size="md" variant="secondary" onPress={onRetry}>
          <Button.Label>{t("mobile.auth.scanner.scanAgain")}</Button.Label>
        </Button>
      </Card>
    );
  }

  return (
    <Card variant="default" className="rounded-3xl p-4">
      <Card.Body className="flex-row items-center gap-3">
        {scanState.status === "connecting" ? (
          <Surface variant="tertiary" className="size-11 items-center justify-center rounded-2xl p-0">
            <Spinner size="sm" color={accent} />
          </Surface>
        ) : (
          <Surface variant="tertiary" className="size-11 items-center justify-center rounded-2xl p-0">
            <ScanLine size={22} color={foreground} strokeWidth={1.75} />
          </Surface>
        )}
        <View className="min-w-0 flex-1 gap-0.5">
          <Card.Title className="font-sans text-body font-semibold">
            {scanState.status === "connecting"
              ? pairing
                ? t("mobile.auth.scanner.connecting")
                : t("mobile.auth.scanner.readingInvitation")
              : pairing
                ? t("mobile.auth.scanner.scanDesktop")
                : t("mobile.auth.scanner.scanInvitation")}
          </Card.Title>
          <Card.Description className="font-sans text-caption">
            {scanState.status === "connecting"
              ? pairing
                ? t("mobile.auth.scanner.verifying")
                : t("mobile.auth.scanner.checkingServer")
              : t("mobile.auth.scanner.keepCentered")}
          </Card.Description>
        </View>
      </Card.Body>
    </Card>
  );
}

// Mount with the session so readiness resets on close, focus loss and background.
function ScannerCamera({
  onBarcodeScanned,
  onCameraReady,
  onMountError,
}: Pick<CameraViewProps, "onBarcodeScanned" | "onCameraReady" | "onMountError">) {
  const opacity = useSharedValue(0);
  const previewStyle = useAnimatedStyle(() => ({ opacity: opacity.get() }));

  return (
    <Animated.View style={[StyleSheet.absoluteFill, previewStyle]}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={QR_SCANNER_SETTINGS}
        onBarcodeScanned={onBarcodeScanned}
        onMountError={onMountError}
        onCameraReady={() => {
          opacity.set(onCameraReady ? 1 : withTiming(1, { duration: 200, reduceMotion: ReduceMotion.System }));
          onCameraReady?.();
        }}
      />
    </Animated.View>
  );
}

export function QrScanner({
  onScan,
  pairing = true,
  embedded = false,
  scanEnabled = true,
  onPreviewReady,
  renderOverlay,
}: {
  onScan: (data: string) => Promise<void>;
  pairing?: boolean;
  embedded?: boolean;
  scanEnabled?: boolean;
  onPreviewReady?: () => void;
  renderOverlay?: (camera: boolean) => ReactNode;
}) {
  const { t, errorMessage } = useText();
  const scanLocked = useRef(false);
  const completed = useRef(false);
  const scanPending = useRef(false);
  useEffect(() => {
    if (!pairing) return;
    const scope = mobileAnalytics.scope();
    scope.track("mobile_pairing_action", { action: "scanner_opened", result: "succeeded" });
    return () => {
      if (!completed.current && !scanPending.current)
        scope.track("mobile_pairing_action", { action: "cancel", result: "cancelled" });
    };
  }, [pairing]);
  const [cameraAttempt, setCameraAttempt] = useState(0);
  const focused = useIsFocused();
  const [foreground, setForeground] = useState(AppState.currentState === "active");
  const [permission, requestPermission, getPermission] = useCameraPermissions();
  const [scanState, setScanState] = useState<ScanState>({ status: "idle" });
  const [foregroundColor, accentForeground] = useThemeColor(["foreground", "accent-foreground"]);
  const { width: windowWidth } = useWindowDimensions();
  const reducedMotion = useReducedMotion();
  const connecting = useSharedValue(0);
  const isConnecting = scanState.status === "connecting";
  useEffect(() => {
    connecting.set(
      withTiming(isConnecting ? 1 : 0, {
        duration: 220,
        easing: Easing.bezier(0.23, 1, 0.32, 1),
        reduceMotion: ReduceMotion.Never,
      }),
    );
  }, [connecting, isConnecting]);
  const frameStyle = useAnimatedStyle(() => ({
    opacity: 1 - connecting.get(),
    transform: [{ scale: reducedMotion ? 1 : 1 - connecting.get() * 0.04 }],
  }));
  const statusStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: reducedMotion ? 0 : -16 * connecting.get() }],
  }));
  const controlsStyle = useAnimatedStyle(() => ({
    opacity: 1 - connecting.get(),
    transform: [{ translateY: reducedMotion ? 0 : -8 * connecting.get() }],
  }));
  const scannerFrameSize = Math.min(windowWidth - 80, 280);
  useEffect(() => {
    // Permission controls must be visible before the camera can start.
    if (permission && !permission.granted) onPreviewReady?.();
  }, [onPreviewReady, permission]);
  useEffect(() => {
    let previousState = AppState.currentState;
    const subscription = AppState.addEventListener("change", (state) => {
      const returnedToForeground = state === "active" && previousState !== "active";
      previousState = state;
      setForeground(state === "active");
      if (returnedToForeground && !permission?.granted) void getPermission();
    });

    return () => subscription.remove();
  }, [getPermission, permission?.granted]);

  async function connect(data: string): Promise<void> {
    if (!scanEnabled || scanLocked.current) return;
    scanLocked.current = true;
    scanPending.current = true;
    setScanState({ status: "connecting" });
    try {
      await onScan(data);
      completed.current = true;
    } catch (error) {
      setScanState({
        status: "error",
        source: "connection",
        message: errorMessage(error, t("mobile.auth.scanner.connectFallback")),
      });
    } finally {
      scanPending.current = false;
    }
  }

  if (!permission) {
    return (
      <>
        {!embedded ? <Stack.Screen options={{ headerTintColor: foregroundColor }} /> : null}
        <View className="flex-1 items-center justify-center bg-background">{renderOverlay?.(false)}</View>
      </>
    );
  }

  if (!permission.granted) {
    const canRequestPermission = permission.canAskAgain;

    return (
      <>
        {!embedded ? <Stack.Screen options={{ headerTintColor: foregroundColor }} /> : null}
        <ScrollView
          className="flex-1 bg-background"
          contentContainerClassName={
            embedded ? "min-h-full grow px-4 pb-4 pt-20" : "min-h-full grow px-5 pb-safe-offset-8 pt-8"
          }
          contentInsetAdjustmentBehavior={embedded ? "never" : "automatic"}
        >
          <View className="mx-auto w-full max-w-md flex-1 justify-center">
            <Card variant="secondary" className="gap-6 rounded-3xl p-5">
              <Card.Header>
                <Surface variant="tertiary" className="size-14 items-center justify-center rounded-2xl p-0">
                  <Camera size={27} color={foregroundColor} strokeWidth={1.75} />
                </Surface>
              </Card.Header>

              <Card.Body className="gap-2">
                <Card.Title accessibilityRole="header" className="font-sans text-title font-semibold">
                  {t("mobile.auth.camera.title")}
                </Card.Title>
                <Card.Description className="font-sans text-body leading-6 text-text-secondary">
                  {canRequestPermission
                    ? pairing
                      ? t("mobile.auth.camera.pairingReason")
                      : t("mobile.auth.camera.invitationReason")
                    : t("mobile.auth.camera.blocked")}
                </Card.Description>
              </Card.Body>

              <Card.Footer>
                <Button
                  size="lg"
                  className="w-full"
                  onPress={
                    canRequestPermission
                      ? async () => {
                          const scope = mobileAnalytics.scope();
                          try {
                            const response = await requestPermission();
                            if (pairing)
                              scope.track("mobile_pairing_action", {
                                action: "camera_permission",
                                result: response.granted ? "succeeded" : "failed",
                                ...(response.granted ? {} : { failure_code: "permission_denied" }),
                              });
                          } catch {
                            if (pairing)
                              scope.track("mobile_pairing_action", {
                                action: "camera_permission",
                                result: "failed",
                                failure_code: "permission_denied",
                              });
                          }
                        }
                      : () => void Linking.openSettings()
                  }
                >
                  <Camera size={19} color={accentForeground} strokeWidth={2} />
                  <Button.Label className="font-sans font-semibold">
                    {canRequestPermission ? t("mobile.auth.camera.allow") : t("mobile.auth.camera.openSettings")}
                  </Button.Label>
                </Button>
              </Card.Footer>
            </Card>
          </View>
        </ScrollView>
        {renderOverlay?.(false)}
      </>
    );
  }

  return (
    <>
      {!embedded ? (
        <Stack.Screen
          options={{
            headerTransparent: isIOS,
            headerStyle: isAndroid ? { backgroundColor: "#000000" } : undefined,
            headerTintColor: "#ffffff",
          }}
        />
      ) : null}
      {!embedded ? <StatusBar style="light" /> : null}
      <View className={embedded ? "flex-1 bg-sheet" : "flex-1 bg-black"}>
        {focused && foreground ? (
          <ScannerCamera
            key={cameraAttempt}
            onCameraReady={onPreviewReady}
            onMountError={() => {
              setScanState({ status: "error", source: "camera", message: t("mobile.auth.scanner.cameraFailed") });
              onPreviewReady?.();
            }}
            // Expo enables native scanning from the presence of this callback.
            // Keep it enabled from startup; connect guards opening and pending scans.
            onBarcodeScanned={({ data }) => void connect(data)}
          />
        ) : null}

        <Animated.View
          pointerEvents="none"
          style={frameStyle}
          className="absolute inset-0 items-center justify-center px-10 pb-24"
        >
          <View
            className="rounded-[28px] border-2 border-white"
            style={{ borderCurve: "continuous", height: scannerFrameSize, width: scannerFrameSize }}
          />
        </Animated.View>

        <Animated.View
          style={statusStyle}
          className={embedded ? "absolute inset-x-4 bottom-4" : "absolute inset-x-5 bottom-safe-offset-5"}
        >
          <ScannerStatus
            pairing={pairing}
            scanState={scanState}
            onRetry={() => {
              if (scanState.status === "error" && scanState.source === "camera") {
                setCameraAttempt((attempt) => attempt + 1);
              }
              scanLocked.current = false;
              setScanState({ status: "idle" });
            }}
          />
        </Animated.View>
        <Animated.View
          pointerEvents={isConnecting ? "none" : "box-none"}
          accessibilityElementsHidden={isConnecting}
          importantForAccessibility={isConnecting ? "no-hide-descendants" : "auto"}
          style={[StyleSheet.absoluteFill, controlsStyle]}
        >
          {renderOverlay?.(true)}
        </Animated.View>
      </View>
    </>
  );
}
