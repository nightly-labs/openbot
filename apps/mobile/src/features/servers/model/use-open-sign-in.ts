import { router, useFocusEffect } from "expo-router";
import { useCallback, useRef } from "react";

export interface SignInTarget {
  serverId: string;
  provider: string;
  method: "code" | "relay" | "account-code";
  account?: string;
  add?: "1";
}

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
