import { router } from "expo-router";
import { useIsFocused } from "expo-router/react-navigation";
import { Typography } from "heroui-native";
import { View } from "react-native";
import Animated, { FadeIn, ReduceMotion } from "react-native-reanimated";

import { AppLogo } from "@/features/auth/components/app-logo";
import { PixelBlastBackground } from "@/features/auth/components/pixel-blast-background";
import { ScanQrButton } from "@/features/auth/components/scan-qr-button";

const SIGN_IN_ENTER = FadeIn.duration(220).reduceMotion(ReduceMotion.System);

export function SignInScreen() {
  const isFocused = useIsFocused();

  return (
    <Animated.ScrollView
      entering={SIGN_IN_ENTER}
      className="flex-1 bg-background"
      contentContainerClassName="min-h-full grow items-center justify-center px-8 pb-safe-offset-8 pt-safe-offset-8"
      contentInsetAdjustmentBehavior="never"
      bounces={false}
      showsVerticalScrollIndicator={false}
    >
      <PixelBlastBackground active={isFocused} />
      <View className="z-10 w-full max-w-72 items-center gap-8">
        <View className="items-center gap-5">
          <AppLogo size={56} animation={isFocused ? "blink" : "none"} interactive={isFocused} />
          <View className="items-center gap-3">
            <Typography.Heading type="h2" accessibilityRole="header" align="center" className="tracking-openbot-tight">
              OpenBot
            </Typography.Heading>
            <Typography.Paragraph color="muted" align="center">
              Scan the QR code on your computer to connect.
            </Typography.Paragraph>
          </View>
        </View>
        <View className="w-full max-w-60">
          <ScanQrButton onPress={() => router.push("/scan-qr-code")} />
        </View>
      </View>
    </Animated.ScrollView>
  );
}
