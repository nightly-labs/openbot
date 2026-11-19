import { Redirect, router, useNavigation } from "expo-router";
import Share from "lucide-react-native/icons/share";
import { useEffect, useRef, useState } from "react";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { SignInScreen } from "@/features/auth/screens/sign-in-screen";
import { isAndroid } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";
import { discardWaitingShare, hasIncomingShare } from "../model/incoming-share";
import { holdShareSheet, openShareSheet, releaseShareSheet } from "../model/share-sheet-opener";

export function IncomingShareScreen() {
  const { t } = useText();
  const { session } = useMobileSession();
  const [waiting] = useState(hasIncomingShare);
  const opened = useRef(false);
  const signedIn = Boolean(session);
  const navigation = useNavigation();
  useEffect(() => {
    if (!isAndroid) return;
    holdShareSheet();
    return releaseShareSheet;
  }, []);
  useEffect(() => {
    if (!signedIn || opened.current) return;
    opened.current = true;
    if (isAndroid) {
      if (waiting) openShareSheet();
      if (navigation.canGoBack()) navigation.goBack();
      else router.dismissTo("/connected");
      return;
    }
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
