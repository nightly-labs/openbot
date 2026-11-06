import { Redirect, router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { SignInScreen } from "@/features/auth/screens/sign-in-screen";
import { Share } from "@/shared/icons";
import { useText } from "@/shared/lib/text";
import { discardWaitingShare, hasIncomingShare } from "../model/incoming-share";
import { openShareSheet } from "../model/share-sheet-opener";

/**
 * The route that a share from another app opens, at launch or while the app runs. It is outside the
 * sign-in guard, so a share waits through sign-in. Then the share sheet opens over the chat list.
 */
export function IncomingShareScreen() {
  const { t } = useText();
  const { session } = useMobileSession();
  // An Android activity that the system starts again gets the same link, and no share.
  const [waiting] = useState(hasIncomingShare);
  const opened = useRef(false);
  const signedIn = Boolean(session);
  useEffect(() => {
    if (!signedIn || opened.current) return;
    opened.current = true;
    // Return to the running workspace, then open the sheet in its stack. A replace from this root
    // screen would mount a second workspace, which opens a second connection to each host. With no
    // workspace under this screen, `dismissTo` replaces this screen with one, and the sheet opens
    // after that workspace mounts.
    router.dismissTo("/connected");
    if (waiting) openShareSheet();
  }, [signedIn, waiting]);

  if (session) return null;
  if (!waiting) return <Redirect href="/" />;
  return (
    <SignInScreen
      notice={{
        icon: Share,
        title: t("mobile.share.signInTitle"),
        description: t("mobile.share.signInDescription"),
        cancelLabel: t("common.cancel"),
        onCancel: () => {
          discardWaitingShare();
          router.replace("/");
        },
      }}
    />
  );
}
