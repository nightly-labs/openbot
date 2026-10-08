import { Stack } from "expo-router/stack";
import { useCSSVariable } from "uniwind";
import { isIOS } from "@/shared/lib/platform";
import { sheetHeaderInsetOptions } from "@/shared/lib/sheet-header";

/**
 * The layout of a formSheet route that holds one page. Android shows the native header, with its title,
 * `AndroidHeaderButton` and `SheetSaveAction`, only on a page inside a stack, not on the formSheet
 * route itself. The page can set its own title with `Stack.Screen`. On iOS the header is transparent,
 * unless `opaqueHeader` is set for a page whose content starts below the header. `clearHeader` makes
 * it transparent on Android too; the page's `SheetScrollView` must set `clearHeader` as well, to keep
 * the content clear of it.
 */
export function SheetPageStack({
  title,
  opaqueHeader = false,
  clearHeader = false,
}: {
  title?: string;
  opaqueHeader?: boolean;
  clearHeader?: boolean;
}) {
  const background = String(useCSSVariable("--openbot-bg-sheet"));
  const transparentHeader = clearHeader || (isIOS && !opaqueHeader);
  return (
    <Stack
      screenOptions={{
        ...sheetHeaderInsetOptions,
        presentation: "card",
        headerShadowVisible: false,
        // Between the left and right actions, as on iOS. Android puts the title next to the left action.
        headerTitleAlign: "center",
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
