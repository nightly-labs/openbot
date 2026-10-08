import type { EventRoutineOwner, WebhookReceiptReason } from "@openbot/contracts/ipc-events";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import { useQuery } from "@tanstack/react-query";
import { Typography } from "heroui-native";
import { View } from "react-native";
import { SettingsNote, SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { useText } from "@/shared/lib/text";

const IGNORED_KEYS = {
  "event-type": "mobile.agent.webhook.activity.ignoredEventType",
  filter: "mobile.agent.webhook.activity.ignoredFilter",
  inactive: "mobile.agent.webhook.activity.ignoredInactive",
} as const satisfies Record<WebhookReceiptReason, MobileTextKey>;

/**
 * The webhook requests that one routine ignored. Mobile has no run history, so started runs are not
 * shown. Nothing shows while there is no ignored request.
 */
export function RoutineWebhookActivity({
  serverId,
  owner,
  routineId,
}: {
  serverId: string;
  owner: EventRoutineOwner;
  routineId: string;
}) {
  const { t, format } = useText();
  const workspace = useMobileWorkspace();
  const activity = useQuery({
    queryKey: ["routine-webhooks", serverId, owner.kind, owner.id, routineId, "activity"],
    retry: false,
    queryFn: () => workspace.listEventActivity({ owner, routineId, limit: 50 }, serverId),
  });

  const rows = (activity.data ?? []).filter((entry) => entry.status === "ignored");
  if (!rows.length && !activity.isError) return null;
  return (
    <View className="gap-2">
      {rows.length ? (
        <SettingsSection title={t("mobile.agent.webhook.activity")}>
          {rows.map((entry) => (
            <SettingsRow
              key={entry.id}
              supportingText={format.date(new Date(entry.occurredAt), { dateStyle: "medium", timeStyle: "short" })}
            >
              <Typography.Paragraph numberOfLines={1}>
                {t(entry.reason ? IGNORED_KEYS[entry.reason] : "mobile.agent.webhook.activity.ignored")}
              </Typography.Paragraph>
            </SettingsRow>
          ))}
        </SettingsSection>
      ) : null}
      {activity.isError ? <SettingsNote>{t("mobile.agent.webhook.activityFailed")}</SettingsNote> : null}
    </View>
  );
}
