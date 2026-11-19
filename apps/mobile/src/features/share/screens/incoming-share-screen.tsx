import { Redirect, router, useNavigation } from "expo-router";
import Share from "lucide-react-native/icons/share";
import { useEffect, useRef, useState } from "react";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { SignInScreen } from "@/features/auth/screens/sign-in-screen";
import { isAndroid } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";
import { discardWaitingShare, hasIncomingShare } from "../model/incoming-share";
import { holdShareSheet, openShareSheet, releaseShareSheet } from "../model/share-sheet-opener";

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
  const navigation = useNavigation();
  // Android: the sheet opens after this route goes, in the signed-in stack under it.
  useEffect(() => {
    if (!isAndroid) return;
    holdShareSheet();
    return releaseShareSheet;
  }, []);
  useEffect(() => {
    if (!signedIn || opened.current) return;
    opened.current = true;
    if (isAndroid) {
      // The signed-in stack also opens the sheet when it finds the share (`(app)/_layout.tsx`). So
      // only this route goes, by its own key: a dismiss to the chat list would also close a sheet
      // that is open already. With no workspace under this route, `dismissTo` replaces it with one.
      if (waiting) openShareSheet();
      if (navigation.canGoBack()) navigation.goBack();
      else router.dismissTo("/connected");
      return;
    }
    // Return to the running workspace, then open the sheet in its stack. A replace from this root
    // screen would mount a second workspace, which opens a second connection to each host. With no
    // workspace under this screen, `dismissTo` replaces this screen with one, and the sheet opens
    // after that workspace mounts.
    router.dismissTo("/connected");
    if (waiting) openShareSheet();
  }, [signedIn, waiting, navigation]);

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
