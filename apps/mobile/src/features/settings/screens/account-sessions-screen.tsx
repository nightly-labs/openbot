import type { MobileTextKey } from "@openbot/i18n/mobile";
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
import { useText } from "@/shared/lib/text";

const SESSION_KIND_KEYS = {
  desktop: "mobile.settings.sessions.kindDesktop",
  mobile: "mobile.settings.sessions.kindMobile",
} as const satisfies Record<MobileAccountSession["kind"], MobileTextKey>;

// The same fields as `toLocaleString()` without options.
const LAST_ACTIVE_FORMAT: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
};

export function AccountSessionsScreen() {
  const { t, format } = useText();
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
      <SettingsSection title={t("mobile.settings.sessions.title")}>
        <SettingsRow
          disclosure={false}
          disabled={revoke.isPending}
          onPress={() => {
            revoke.reset();
            void sessions.refetch();
          }}
        >
          <Typography.Paragraph type="body-sm">
            {sessions.isFetching ? t("mobile.settings.sessions.loading") : t("mobile.settings.sessions.refresh")}
          </Typography.Paragraph>
        </SettingsRow>
        {sessions.isError || revoke.isError ? (
          <SettingsNote>{t("mobile.settings.sessions.updateFailed")}</SettingsNote>
        ) : null}
        {!sessions.isPending && !sessions.isError && sessions.data?.length === 0 ? (
          <SettingsNote>{t("mobile.settings.sessions.empty")}</SettingsNote>
        ) : null}
        {sessions.data?.map((item) => (
          <SettingsRow
            disclosure={false}
            disabled={revoke.isPending}
            key={item.sessionId}
            supportingText={t(
              item.current
                ? "mobile.settings.sessions.rowCurrent"
                : item.kind === "mobile"
                  ? "mobile.settings.sessions.rowRevocable"
                  : "mobile.settings.sessions.row",
              {
                kind: t(SESSION_KIND_KEYS[item.kind]),
                date: format.date(new Date(item.lastActiveAt), LAST_ACTIVE_FORMAT),
              },
            )}
            onPress={
              item.current || item.kind === "desktop"
                ? undefined
                : () =>
                    Alert.alert(
                      t("mobile.settings.sessions.disconnectTitle", { name: item.name }),
                      t("mobile.settings.sessions.disconnectBody"),
                      [
                        { text: t("common.cancel"), style: "cancel" },
                        {
                          text: t("mobile.settings.sessions.disconnect"),
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
