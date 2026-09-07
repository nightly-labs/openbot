import { router } from "expo-router";
import { Typography } from "heroui-native";
import { useState } from "react";
import { Alert } from "react-native";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";

import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";

export function ConnectionSettingsScreen() {
  const { servers, activeServer, selectServer, leaveServer, refreshServers } = useMobileWorkspace();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function perform(operation: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await operation();
    } catch {
      setError("Could not update connections. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <SettingsContent>
      <SettingsSection title="Servers">
        {servers.map((server) => (
          <SettingsRow
            disabled={busy}
            disclosure={false}
            key={server.id}
            onPress={() => selectServer(server.id)}
            supportingText={`${server.state}${server.id === activeServer.id ? " · Selected" : ""}`}
          >
            <Typography.Paragraph type="body-sm">{server.name}</Typography.Paragraph>
          </SettingsRow>
        ))}
        <SettingsRow disclosure={false} disabled={busy} onPress={() => void perform(refreshServers)}>
          <Typography.Paragraph type="body-sm">{busy ? "Refreshing…" : "Refresh connections"}</Typography.Paragraph>
        </SettingsRow>
        <SettingsRow disabled={busy} onPress={() => router.push("/settings/add-server")}>
          <Typography.Paragraph type="body-sm">Join a server</Typography.Paragraph>
        </SettingsRow>
        {error ? <SettingsNote>{error}</SettingsNote> : null}
      </SettingsSection>
      {servers
        .filter((server) => server.kind === "remote")
        .map((server) => (
          <SettingsSection key={server.id} title={server.name}>
            <SettingsRow
              disclosure={false}
              disabled={busy}
              onPress={() =>
                Alert.alert(`Leave ${server.name}?`, "You can rejoin with an invitation link.", [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Leave server",
                    style: "destructive",
                    onPress: () => void perform(() => leaveServer(server.id)),
                  },
                ])
              }
            >
              <Typography.Paragraph type="body-sm" className="text-danger">
                Leave server
              </Typography.Paragraph>
            </SettingsRow>
          </SettingsSection>
        ))}
    </SettingsContent>
  );
}
