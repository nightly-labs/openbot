import { router, useFocusEffect } from "expo-router";
import { useCallback, useRef } from "react";

/** What the sign-in page signs in: `account` signs in that account again, and `add: "1"` adds one. */
export interface SignInTarget {
  serverId: string;
  provider: string;
  method: "code" | "relay";
  account?: string;
  add?: "1";
}

/**
 * Opens the sign-in page of a provider, which starts its sign-in on the host. A second tap before
 * the page shows would start a second sign-in, so the page opens once until this page shows again.
 */
export function useOpenSignIn(): (target: SignInTarget) => void {
  const opening = useRef(false);
  useFocusEffect(
    useCallback(() => {
      opening.current = false;
    }, []),
  );
  return useCallback((target: SignInTarget) => {
    if (opening.current) return;
    opening.current = true;
    router.push({ pathname: "/server-settings/provider-sign-in", params: { ...target } });
  }, []);
}
