import { Host, Switch } from "@expo/ui";
import type {
  EventActivity,
  EventActivityKind,
  EventActivityStatus,
  SaveWebhookDestinationInput,
  WebhookDestination,
  WebhookMethod,
} from "@openbot/contracts/ipc-events";
import { isEventJsonValue } from "@openbot/contracts/ipc-events";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Typography } from "heroui-native";
import { useRef, useState } from "react";
import { Alert, View } from "react-native";
import { useUniwind } from "uniwind";
import { SettingsNote, SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { SettingsPicker } from "@/features/settings/components/settings-controls";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

type DestinationDraft = {
  id?: string;
  name: string;
  active: boolean;
  url: string;
  method: WebhookMethod;
  eventTypes: string;
  routineIds: string;
  payloadTemplate: string;
  headers: string;
  secret: string;
};

const newDestination = (): DestinationDraft => ({
  name: "",
  active: true,
  url: "",
  method: "POST",
  eventTypes: "routine.run.succeeded",
  routineIds: "",
  payloadTemplate: "",
  headers: "",
  secret: "",
});

function parsePayload(value: string) {
  if (!value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    return isEventJsonValue(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function parseHeaders(value: string): Record<string, string> | undefined {
  if (!value.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  const headers: Record<string, string> = {};
  for (const [name, headerValue] of Object.entries(parsed)) {
    if (!name.trim() || typeof headerValue !== "string" || !headerValue.trim()) return undefined;
    headers[name] = headerValue;
  }
  return headers;
}

const ACTIVITY_KIND_KEYS = {
  received: "mobile.server.events.activity.received",
  "routine-run": "mobile.server.events.activity.routineRun",
  delivery: "mobile.server.events.activity.delivery",
} as const satisfies Record<
  EventActivityKind,
  | "mobile.server.events.activity.received"
  | "mobile.server.events.activity.routineRun"
  | "mobile.server.events.activity.delivery"
>;

const ACTIVITY_STATUS_KEYS = {
  accepted: "mobile.server.events.status.accepted",
  duplicate: "mobile.server.events.status.duplicate",
  queued: "mobile.server.events.status.queued",
  running: "mobile.server.events.status.running",
  succeeded: "mobile.server.events.status.succeeded",
  failed: "mobile.server.events.status.failed",
  "needs-attention": "mobile.server.events.status.needsAttention",
} as const satisfies Record<
  EventActivityStatus | "needs-attention",
  | "mobile.server.events.status.accepted"
  | "mobile.server.events.status.duplicate"
  | "mobile.server.events.status.queued"
  | "mobile.server.events.status.running"
  | "mobile.server.events.status.succeeded"
  | "mobile.server.events.status.failed"
  | "mobile.server.events.status.needsAttention"
>;

export function RoutineWebhookNotifications({
  serverId,
  routineId,
  sourceId,
}: {
  serverId: string;
  routineId: string;
  sourceId: string;
}) {
  const { t, errorMessage } = useText();
  const { theme } = useUniwind();
  const workspace = useMobileWorkspace();
  const server = workspace.servers.find((candidate) => candidate.id === serverId);
  const admin = server?.role === "owner" || server?.role === "admin";
  const available = server?.state === "online";
  const supported = admin && available && workspace.canManageEvents(serverId);
  const queryClient = useQueryClient();
  const lock = useRef(false);
  const [pending, setPending] = useState(false);
  const [destinationDraft, setDestinationDraft] = useState<DestinationDraft | null>(null);
  const [activityFilter, setActivityFilter] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const destinations = useQuery({
    queryKey: ["event-destinations", serverId],
    enabled: supported,
    retry: false,
    queryFn: () => workspace.listWebhookDestinations(serverId),
  });
  const activity = useQuery({
    queryKey: ["event-activity", serverId],
    enabled: supported,
    retry: false,
    queryFn: () => workspace.listEventActivity({ limit: 100 }, serverId),
  });
  const destinationRows = (destinations.data ?? []).filter(
    (item) => item.routineIds.length === 0 || item.routineIds.includes(routineId),
  );
  const activityRows = (activity.data ?? []).filter(
    (item) => item.routineId === routineId || (item.kind === "received" && item.sourceId === sourceId),
  );

  async function save(operation: () => Promise<void>): Promise<void> {
    if (lock.current) return;
    lock.current = true;
    setPending(true);
    setError(null);
    try {
      await operation();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["event-sources", serverId] }),
        queryClient.invalidateQueries({ queryKey: ["event-destinations", serverId] }),
        queryClient.invalidateQueries({ queryKey: ["event-activity", serverId] }),
        queryClient.invalidateQueries({ queryKey: ["event-status", serverId] }),
      ]);
      void haptics.notification("success");
      setDestinationDraft(null);
    } catch (cause) {
      setError(errorMessage(cause, t("mobile.server.events.saveFailed")));
      void haptics.notification("error");
    } finally {
      lock.current = false;
      setPending(false);
      void queryClient.invalidateQueries({ queryKey: ["event-sources", serverId] });
      void queryClient.invalidateQueries({ queryKey: ["event-destinations", serverId] });
      void queryClient.invalidateQueries({ queryKey: ["event-activity", serverId] });
      void queryClient.invalidateQueries({ queryKey: ["event-status", serverId] });
    }
  }

  function removeDestination(destination: WebhookDestination): void {
    Alert.alert(t("mobile.server.events.deleteDestinationTitle"), t("mobile.server.events.deleteDestinationBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("mobile.server.events.delete"),
        style: "destructive",
        onPress: () => void save(() => workspace.deleteWebhookDestination(destination.id, serverId)),
      },
    ]);
  }

  if (!server) {
    return (
      <View className="gap-4">
        <SettingsNote>{t("mobile.server.unavailable")}</SettingsNote>
      </View>
    );
  }
  if (!admin) {
    return (
      <View className="gap-4">
        <SettingsNote>{t("mobile.server.events.adminOnly")}</SettingsNote>
      </View>
    );
  }
  if (!available) {
    return (
      <View className="gap-4">
        <SettingsNote>{t("mobile.server.events.offline")}</SettingsNote>
      </View>
    );
  }
  if (!workspace.canManageEvents(serverId)) {
    return (
      <View className="gap-4">
        <SettingsNote>{t("mobile.server.events.unsupported")}</SettingsNote>
      </View>
    );
  }

  return (
    <View className="gap-4">
      {destinations.isError || activity.isError ? (
        <SettingsNote>{t("mobile.server.events.loadFailed")}</SettingsNote>
      ) : null}
      {destinationDraft ? (
        <DestinationForm
          draft={destinationDraft}
          locked={pending}
          theme={theme}
          onChange={setDestinationDraft}
          onSave={(input) =>
            void save(async () => {
              await workspace.saveWebhookDestination(input, serverId);
            })
          }
        />
      ) : null}
      <SettingsSection title={t("mobile.server.events.destinations")}>
        {destinationRows.map((destination) => (
          <SettingsRow
            key={destination.id}
            supportingText={`${destination.method} · ${destination.active ? t("mobile.server.events.enabled") : t("mobile.server.events.disabled")}`}
            onPress={() =>
              setDestinationDraft({
                id: destination.id,
                name: destination.name,
                active: destination.active,
                url: destination.url,
                method: destination.method,
                eventTypes: destination.eventTypes.join(", "),
                routineIds: destination.routineIds.join(", "),
                payloadTemplate: destination.payloadTemplate ? JSON.stringify(destination.payloadTemplate) : "",
                headers: "",
                secret: "",
              })
            }
          >
            <Typography.Paragraph>{destination.name}</Typography.Paragraph>
          </SettingsRow>
        ))}
        {!destinationRows.length ? <SettingsNote>{t("mobile.server.events.emptyDestinations")}</SettingsNote> : null}
        <SettingsRow
          disclosure={false}
          onPress={() => setDestinationDraft({ ...newDestination(), routineIds: routineId })}
        >
          <Typography.Paragraph className="text-accent">
            {t("mobile.server.events.addDestination")}
          </Typography.Paragraph>
        </SettingsRow>
        {destinationRows.map((destination) => (
          <SettingsRow
            key={`${destination.id}-delete`}
            disclosure={false}
            onPress={() => removeDestination(destination)}
          >
            <Typography.Paragraph className="text-danger-text">
              {t("mobile.server.events.delete")}: {destination.name}
            </Typography.Paragraph>
          </SettingsRow>
        ))}
      </SettingsSection>
      <SettingsSection title={t("mobile.server.events.activity")}>
        {activityFilter ? (
          <SettingsRow disclosure={false} onPress={() => setActivityFilter(null)}>
            <Typography.Paragraph>
              {t("mobile.server.events.clearFilter")} · {activityFilter}
            </Typography.Paragraph>
          </SettingsRow>
        ) : null}
        {activityRows
          .filter(
            (entry) =>
              !activityFilter ||
              [
                entry.eventId,
                entry.sourceId,
                entry.routineId,
                entry.runId,
                entry.destinationId,
                entry.deliveryId,
              ].includes(activityFilter),
          )
          .map((entry) => (
            <ActivityRow
              key={entry.id}
              entry={entry}
              onRetry={() => void save(() => workspace.retryEventDelivery(entry.deliveryId ?? entry.id, serverId))}
              onFilter={setActivityFilter}
            />
          ))}
        {!activityRows.length ? <SettingsNote>{t("mobile.server.events.emptyActivity")}</SettingsNote> : null}
      </SettingsSection>
      {error ? (
        <Typography.Paragraph accessibilityRole="alert" className="px-4 text-danger-text">
          {error}
        </Typography.Paragraph>
      ) : null}
    </View>
  );
}

function DestinationForm({
  draft,
  locked,
  theme,
  onChange,
  onSave,
}: {
  draft: DestinationDraft;
  locked: boolean;
  theme: string;
  onChange: (draft: DestinationDraft) => void;
  onSave: (input: SaveWebhookDestinationInput) => void;
}) {
  const { t } = useText();
  const [advanced, setAdvanced] = useState(false);
  const methodOptions = ["POST", "PUT", "PATCH"] as const;
  return (
    <SettingsSection title={draft.id ? t("mobile.server.events.save") : t("mobile.server.events.addDestination")}>
      <View className="gap-3 p-4">
        <SheetFormField
          appearance="soft"
          label={t("mobile.server.events.destinationName")}
          placeholder={t("mobile.server.events.destinationNamePlaceholder")}
          value={draft.name}
          editable={!locked}
          onChangeText={(name) => onChange({ ...draft, name })}
        />
        <SheetFormField
          appearance="soft"
          label={t("mobile.server.events.url")}
          value={draft.url}
          editable={!locked}
          onChangeText={(url) => onChange({ ...draft, url })}
          autoCapitalize="none"
          keyboardType="url"
        />
        <SettingsRow disclosure={false} onPress={() => setAdvanced((value) => !value)}>
          <Typography.Paragraph>{t("mobile.agent.record.deliveryOptions")}</Typography.Paragraph>
        </SettingsRow>
        {advanced ? (
          <>
            <SheetFormField
              appearance="soft"
              label={t("mobile.server.events.eventTypes")}
              placeholder={t("mobile.server.events.eventTypesPlaceholder")}
              value={draft.eventTypes}
              editable={!locked}
              onChangeText={(eventTypes) => onChange({ ...draft, eventTypes })}
              autoCapitalize="none"
            />
            <SheetFormField
              appearance="soft"
              label={t("mobile.server.events.payloadTemplate")}
              placeholder={t("mobile.server.events.payloadTemplatePlaceholder")}
              value={draft.payloadTemplate}
              editable={!locked}
              onChangeText={(payloadTemplate) => onChange({ ...draft, payloadTemplate })}
              autoCapitalize="none"
              multiline
            />
            <SheetFormField
              appearance="soft"
              label={t("mobile.server.events.headers")}
              hint={t("mobile.server.events.secretHint")}
              value={draft.headers}
              editable={!locked}
              onChangeText={(headers) => onChange({ ...draft, headers })}
              autoCapitalize="none"
              secureTextEntry
            />
            <SettingsRow
              trailing={
                <SettingsPicker
                  label={t("mobile.server.events.method")}
                  value={draft.method}
                  options={methodOptions.map((method) => ({ value: method, label: method }))}
                  enabled={!locked}
                  dark={theme === "dark"}
                  onChange={(method) => onChange({ ...draft, method })}
                />
              }
            >
              <Typography.Paragraph>{t("mobile.server.events.method")}</Typography.Paragraph>
            </SettingsRow>
          </>
        ) : null}
        <SheetFormField
          appearance="soft"
          label={t("mobile.server.events.secret")}
          hint={t("mobile.server.events.secretHint")}
          secureTextEntry
          value={draft.secret}
          editable={!locked}
          onChangeText={(secret) => onChange({ ...draft, secret })}
        />
        <SettingsRow
          trailing={
            <Host matchContents colorScheme={theme === "dark" ? "dark" : "light"}>
              <Switch
                label={t("mobile.server.events.enabled")}
                value={draft.active}
                disabled={locked}
                onValueChange={(active) => onChange({ ...draft, active })}
              />
            </Host>
          }
        >
          <Typography.Paragraph>{t("mobile.server.events.enabled")}</Typography.Paragraph>
        </SettingsRow>
      </View>
      <SettingsRow
        disclosure={false}
        disabled={
          locked ||
          !(
            draft.name.trim() &&
            draft.url.trim() &&
            draft.eventTypes.trim() &&
            parsePayload(draft.payloadTemplate) !== undefined &&
            parseHeaders(draft.headers) !== undefined &&
            (draft.id || draft.secret.trim().length >= 32)
          )
        }
        onPress={() =>
          onSave({
            ...(draft.id ? { id: draft.id } : {}),
            name: draft.name.trim(),
            active: draft.active,
            url: draft.url.trim(),
            method: draft.method,
            eventTypes: draft.eventTypes
              .split(",")
              .map((item) => item.trim())
              .filter(Boolean),
            routineIds: draft.routineIds
              .split(",")
              .map((item) => item.trim())
              .filter(Boolean),
            payloadTemplate: parsePayload(draft.payloadTemplate) ?? null,
            ...(draft.headers.trim() ? { headers: parseHeaders(draft.headers) } : {}),
            ...(draft.secret.trim() ? { secret: draft.secret.trim() } : {}),
          })
        }
      >
        <Typography.Paragraph className="text-accent">{t("mobile.agent.record.saveWebhook")}</Typography.Paragraph>
      </SettingsRow>
    </SettingsSection>
  );
}

function ActivityRow({
  entry,
  onRetry,
  onFilter,
}: {
  entry: EventActivity;
  onRetry: () => void;
  onFilter: (id: string) => void;
}) {
  const { t, format } = useText();
  const kind = t(ACTIVITY_KIND_KEYS[entry.kind]);
  const status = t(ACTIVITY_STATUS_KEYS[entry.status]);
  const related = [
    [t("mobile.server.events.relatedEvent"), entry.eventId],
    [t("mobile.server.events.relatedSource"), entry.sourceId],
    [t("mobile.server.events.relatedRoutine"), entry.routineId],
    [t("mobile.server.events.relatedRun"), entry.runId],
    [t("mobile.server.events.relatedDestination"), entry.destinationId],
    [t("mobile.server.events.relatedDelivery"), entry.deliveryId],
  ].filter((item): item is [string, string] => item[1] !== null);
  return (
    <View>
      <SettingsRow
        supportingText={`${kind} · ${status} · ${format.date(new Date(entry.occurredAt), { dateStyle: "medium", timeStyle: "short" })}`}
        disclosure={entry.kind === "delivery" && entry.status === "failed"}
        onPress={entry.kind === "delivery" && entry.status === "failed" ? onRetry : undefined}
      >
        <Typography.Paragraph numberOfLines={1}>{status}</Typography.Paragraph>
      </SettingsRow>
      {related.map(([label, id]) => (
        <SettingsRow key={`${label}-${id}`} disclosure={false} onPress={() => onFilter(id)}>
          <Typography.Paragraph type="body-xs" className="text-accent">
            {label}: {id}
          </Typography.Paragraph>
        </SettingsRow>
      ))}
    </View>
  );
}
