import { Button, Spinner, Typography } from "heroui-native";
import Maximize from "lucide-react-native/icons/maximize";
import X from "lucide-react-native/icons/x";
import { useState } from "react";
import { View } from "react-native";
import Animated, { FadeInDown, FadeOut, ReduceMotion } from "react-native-reanimated";
import {
  markFullScreenCameraTipSeen,
  saveFullScreenCameraPreference,
  useFullScreenCameraPreference,
} from "@/features/settings/model/camera-mode";
import { haptics } from "@/shared/lib/haptics";
import { useReducedMotion } from "@/shared/lib/motion";
import { useText } from "@/shared/lib/text";

const TIP_INSET = 10;
const TIP_PADDING = 14;
const ENTERING = FadeInDown.springify().damping(22).stiffness(260).reduceMotion(ReduceMotion.System);
const EXITING = FadeOut.duration(160).reduceMotion(ReduceMotion.System);

export function FullScreenCameraTip({
  outerRadius,
  onUseFullScreen,
}: {
  outerRadius: number;
  onUseFullScreen: () => void;
}) {
  const { t } = useText();
  const reduceMotion = useReducedMotion();
  const visible = useFullScreenCameraPreference((state) => state.ready && !state.tipSeen && !state.fullScreen);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const radius = outerRadius - TIP_INSET;

  async function switchToFullScreen() {
    if (pending) return;
    setPending(true);
    setFailed(false);
    const saved = await saveFullScreenCameraPreference(true).then(
      () => useFullScreenCameraPreference.getState().fullScreen,
      () => false,
    );
    setPending(false);
    if (!saved) {
      useFullScreenCameraPreference.setState({ fullScreen: false });
      void haptics.notification("error");
      setFailed(true);
      return;
    }
    void markFullScreenCameraTipSeen().catch(() => undefined);
    void haptics.notification("success");
    onUseFullScreen();
  }

  if (!visible) return null;
  return (
    <Animated.View
      entering={reduceMotion ? undefined : ENTERING}
      exiting={reduceMotion ? undefined : EXITING}
      className="absolute gap-3 bg-black/70"
      style={{
        top: TIP_INSET,
        left: TIP_INSET,
        right: TIP_INSET,
        padding: TIP_PADDING,
        borderRadius: radius,
        borderCurve: "continuous",
      }}
    >
      <View className="flex-row items-start gap-2">
        <View className="flex-1 gap-0.5">
          <Typography.Paragraph accessibilityRole="header" className="font-sans font-semibold text-white">
            {t("mobile.chat.camera.fullScreenTipTitle")}
          </Typography.Paragraph>
          <Typography.Paragraph accessibilityRole={failed ? "alert" : undefined} className="text-sm text-white/80">
            {failed ? t("mobile.settings.saveFailed") : t("mobile.chat.camera.fullScreenTipBody")}
          </Typography.Paragraph>
        </View>
        <Button
          isIconOnly
          size="sm"
          variant="ghost"
          className="size-8 rounded-full"
          accessibilityLabel={t("mobile.chat.camera.fullScreenTipDismiss")}
          isDisabled={pending}
          onPress={() => {
            void haptics.impact("soft");
            void markFullScreenCameraTipSeen().catch(() => undefined);
          }}
        >
          <X color="white" size={18} />
        </Button>
      </View>
      <Button
        size="sm"
        variant="secondary"
        className="self-start rounded-full bg-white"
        isDisabled={pending}
        onPress={() => void switchToFullScreen()}
      >
        {pending ? <Spinner size="sm" color="black" /> : <Maximize color="black" size={16} />}
        <Button.Label className="font-sans font-semibold text-black">
          {t("mobile.chat.camera.fullScreenTipUse")}
        </Button.Label>
      </Button>
    </Animated.View>
  );
}
