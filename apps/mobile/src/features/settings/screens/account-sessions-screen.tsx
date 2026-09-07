import { useMutation, useQuery } from "@tanstack/react-query";
import { Typography } from "heroui-native";
import { Alert } from "react-native";
import {
  listMobileAccountSessions,
  type MobileAccountSession,
  revokeMobileAccountSession,
} from "@/features/auth/api/mobile-auth";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";

export function AccountSessionsScreen() {
  const { session } = useMobileSession();
  const sessions = useQuery({
    queryKey: ["account-sessions", session?.apiUrl, session?.user.id],
    enabled: Boolean(session),
    queryFn: () => (session ? listMobileAccountSessions(session) : Promise.resolve([])),
  });
  const revoke = useMutation({
    mutationFn: async (target: MobileAccountSession) => {
      if (session) await revokeMobileAccountSession(session, target);
    },
    onSuccess: async () => {
      await sessions.refetch();
    },
  });
  return (
    <SettingsContent>
      <SettingsSection title="Signed-in devices">
        <SettingsRow
          disclosure={false}
          disabled={revoke.isPending}
          onPress={() => {
            revoke.reset();
            void sessions.refetch();
          }}
        >
          <Typography.Paragraph type="body-sm">
            {sessions.isFetching ? "Loading sessions…" : "Refresh sessions"}
          </Typography.Paragraph>
        </SettingsRow>
        {sessions.isError || revoke.isError ? (
          <SettingsNote>Could not update account sessions. Refresh and try again.</SettingsNote>
        ) : null}
        {sessions.data?.map((item) => (
          <SettingsRow
            disclosure={false}
            disabled={revoke.isPending}
            key={item.sessionId}
            supportingText={`${item.kind} · Last active ${new Date(item.lastActiveAt).toLocaleString()}${item.current ? " · This device" : " · Tap to disconnect"}`}
            onPress={
              item.current
                ? undefined
                : () =>
                    Alert.alert(
                      `Disconnect ${item.name}?`,
                      "This also ends the account’s active remote connections. The device can sign in again.",
                      [
                        { text: "Cancel", style: "cancel" },
                        { text: "Disconnect", style: "destructive", onPress: () => revoke.mutate(item) },
                      ],
                    )
            }
          >
            <Typography.Paragraph type="body-sm">{item.name}</Typography.Paragraph>
          </SettingsRow>
        ))}
      </SettingsSection>
    </SettingsContent>
  );
}
