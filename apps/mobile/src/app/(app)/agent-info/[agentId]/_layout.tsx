import { Stack } from "expo-router/stack";
import { useCSSVariable } from "uniwind";
import { isIOS } from "@/shared/lib/platform";

export const unstable_settings = { initialRouteName: "index" };

export default function AgentInfoLayout() {
  const background = String(useCSSVariable("--openbot-bg-sheet"));
  return (
    <Stack
      screenOptions={{
        presentation: "card",
        headerBackButtonDisplayMode: "minimal",
        headerShadowVisible: false,
        headerTransparent: isIOS,
        headerStyle: { backgroundColor: isIOS ? "transparent" : background },
        headerBlurEffect: "none",
        scrollEdgeEffects: { top: "soft" },
        contentStyle: { backgroundColor: background },
      }}
    >
      <Stack.Screen name="index" options={{ title: "Info" }} />
      <Stack.Screen name="appearance" options={{ title: "Appearance" }} />
      <Stack.Screen name="usage" options={{ title: "Usage" }} />
      <Stack.Screen name="memories" options={{ title: "Memories" }} />
      <Stack.Screen name="routines" options={{ title: "Routines" }} />
      <Stack.Screen name="memory" options={{ title: "Memory" }} />
      <Stack.Screen name="routine" options={{ title: "Routine" }} />
      <Stack.Screen name="runtime" options={{ title: "Runtime" }} />
    </Stack>
  );
}
