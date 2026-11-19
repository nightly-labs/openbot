import { Stack } from "expo-router/stack";
import { useCSSVariable } from "uniwind";
import { sheetStackOptions } from "@/shared/components/sheet-page-stack";
import { useText } from "@/shared/lib/text";

export default function SubagentLayout() {
  const { t } = useText();
  const background = String(useCSSVariable("--openbot-bg-sheet"));
  return (
    <Stack screenOptions={sheetStackOptions(background)}>
      <Stack.Screen name="index" options={{ title: t("mobile.app.route.subagents") }} />
      <Stack.Screen name="detail" options={{ title: t("mobile.app.route.subagent") }} />
    </Stack>
  );
}
