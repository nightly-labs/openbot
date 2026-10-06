import { parseInviteUrl, selfHostedApiOrigin } from "@openbot/contracts/invite-links";
import { router, Stack } from "expo-router";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { View } from "react-native";

import { QrScanner } from "@/features/auth/components/qr-scanner";
import { ScannerCloseButton } from "@/features/auth/components/scanner-close-button";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { rememberIncomingLink } from "@/features/links/model/incoming-links";
import { useText } from "@/shared/lib/text";

// An inner page of the add-server sheet, or of the plans sheet. The preview fills the whole sheet.
// The add-server sheet has no header, so the title and the close control ride over the camera. The
// plans sheet keeps its native header on this page too: a page without the header makes iOS hide the
// bar during the push, and the page under it jumps when its header inset changes.
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
        // The one-use token stays out of navigation params, as deep links do.
        const request = rememberIncomingLink({ kind: "invite", url: data });
        router.dismissTo({ pathname: joinPath, params: { request } });
      }}
      renderOverlay={(camera) =>
        underHeader ? (
          // White over the camera, as the overlay title; the theme color over the permission page.
          <Stack.Screen
            options={{
              headerTintColor: camera ? "white" : String(foreground),
              headerTitleStyle: { color: camera ? "white" : String(foreground) },
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
            <ScannerCloseButton disabled={false} onPress={() => router.back()} />
          </View>
        )
      }
    />
  );
}
