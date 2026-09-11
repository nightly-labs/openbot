import { mobileAnalytics } from "@/features/analytics/mobile-analytics";
import { redeemMobileConnectUrl } from "@/features/auth/api/mobile-auth";
import { QrScanner } from "@/features/auth/components/qr-scanner";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";

export function ScanQrCodeScreen() {
  const { connect: finishSignIn } = useMobileSession();
  return (
    <QrScanner
      onScan={async (data) =>
        finishSignIn(
          await mobileAnalytics.operation("mobile_pairing_action", { action: "redeem" }, () =>
            redeemMobileConnectUrl(data),
          ),
        )
      }
    />
  );
}
