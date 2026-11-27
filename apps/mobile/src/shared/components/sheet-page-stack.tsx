import type { NativeStackNavigationOptions } from "expo-router/native-stack";
import { Stack } from "expo-router/stack";
import { useCSSVariable } from "uniwind";
import { androidBackOptions } from "@/shared/components/android-header-button";
import { headerFontOptions } from "@/shared/lib/app-font";
import { isIOS } from "@/shared/lib/platform";
import { sheetHeaderInsetOptions } from "@/shared/lib/sheet-header";

export function SheetPageStack({ title, opaqueHeader = false }: { title?: string; opaqueHeader?: boolean }) {
  const background = String(useCSSVariable("--openbot-bg-sheet"));
  const transparentHeader = isIOS && !opaqueHeader;
  return (
    <Stack
      screenOptions={{
        ...sheetHeaderInsetOptions,
        presentation: "card",
        ...headerFontOptions,
        headerShadowVisible: false,
        headerTitleAlign: isIOS ? "center" : "left",
        headerTransparent: transparentHeader,
        headerStyle: { backgroundColor: transparentHeader ? "transparent" : background },
        headerBlurEffect: "none",
        scrollEdgeEffects: { top: "hidden", bottom: "soft" },
        contentStyle: { backgroundColor: background },
      }}
    >
      <Stack.Screen name="index" options={title === undefined ? undefined : { title }} />
    </Stack>
  );
}

export function sheetStackOptions(background: string, { insets = true }: { insets?: boolean } = {}) {
  return (props: Parameters<typeof androidBackOptions>[0]): NativeStackNavigationOptions => ({
    ...androidBackOptions(props),
    ...(insets ? sheetHeaderInsetOptions : {}),
    presentation: "card",
    headerBackButtonDisplayMode: "minimal",
    ...headerFontOptions,
    headerShadowVisible: false,
    headerTransparent: isIOS,
    headerStyle: { backgroundColor: isIOS ? "transparent" : background },
    headerBlurEffect: "none",
    scrollEdgeEffects: { top: "hidden", bottom: "soft" },
    contentStyle: { backgroundColor: background },
  });
}
