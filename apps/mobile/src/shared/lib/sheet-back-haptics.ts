import { haptics } from "./haptics";

export function sheetBackHaptics({
  navigation,
  route,
}: {
  navigation: { getState(): { routes: readonly { key: string }[] } };
  route: { key: string };
}) {
  return {
    transitionStart: ({ data }: { data: { closing: boolean } }) => {
      const { routes } = navigation.getState();
      if (data.closing && routes.length > 1 && routes.at(-1)?.key === route.key) void haptics.impact("soft");
    },
  };
}
