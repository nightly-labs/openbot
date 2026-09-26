import { Redirect, router, Stack, useLocalSearchParams } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import { openBrowserAsync } from "expo-web-browser";
import { Button, Typography } from "heroui-native";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { redeemMobileConnectUrl } from "@/features/auth/api/mobile-auth";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { SignInScreen } from "@/features/auth/screens/sign-in-screen";
import { useText } from "@/shared/lib/text";
import { forgetIncomingLink, pendingInvitationId, readIncomingLink } from "../model/incoming-links";

export function IncomingLinkScreen() {
  const { request } = useLocalSearchParams<{ request?: string }>();
  return <IncomingLinkContent key={request ?? "invalid"} request={request} />;
}

function IncomingLinkContent({ request }: { request?: string }) {
  const { t, errorMessage } = useText();
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
    locked.current = true;
    setBusy(true);
    setError(null);
    try {
      const next = await redeemMobileConnectUrl(link.url);
      connect(next);
      forgetIncomingLink(request);
      if (mounted.current) setPaired(true);
    } catch (cause) {
      if (mounted.current) setError(errorMessage(cause, t("mobile.link.connectFailed")));
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  if (link.kind === "invite") {
    if (session) return <Redirect href={{ pathname: "/add-server", params: { request } }} />;
    return (
      <View className="flex-1 bg-background">
        <View className="gap-2 px-5 pt-safe-offset-4">
          <Typography.Paragraph align="center">{t("mobile.link.invite.signIn")}</Typography.Paragraph>
          <Button variant="ghost" onPress={close}>
            <Button.Label>{t("mobile.link.invite.cancel")}</Button.Label>
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
          ? t("mobile.link.pairing.title")
          : link.kind === "plugin"
            ? t("mobile.link.plugin.title")
            : t("mobile.link.unavailable.title")}
      </Typography.Heading>
      <Typography.Paragraph>
        {link.kind === "pairing"
          ? session
            ? t("mobile.link.pairing.alreadySignedIn")
            : t("mobile.link.pairing.description")
          : link.kind === "plugin"
            ? t("mobile.link.plugin.description")
            : t("mobile.link.unavailable.description")}
      </Typography.Paragraph>
      {error ? <Typography.Paragraph className="text-danger-text">{error}</Typography.Paragraph> : null}
      {link.kind === "pairing" && !session ? (
        <Button isDisabled={busy} onPress={() => void pair()}>
          <Button.Label>{busy ? t("common.connecting") : t("mobile.link.pairing.connect")}</Button.Label>
        </Button>
      ) : null}
      {link.kind === "plugin" ? (
        <Button
          onPress={() => void openBrowserAsync(link.url).catch(() => setError(t("mobile.link.plugin.openFailed")))}
        >
          <Button.Label>{t("mobile.link.plugin.view")}</Button.Label>
        </Button>
      ) : null}
      <Button variant="ghost" isDisabled={busy} onPress={close}>
        <Button.Label>{t("common.close")}</Button.Label>
      </Button>
    </View>
  );
}
