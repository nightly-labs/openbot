import { Stack } from "expo-router/stack";
import { useCSSVariable } from "uniwind";

export const unstable_settings = { initialRouteName: "index" };

// One sheet owns the whole flow. The scanner is an inner page, so opening it never dismisses the
// sheet or puts a second modal over it. Both pages draw their own title, so the header stays off.
export default function AddServerLayout() {
  const background = String(useCSSVariable("--openbot-bg-sheet"));
  return (
    <Stack
      screenOptions={{
        presentation: "card",
        headerShown: false,
        scrollEdgeEffects: { top: "hidden", bottom: "soft" },
        contentStyle: { backgroundColor: background },
      }}
    />
  );
}
