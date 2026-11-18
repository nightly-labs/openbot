import { Stack } from "expo-router/stack";
import { useCSSVariable } from "uniwind";
import { headerFontOptions } from "@/shared/lib/app-font";
import { isIOS } from "@/shared/lib/platform";
import { sheetHeaderInsetOptions } from "@/shared/lib/sheet-header";

/**
 * The layout of a formSheet route that holds one page. Android shows the native header, with its title,
 * `AndroidHeaderButton` and `SheetSaveAction`, only on a page inside a stack, not on the formSheet
 * route itself. The page can set its own title with `Stack.Screen`. On iOS the header is transparent,
 * unless `opaqueHeader` is set for a page whose content starts below the header. On Android 12 and
 * later, a page with `SheetScrollView` draws its own header over a blur of its content.
 */
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
        // Between the left and right actions on iOS. Android keeps the Material title, next to the left action.
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
