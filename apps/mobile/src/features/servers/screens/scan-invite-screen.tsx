import { parseInviteUrl, selfHostedApiOrigin } from "@openbot/contracts/invite-links";
import { router, Stack } from "expo-router";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { View } from "react-native";

import { QrScanner } from "@/features/auth/components/qr-scanner";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { rememberIncomingLink } from "@/features/links/model/incoming-links";
import { StageBackButton } from "@/shared/components/bloub-stage/stage-back-button";
import { headerTitleFont } from "@/shared/lib/app-font";
import { useText } from "@/shared/lib/text";

export function ScanInviteScreen({
  joinPath = "/add-server",
  underHeader = false,
}: {
  joinPath?: "/add-server" | "/hosted-server/join";
  underHeader?: boolean;
}) {
  const { t } = useText();
  const [foreground] = useThemeColor(["foreground"]);
  const { session } = useMobileSession();
  return (
    <QrScanner
      embedded
      pairing={false}
      onScan={async (data) => {
        try {
          parseInviteUrl(data, { selfHostedApiOrigin: selfHostedApiOrigin(session?.apiUrl) });
        } catch {
          throw new Error(t("mobile.server.scan.notInvitation"));
        }
        const request = rememberIncomingLink({ kind: "invite", url: data });
        router.dismissTo({ pathname: joinPath, params: { request } });
      }}
      renderOverlay={(camera) =>
        underHeader ? (
          <Stack.Screen
            options={{
              headerTintColor: camera ? "white" : String(foreground),
              headerTitleStyle: { ...headerTitleFont, color: camera ? "white" : String(foreground) },
            }}
          />
        ) : (
          <View
            pointerEvents="box-none"
            className="absolute inset-x-0 top-0 flex-row items-center justify-between gap-3 px-5 py-3"
          >
            <Typography.Heading type="h4" className={camera ? "text-white" : undefined}>
              {t("mobile.server.scan.title")}
            </Typography.Heading>
            <StageBackButton
              icon="close"
              label={t("mobile.auth.closeScanner")}
              color={camera ? "#ffffff" : String(foreground)}
              onPress={() => router.back()}
            />
          </View>
        )
      }
    />
  );
}
