import { userErrorMessage } from "@openbot/user-errors";
import { Redirect, router, Stack, useLocalSearchParams } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import { openBrowserAsync } from "expo-web-browser";
import { Button, Typography } from "heroui-native";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { redeemMobileConnectUrl } from "@/features/auth/api/mobile-auth";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { SignInScreen } from "@/features/auth/screens/sign-in-screen";
import {
  beginIncomingPairing,
  endIncomingPairing,
  forgetIncomingLink,
  pendingInvitationId,
  readIncomingLink,
} from "../model/incoming-links";

export function IncomingLinkScreen() {
  const { request } = useLocalSearchParams<{ request?: string }>();
  return <IncomingLinkContent key={request ?? "invalid"} request={request} />;
}

function IncomingLinkContent({ request }: { request?: string }) {
  const { session, connect } = useMobileSession();
  const [link] = useState(() => readIncomingLink(request));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [paired, setPaired] = useState(false);
  usePreventRemove(busy, () => {
    // Redemption saves a session. Keep this screen until that operation settles.
  });
  useEffect(() => {
    if (!paired || busy) return;
    const invitation = pendingInvitationId();
    router.replace(invitation ? { pathname: "/incoming-link", params: { request: invitation } } : "/connected");
  }, [paired, busy]);
  const locked = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  function close() {
    if (locked.current) return;
    forgetIncomingLink(request);
    router.replace(session ? "/connected" : "/");
  }

  async function pair() {
    if (link.kind !== "pairing" || session || locked.current) return;
    if (!beginIncomingPairing()) {
      setError("Another connection is in progress. Wait for it to finish.");
      return;
    }
    locked.current = true;
    setBusy(true);
    setError(null);
    try {
      const next = await redeemMobileConnectUrl(link.url);
      connect(next);
      forgetIncomingLink(request);
      if (mounted.current) setPaired(true);
    } catch (cause) {
      if (mounted.current) setError(userErrorMessage(cause, "OpenBot could not connect. Try again."));
    } finally {
      endIncomingPairing();
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  if (link.kind === "invite") {
    if (session) return <Redirect href={{ pathname: "/add-server", params: { request } }} />;
    return (
      <View className="flex-1 bg-background">
        <View className="gap-2 px-5 pt-safe-offset-4">
          <Typography.Paragraph align="center">
            Sign in with your desktop to review this invitation.
          </Typography.Paragraph>
          <Button variant="ghost" onPress={close}>
            <Button.Label>Cancel invitation</Button.Label>
          </Button>
        </View>
        <SignInScreen />
      </View>
    );
  }

  return (
    <View className="flex-1 justify-center gap-5 bg-background px-6 py-safe-offset-6">
      <Stack.Screen options={{ gestureEnabled: !busy, headerShown: false }} />
      <Typography.Heading type="h3">
        {link.kind === "pairing"
          ? "Connect this phone"
          : link.kind === "plugin"
            ? "Open plugin page"
            : "Link unavailable"}
      </Typography.Heading>
      <Typography.Paragraph>
        {link.kind === "pairing"
          ? session
            ? "You are already signed in. Sign out in Settings before connecting another account."
            : "Continue only if you requested this Mobile Connect link from your desktop."
          : link.kind === "plugin"
            ? "View this plugin on the OpenBot website."
            : "This link is invalid, is no longer available, or is not supported on mobile."}
      </Typography.Paragraph>
      {error ? <Typography.Paragraph className="text-danger-text">{error}</Typography.Paragraph> : null}
      {link.kind === "pairing" && !session ? (
        <Button isDisabled={busy} onPress={() => void pair()}>
          <Button.Label>{busy ? "Connecting…" : "Connect"}</Button.Label>
        </Button>
      ) : null}
      {link.kind === "plugin" ? (
        <Button
          onPress={() => void openBrowserAsync(link.url).catch(() => setError("Could not open the plugin page."))}
        >
          <Button.Label>View plugin</Button.Label>
        </Button>
      ) : null}
      <Button variant="ghost" isDisabled={busy} onPress={close}>
        <Button.Label>Close</Button.Label>
      </Button>
    </View>
  );
}
