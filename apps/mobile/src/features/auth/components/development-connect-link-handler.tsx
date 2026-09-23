import { useEffect, useSyncExternalStore } from "react";

import { redeemMobileConnectUrl } from "@/features/auth/api/mobile-auth";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import {
  isSameMobileConnectTarget,
  peekMobileConnectLink,
  subscribeMobileConnectLink,
  takeMobileConnectLink,
} from "@/features/auth/model/development-connect-link";

// Redeems the Mobile Connect link that `bun run dev:mobile` opens in a simulator.
// Rendered in development builds only; see development-connect-link.ts.
export function DevelopmentConnectLinkHandler() {
  const { loading, session, connect, signOut } = useMobileSession();
  const link = useSyncExternalStore(subscribeMobileConnectLink, peekMobileConnectLink);

  useEffect(() => {
    if (loading || !link) return;
    // Take whatever is pending now: a newer link can replace the rendered one before this runs.
    const pending = takeMobileConnectLink();
    if (!pending) return;
    void (async () => {
      // The account service revokes an older session of this device on redeem,
      // but only its own. A session from another dev stack is revoked first.
      if (session && !isSameMobileConnectTarget(session, pending)) await signOut();
      connect(await redeemMobileConnectUrl(pending));
    })().catch((error: unknown) => {
      console.warn("Development Mobile Connect failed:", error instanceof Error ? error.message : error);
    });
  }, [connect, link, loading, session, signOut]);

  return null;
}
