import { Stack } from "expo-router/stack";
import { useCSSVariable } from "uniwind";
import { isIOS } from "@/shared/lib/platform";

export const unstable_settings = { initialRouteName: "index" };

export default function SettingsLayout() {
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
      <Stack.Screen name="index" options={{ title: "Settings" }} />
      <Stack.Screen name="profile" options={{ title: "Profile" }} />
      <Stack.Screen name="general" options={{ title: "General" }} />
      <Stack.Screen name="sessions" options={{ title: "Account sessions" }} />
      <Stack.Screen name="about" options={{ title: "About" }} />
      <Stack.Screen name="hidden-chats" options={{ title: "Hidden chats" }} />
      <Stack.Screen name="add-server" options={{ title: "Join a server" }} />
    </Stack>
  );
}
