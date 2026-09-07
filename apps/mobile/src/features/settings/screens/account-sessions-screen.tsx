import { useMutation, useQuery } from "@tanstack/react-query";
import { useFocusEffect } from "expo-router";
import { Typography } from "heroui-native";
import { useCallback, useRef } from "react";
import { Alert } from "react-native";
import {
  listMobileAccountSessions,
  type MobileAccountSession,
  MobileSessionExpiredError,
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
  const { session, sessionScope, handleSessionError } = useMobileSession();
  const revoking = useRef(false);
  const sessions = useQuery({
    queryKey: ["account-sessions", session?.apiUrl, session?.user.id, sessionScope],
    enabled: Boolean(session),
    queryFn: async ({ signal }) => {
      if (!session) return [];
      try {
        return await listMobileAccountSessions(session, signal);
      } catch (error) {
        handleSessionError(error, session);
        throw error;
      }
    },
    retry: (count, error) => !(error instanceof MobileSessionExpiredError) && count < 2,
  });
  const revoke = useMutation({
    mutationFn: async (target: MobileAccountSession) => {
      if (!session) throw new MobileSessionExpiredError();
      try {
        await revokeMobileAccountSession(session, target);
      } catch (error) {
        handleSessionError(error, session);
        throw error;
      }
    },
    onSuccess: async () => {
      await sessions.refetch();
    },
    onSettled: () => {
      revoking.current = false;
    },
  });
  const { refetch } = sessions;
  useFocusEffect(
    useCallback(() => {
      void refetch({ cancelRefetch: false });
    }, [refetch]),
  );
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
        {!sessions.isPending && !sessions.isError && sessions.data?.length === 0 ? (
          <SettingsNote>No active account sessions.</SettingsNote>
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
                        {
                          text: "Disconnect",
                          style: "destructive",
                          onPress: () => {
                            if (revoking.current) return;
                            revoking.current = true;
                            revoke.mutate(item);
                          },
                        },
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
