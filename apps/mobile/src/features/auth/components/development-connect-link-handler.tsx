import { useEffect, useSyncExternalStore } from "react";

import { redeemMobileConnectUrl } from "@/features/auth/api/mobile-auth";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import {
  isSameMobileConnectTarget,
  peekMobileConnectLink,
  subscribeMobileConnectLink,
  takeMobileConnectLink,
} from "@/features/auth/model/development-connect-link";

export function DevelopmentConnectLinkHandler() {
  const { loading, session, connect, signOut } = useMobileSession();
  const link = useSyncExternalStore(subscribeMobileConnectLink, peekMobileConnectLink);

  useEffect(() => {
    if (loading || !link) return;
    const pending = takeMobileConnectLink();
    if (!pending) return;
    void (async () => {
      if (session && !isSameMobileConnectTarget(session, pending)) await signOut();
      connect(await redeemMobileConnectUrl(pending));
    })().catch((error: unknown) => {
      console.warn("Development Mobile Connect failed:", error instanceof Error ? error.message : error);
    });
  }, [connect, link, loading, session, signOut]);

  return null;
}
