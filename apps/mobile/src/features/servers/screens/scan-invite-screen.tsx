import { parseInviteUrl } from "@openbot/contracts/invite-links";
import { router, Stack } from "expo-router";
import { Button } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { useState } from "react";
import { useCSSVariable } from "uniwind";
import { QrScanner } from "@/features/auth/components/qr-scanner";
import { isAndroid, isIOS } from "@/shared/lib/platform";
import { AddServerScreen } from "./add-server-screen";

export function ScanInviteScreen() {
  const [invite, setInvite] = useState<string | null>(null);
  const foreground = useThemeColor("foreground");
  const sheetBackground = String(useCSSVariable("--openbot-bg-sheet"));
  return (
    <>
      <Stack.Screen
        options={{
          headerTintColor: invite ? foreground : undefined,
          headerStyle: invite ? { backgroundColor: sheetBackground } : undefined,
          headerLeft: isAndroid
            ? () => (
                <Button variant="ghost" onPress={() => router.back()}>
                  <Button.Label>Cancel</Button.Label>
                </Button>
              )
            : undefined,
        }}
      />
      {isIOS ? (
        <Stack.Toolbar placement="left">
          <Stack.Toolbar.Button onPress={() => router.back()}>Cancel</Stack.Toolbar.Button>
        </Stack.Toolbar>
      ) : null}
      {invite ? (
        <AddServerScreen initialInvite={invite} onJoined={() => router.dismissTo("/connected")} />
      ) : (
        <QrScanner
          onScan={async (data) => {
            parseInviteUrl(data);
            setInvite(data);
          }}
        />
      )}
    </>
  );
}
