import { parseInviteUrl } from "@openbot/contracts/invite-links";
import { router } from "expo-router";
import { Typography } from "heroui-native";
import { View } from "react-native";

import { QrScanner } from "@/features/auth/components/qr-scanner";
import { ScannerCloseButton } from "@/features/auth/components/scanner-close-button";
import { rememberIncomingLink } from "@/features/links/model/incoming-links";

// An inner page of the add-server sheet. The preview fills the whole sheet, so the title and the
// close control ride over the camera instead of a native header.
export function ScanInviteScreen() {
  return (
    <QrScanner
      embedded
      pairing={false}
      onScan={async (data) => {
        try {
          parseInviteUrl(data);
        } catch {
          throw new Error("This QR code is not an OpenBot invitation.");
        }
        // The one-use token stays out of navigation params, as deep links do.
        const request = rememberIncomingLink({ kind: "invite", url: data });
        router.dismissTo({ pathname: "/add-server", params: { request } });
      }}
      renderOverlay={(camera) => (
        <View
          pointerEvents="box-none"
          className="absolute inset-x-0 top-0 flex-row items-center justify-between gap-3 px-5 py-3"
        >
          <Typography.Heading type="h4" className={camera ? "text-white" : undefined}>
            Scan invitation
          </Typography.Heading>
          <ScannerCloseButton disabled={false} onPress={() => router.back()} />
        </View>
      )}
    />
  );
}
