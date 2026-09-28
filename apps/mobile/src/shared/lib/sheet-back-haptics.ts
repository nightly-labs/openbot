import { haptics } from "./haptics";

/**
 * Screen listeners for a stack nested in a sheet. The native back button and a back swipe start a
 * closing transition while the screen is still the top route. A push closes the screen below the new
 * top route, and router.back() removes the route before the transition, so neither fires here.
 */
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
