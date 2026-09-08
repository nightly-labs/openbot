import { router, useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import { useRef, useState } from "react";
import { Alert } from "react-native";
import { ServerStatusLabel } from "@/features/servers/components/server-status-label";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";

export function ServerSettingsScreen() {
  const { serverId } = useLocalSearchParams<{ serverId: string }>();
  const { servers, leaveServer, refreshServer } = useMobileWorkspace();
  const server = servers.find((item) => item.id === serverId);
  const locked = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function perform(operation: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError(null);
    try {
      await operation();
    } catch {
      setError("Could not update this server. Try again.");
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  if (!server)
    return (
      <SettingsContent>
        <SettingsNote>This server is no longer available.</SettingsNote>
      </SettingsContent>
    );
  return (
    <SettingsContent>
      <SettingsSection title={server.name}>
        <SettingsRow disclosure={false} supportingText={`Your role: ${server.role}`}>
          <ServerStatusLabel server={server} />
        </SettingsRow>
        {server.connectionMessage ? <SettingsNote>{server.connectionMessage}</SettingsNote> : null}
        <SettingsRow onPress={() => router.push({ pathname: "/server-settings/members", params: { serverId } })}>
          <Typography.Paragraph type="body-sm">Members</Typography.Paragraph>
        </SettingsRow>
        <SettingsRow disclosure={false} disabled={busy} onPress={() => void perform(() => refreshServer(serverId))}>
          <Typography.Paragraph type="body-sm">{busy ? "Refreshing…" : "Refresh connection"}</Typography.Paragraph>
        </SettingsRow>
        {server.role !== "owner" ? (
          <SettingsRow
            disclosure={false}
            disabled={busy}
            onPress={() =>
              Alert.alert(`Leave ${server.name}?`, "You will need another invitation to join again.", [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Leave server",
                  style: "destructive",
                  onPress: () =>
                    void perform(async () => {
                      await leaveServer(serverId);
                      router.dismiss();
                    }),
                },
              ])
            }
          >
            <Typography.Paragraph type="body-sm" className="text-danger">
              Leave server
            </Typography.Paragraph>
          </SettingsRow>
        ) : null}
        {error ? <SettingsNote>{error}</SettingsNote> : null}
      </SettingsSection>
    </SettingsContent>
  );
}
