import type { EventSource } from "@openbot/contracts/ipc-events";
import { useQueryClient } from "@tanstack/react-query";
import { Typography } from "heroui-native";
import { useRef, useState } from "react";
import { Alert, View } from "react-native";
import { SettingsRow } from "@/features/settings/components/settings-content";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { useText } from "@/shared/lib/text";

export function RoutineWebhookSource({
  serverId,
  source,
  name,
  onChange,
}: {
  serverId: string;
  source: EventSource | undefined;
  name: string;
  onChange: (id: string) => void;
}) {
  const workspace = useMobileWorkspace();
  const { t, errorMessage } = useText();
  const queryClient = useQueryClient();
  const lock = useRef(false);
  const [pending, setPending] = useState(false);
  const [draft, setDraft] = useState<{ id?: string; name: string; secret: string; active: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function save(remove = false) {
    if (lock.current || (!remove && !draft)) return;
    lock.current = true;
    setPending(true);
    setError(null);
    try {
      if (remove && source) {
        await workspace.deleteEventSource(source.id, serverId);
        onChange("");
      } else if (draft) {
        const saved = await workspace.saveEventSource(
          {
            ...(draft.id ? { id: draft.id } : {}),
            name: draft.name.trim(),
            active: draft.active,
            ...(draft.secret ? { secret: draft.secret } : {}),
          },
          serverId,
        );
        onChange(saved.id);
      }
      setDraft(null);
      await queryClient.invalidateQueries({ queryKey: ["event-sources", serverId] });
    } catch (cause) {
      setError(errorMessage(cause, t("mobile.server.events.saveFailed")));
    } finally {
      lock.current = false;
      setPending(false);
    }
  }
  return (
    <>
      {source?.url ? (
        <View className="p-4">
          <Typography type="body-sm" selectable>
            {source.url}
          </Typography>
        </View>
      ) : null}
      <SettingsRow
        disabled={pending}
        disclosure={false}
        onPress={() =>
          setDraft(
            source
              ? { id: source.id, name: source.name, active: source.active, secret: "" }
              : { name, active: true, secret: "" },
          )
        }
      >
        <Typography.Paragraph className="text-accent">
          {t(source ? "mobile.agent.record.webhookDetails" : "mobile.agent.record.createWebhook")}
        </Typography.Paragraph>
      </SettingsRow>
      {source ? (
        <SettingsRow disabled={pending} disclosure={false} onPress={() => setDraft({ name, active: true, secret: "" })}>
          <Typography.Paragraph className="text-accent">{t("mobile.agent.record.createWebhook")}</Typography.Paragraph>
        </SettingsRow>
      ) : null}
      {draft ? (
        <View className="gap-3 p-4">
          <SheetFormField
            appearance="soft"
            label={t("mobile.server.events.sourceName")}
            value={draft.name}
            editable={!pending}
            onChangeText={(name) => setDraft({ ...draft, name })}
          />
          <SheetFormField
            appearance="soft"
            label={t("mobile.server.events.secret")}
            hint={t("mobile.server.events.secretHint")}
            value={draft.secret}
            secureTextEntry
            editable={!pending}
            onChangeText={(secret) => setDraft({ ...draft, secret })}
          />
          {draft.id ? (
            <SettingsRow
              disabled={pending}
              disclosure={false}
              onPress={() => setDraft({ ...draft, active: !draft.active })}
            >
              <Typography.Paragraph>
                {t(draft.active ? "mobile.server.events.enabled" : "mobile.server.events.disabled")}
              </Typography.Paragraph>
            </SettingsRow>
          ) : null}
          <SettingsRow
            disclosure={false}
            disabled={pending || !draft.name.trim() || (draft.secret ? draft.secret.trim().length < 32 : !draft.id)}
            onPress={() => void save()}
          >
            <Typography.Paragraph className="text-accent">{t("mobile.agent.record.saveWebhook")}</Typography.Paragraph>
          </SettingsRow>
          <SettingsRow disclosure={false} disabled={pending} onPress={() => setDraft(null)}>
            <Typography.Paragraph>{t("common.cancel")}</Typography.Paragraph>
          </SettingsRow>
          {draft.id ? (
            <SettingsRow
              disclosure={false}
              disabled={pending}
              onPress={() =>
                Alert.alert(t("mobile.server.events.deleteTitle"), t("mobile.server.events.deleteBody"), [
                  { text: t("common.cancel"), style: "cancel" },
                  { text: t("mobile.server.events.delete"), style: "destructive", onPress: () => void save(true) },
                ])
              }
            >
              <Typography.Paragraph className="text-danger-text">
                {t("mobile.server.events.delete")}
              </Typography.Paragraph>
            </SettingsRow>
          ) : null}
        </View>
      ) : null}
      {error ? (
        <Typography.Paragraph accessibilityRole="alert" className="px-4 text-danger-text">
          {error}
        </Typography.Paragraph>
      ) : null}
    </>
  );
}
