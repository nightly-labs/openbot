import { Host, Switch } from "@expo/ui";
import {
  type EventActivity,
  type EventJsonValue,
  type EventRoutineOwner,
  isEventJsonValue,
  ROUTINE_RUN_EVENT_TYPES,
  type RoutineRunEventType,
  type SaveWebhookDestinationInput,
  type WebhookDestination,
  type WebhookMethod,
  type WebhookReceiptReason,
} from "@openbot/contracts/ipc-events";
import type { MobileTextKey } from "@openbot/i18n/mobile";
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

const METHODS: readonly WebhookMethod[] = ["POST", "PUT", "PATCH"];
const MIN_SECRET_LENGTH = 32;

const EVENT_KEYS = {
  "routine.run.started": "mobile.agent.webhook.event.started",
  "routine.run.succeeded": "mobile.agent.webhook.event.succeeded",
  "routine.run.failed": "mobile.agent.webhook.event.failed",
  "routine.run.needs_attention": "mobile.agent.webhook.event.needsAttention",
} as const satisfies Record<RoutineRunEventType, MobileTextKey>;

const IGNORED_KEYS = {
  "event-type": "mobile.agent.webhook.activity.ignoredEventType",
  filter: "mobile.agent.webhook.activity.ignoredFilter",
  inactive: "mobile.agent.webhook.activity.ignoredInactive",
} as const satisfies Record<WebhookReceiptReason, MobileTextKey>;

type DeliveryActivity = Extract<EventActivity, { kind: "delivery" }>;

const DELIVERY_KEYS = {
  queued: "mobile.agent.webhook.activity.queued",
  sending: "mobile.agent.webhook.activity.sending",
  succeeded: "mobile.agent.webhook.activity.succeeded",
  failed: "mobile.agent.webhook.activity.failed",
} as const satisfies Record<DeliveryActivity["status"], MobileTextKey>;

/** A header row in the form. The ID keeps the row and its inputs mounted while the user types. */
interface HeaderDraft {
  id: string;
  name: string;
  value: string;
}

/**
 * The form never holds a saved secret or a saved header value: reads return only `hasSecret` and
 * `headerNames`. An empty secret or header list keeps what the host has.
 */
interface DestinationDraft {
  id?: string;
  active: boolean;
  url: string;
  method: WebhookMethod;
  eventTypes: RoutineRunEventType[];
  payloadTemplate: string;
  hasSecret: boolean;
  secret: string;
  removeSecret: boolean;
  headerNames: string[];
  headers: HeaderDraft[];
  removeHeaders: boolean;
}

let nextHeaderId = 0;

function newHeaderDraft(): HeaderDraft {
  nextHeaderId += 1;
  return { id: `header-${nextHeaderId}`, name: "", value: "" };
}

function newDestinationDraft(): DestinationDraft {
  return {
    active: true,
    url: "",
    method: "POST",
    eventTypes: ["routine.run.succeeded", "routine.run.failed"],
    payloadTemplate: "",
    hasSecret: false,
    secret: "",
    removeSecret: false,
    headerNames: [],
    headers: [],
    removeHeaders: false,
  };
}

function destinationDraft(destination: WebhookDestination): DestinationDraft {
  return {
    id: destination.id,
    active: destination.active,
    url: destination.url,
    method: destination.method,
    eventTypes: destination.eventTypes,
    // A null template sends the default payload. Every other value, also `false` or `0`, is a template.
    payloadTemplate: destination.payloadTemplate === null ? "" : JSON.stringify(destination.payloadTemplate, null, 2),
    hasSecret: destination.hasSecret,
    secret: "",
    removeSecret: false,
    headerNames: destination.headerNames,
    headers: [],
    removeHeaders: false,
  };
}

/** Null sends the default payload. Undefined is text that is not valid JSON. */
function parsePayload(text: string): EventJsonValue | null | undefined {
  if (!text.trim()) return null;
  try {
    const parsed = JSON.parse(text);
    return isEventJsonValue(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Undefined keeps the saved secret, "" removes it, and other text replaces it. */
function secretInput(draft: DestinationDraft): string | undefined {
  if (draft.secret.trim()) return draft.secret;
  return draft.removeSecret ? "" : undefined;
}

/** Undefined keeps the saved headers, `{}` removes them, and rows replace them. */
function headersInput(draft: DestinationDraft): Record<string, string> | undefined {
  const rows = draft.headers.filter((header) => header.name.trim() || header.value);
  if (rows.length) return Object.fromEntries(rows.map((header) => [header.name.trim(), header.value]));
  return draft.removeHeaders ? {} : undefined;
}

function draftValid(draft: DestinationDraft): boolean {
  const secret = draft.secret.trim() ? draft.secret : "";
  return (
    Boolean(draft.url.trim()) &&
    draft.eventTypes.length > 0 &&
    parsePayload(draft.payloadTemplate) !== undefined &&
    (secret === "" || secret.length >= MIN_SECRET_LENGTH) &&
    draft.headers.every((header) => (header.name.trim() ? Boolean(header.value) : !header.value))
  );
}

/** The notifications and the activity of one routine. The parent shows it only to an owner or admin. */
export function RoutineWebhookNotifications({
  serverId,
  owner,
  routineId,
}: {
  serverId: string;
  owner: EventRoutineOwner;
  routineId: string;
}) {
  const { t, errorMessage } = useText();
  const { theme } = useUniwind();
  const workspace = useMobileWorkspace();
  const queryClient = useQueryClient();
  const queryKey = ["routine-webhooks", serverId, owner.kind, owner.id, routineId];
  const lock = useRef(false);
  const [pending, setPending] = useState(false);
  const [draft, setDraft] = useState<DestinationDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const editingId = draft?.id;
  const destinations = useQuery({
    queryKey: [...queryKey, "destinations"],
    retry: false,
    queryFn: () => workspace.listWebhookDestinations({ owner, routineId }, serverId),
  });
  const activity = useQuery({
    queryKey: [...queryKey, "activity"],
    retry: false,
    queryFn: () => workspace.listEventActivity({ owner, routineId, limit: 50 }, serverId),
  });

  async function run(operation: () => Promise<unknown>, failure: MobileTextKey, done?: () => void) {
    if (lock.current) return;
    lock.current = true;
    setPending(true);
    setError(null);
    try {
      await operation();
      void haptics.notification("success");
      done?.();
    } catch (cause) {
      void haptics.notification("error");
      setError(errorMessage(cause, t(failure)));
    } finally {
      lock.current = false;
      setPending(false);
      void queryClient.invalidateQueries({ queryKey });
    }
  }

  function save(current: DestinationDraft) {
    const payloadTemplate = parsePayload(current.payloadTemplate);
    if (payloadTemplate === undefined) return;
    const secret = secretInput(current);
    const headers = headersInput(current);
    const input: SaveWebhookDestinationInput = {
      ...(current.id ? { id: current.id } : {}),
      owner,
      routineId,
      active: current.active,
      url: current.url.trim(),
      method: current.method,
      eventTypes: current.eventTypes,
      payloadTemplate,
      ...(secret === undefined ? {} : { secret }),
      ...(headers === undefined ? {} : { headers }),
    };
    void run(
      () => workspace.saveWebhookDestination(input, serverId),
      "mobile.agent.webhook.saveFailed",
      () => setDraft(null),
    );
  }

  function remove(id: string) {
    Alert.alert(t("mobile.agent.webhook.deleteTitle"), t("mobile.agent.webhook.deleteBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.delete"),
        style: "destructive",
        onPress: () =>
          void run(
            () => workspace.deleteWebhookDestination({ id, owner, routineId }, serverId),
            "mobile.agent.webhook.saveFailed",
            () => setDraft(null),
          ),
      },
    ]);
  }

  return (
    <View className="gap-5">
      {destinations.isError || activity.isError ? (
        <SettingsNote>{t("mobile.agent.webhook.loadFailed")}</SettingsNote>
      ) : null}
      <SettingsSection
        title={t("mobile.agent.webhook.notifications")}
        footer={t("mobile.agent.webhook.notificationsHint")}
      >
        {(destinations.data ?? []).map((destination) => (
          <SettingsRow
            key={destination.id}
            supportingText={`${destination.method} · ${t(destination.active ? "mobile.agent.webhook.on" : "mobile.agent.webhook.off")}`}
            disabled={pending}
            onPress={() => setDraft(destinationDraft(destination))}
          >
            <Typography.Paragraph numberOfLines={1}>{destination.url}</Typography.Paragraph>
          </SettingsRow>
        ))}
        {destinations.data && !destinations.data.length ? (
          <SettingsNote>{t("mobile.agent.webhook.noNotifications")}</SettingsNote>
        ) : null}
        {draft ? null : (
          <SettingsRow disclosure={false} disabled={pending} onPress={() => setDraft(newDestinationDraft())}>
            <Typography.Paragraph className="text-accent">
              {t("mobile.agent.webhook.addNotification")}
            </Typography.Paragraph>
          </SettingsRow>
        )}
      </SettingsSection>
      {draft ? (
        <DestinationForm
          key={draft.id ?? "new"}
          draft={draft}
          locked={pending}
          dark={theme === "dark"}
          onChange={setDraft}
          onSave={() => save(draft)}
          onCancel={() => setDraft(null)}
          onDelete={editingId ? () => remove(editingId) : undefined}
        />
      ) : null}
      <SettingsSection title={t("mobile.agent.webhook.activity")}>
        {(activity.data ?? []).flatMap((entry) => [
          <ActivityRow key={`${entry.kind}-${entry.id}`} entry={entry} />,
          // A failed delivery gets its own action row, so the section draws a separator above it.
          entry.kind === "delivery" && entry.status === "failed" ? (
            <SettingsRow
              key={`${entry.kind}-${entry.id}-retry`}
              disclosure={false}
              disabled={pending}
              onPress={() =>
                void run(
                  () => workspace.retryEventDelivery({ id: entry.id, owner, routineId }, serverId),
                  "mobile.agent.webhook.retryFailed",
                )
              }
            >
              <Typography.Paragraph className="text-accent">{t("mobile.agent.webhook.retry")}</Typography.Paragraph>
            </SettingsRow>
          ) : null,
        ])}
        {activity.data && !activity.data.length ? (
          <SettingsNote>{t("mobile.agent.webhook.noActivity")}</SettingsNote>
        ) : null}
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
  dark,
  onChange,
  onSave,
  onCancel,
  onDelete,
}: {
  draft: DestinationDraft;
  locked: boolean;
  dark: boolean;
  onChange: (draft: DestinationDraft) => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const { t } = useText();
  const payloadInvalid = parsePayload(draft.payloadTemplate) === undefined;
  const secretShort = Boolean(draft.secret.trim()) && draft.secret.length < MIN_SECRET_LENGTH;
  const updateHeader = (id: string, change: Partial<HeaderDraft>) =>
    onChange({ ...draft, headers: draft.headers.map((item) => (item.id === id ? { ...item, ...change } : item)) });
  const toggleEvent = (eventType: RoutineRunEventType, on: boolean) =>
    onChange({
      ...draft,
      eventTypes: ROUTINE_RUN_EVENT_TYPES.filter((item) => (item === eventType ? on : draft.eventTypes.includes(item))),
    });
  const secretHint = secretShort
    ? t("mobile.agent.webhook.secretTooShort")
    : draft.removeSecret
      ? t("mobile.agent.webhook.secretRemoved")
      : draft.hasSecret
        ? t("mobile.agent.webhook.secretSaved")
        : t("mobile.agent.webhook.destinationSecretHint");
  const headersHint = draft.headers.length
    ? undefined
    : draft.removeHeaders
      ? t("mobile.agent.webhook.headersRemoved")
      : draft.headerNames.length
        ? t("mobile.agent.webhook.headersSaved", { names: draft.headerNames.join(", ") })
        : undefined;
  return (
    <>
      <SettingsSection title={t("mobile.agent.webhook.notifications")}>
        <View className="gap-3 p-4">
          <SheetFormField
            appearance="soft"
            label={t("mobile.agent.webhook.destinationUrl")}
            value={draft.url}
            editable={!locked}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            onChangeText={(url) => onChange({ ...draft, url })}
          />
        </View>
        <SettingsRow
          trailing={
            <SettingsPicker
              label={t("mobile.agent.webhook.method")}
              value={draft.method}
              options={METHODS.map((method) => ({ value: method, label: method }))}
              enabled={!locked}
              dark={dark}
              onChange={(method) => onChange({ ...draft, method })}
            />
          }
        >
          <Typography.Paragraph>{t("mobile.agent.webhook.method")}</Typography.Paragraph>
        </SettingsRow>
        <SettingsRow
          trailing={
            <Host matchContents colorScheme={dark ? "dark" : "light"}>
              <Switch
                label={t("mobile.agent.webhook.enabled")}
                value={draft.active}
                disabled={locked}
                onValueChange={(active) => onChange({ ...draft, active })}
              />
            </Host>
          }
        >
          <Typography.Paragraph>{t("mobile.agent.webhook.enabled")}</Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title={t("mobile.agent.webhook.sendFor")}>
        {ROUTINE_RUN_EVENT_TYPES.map((eventType) => (
          <SettingsRow
            key={eventType}
            trailing={
              <Host matchContents colorScheme={dark ? "dark" : "light"}>
                <Switch
                  label={t(EVENT_KEYS[eventType])}
                  value={draft.eventTypes.includes(eventType)}
                  disabled={locked}
                  onValueChange={(on) => toggleEvent(eventType, on)}
                />
              </Host>
            }
          >
            <Typography.Paragraph>{t(EVENT_KEYS[eventType])}</Typography.Paragraph>
          </SettingsRow>
        ))}
      </SettingsSection>
      <SheetFormField
        appearance="soft"
        label={t("mobile.agent.webhook.payloadTemplate")}
        hint={t(payloadInvalid ? "mobile.agent.webhook.payloadInvalid" : "mobile.agent.webhook.payloadTemplateHint")}
        value={draft.payloadTemplate}
        editable={!locked}
        autoCapitalize="none"
        autoCorrect={false}
        multiline
        onChangeText={(payloadTemplate) => onChange({ ...draft, payloadTemplate })}
      />
      <SheetFormField
        appearance="soft"
        label={t("mobile.agent.webhook.secret")}
        hint={secretHint}
        value={draft.secret}
        editable={!locked}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
        onChangeText={(secret) => onChange({ ...draft, secret, removeSecret: false })}
      />
      {draft.hasSecret && !draft.removeSecret && !draft.secret ? (
        <SettingsSection>
          <SettingsRow disclosure={false} disabled={locked} onPress={() => onChange({ ...draft, removeSecret: true })}>
            <Typography.Paragraph className="text-danger-text">
              {t("mobile.agent.webhook.removeSecret")}
            </Typography.Paragraph>
          </SettingsRow>
        </SettingsSection>
      ) : null}
      <SettingsSection title={t("mobile.agent.webhook.headers")} footer={headersHint}>
        {draft.headers.map((header) => (
          <View key={header.id} className="gap-2 p-4">
            <SheetFormField
              appearance="soft"
              label={t("mobile.agent.webhook.headerName")}
              value={header.name}
              editable={!locked}
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={(name) => updateHeader(header.id, { name })}
            />
            <SheetFormField
              appearance="soft"
              label={t("mobile.agent.webhook.headerValue")}
              value={header.value}
              editable={!locked}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              onChangeText={(value) => updateHeader(header.id, { value })}
            />
            <SettingsRow
              disclosure={false}
              disabled={locked}
              onPress={() => onChange({ ...draft, headers: draft.headers.filter((item) => item.id !== header.id) })}
            >
              <Typography.Paragraph className="text-danger-text">
                {t("mobile.agent.webhook.removeHeader")}
              </Typography.Paragraph>
            </SettingsRow>
          </View>
        ))}
        <SettingsRow
          disclosure={false}
          disabled={locked}
          onPress={() => onChange({ ...draft, headers: [...draft.headers, newHeaderDraft()] })}
        >
          <Typography.Paragraph className="text-accent">{t("mobile.agent.webhook.addHeader")}</Typography.Paragraph>
        </SettingsRow>
        {draft.headerNames.length && !draft.removeHeaders && !draft.headers.length ? (
          <SettingsRow disclosure={false} disabled={locked} onPress={() => onChange({ ...draft, removeHeaders: true })}>
            <Typography.Paragraph className="text-danger-text">
              {t("mobile.agent.webhook.removeHeaders")}
            </Typography.Paragraph>
          </SettingsRow>
        ) : null}
      </SettingsSection>
      <SettingsSection>
        <SettingsRow disclosure={false} disabled={locked || !draftValid(draft)} onPress={onSave}>
          <Typography.Paragraph className="text-accent">
            {t("mobile.agent.webhook.saveNotification")}
          </Typography.Paragraph>
        </SettingsRow>
        <SettingsRow disclosure={false} disabled={locked} onPress={onCancel}>
          <Typography.Paragraph>{t("common.cancel")}</Typography.Paragraph>
        </SettingsRow>
        {onDelete ? (
          <SettingsRow disclosure={false} disabled={locked} onPress={onDelete}>
            <Typography.Paragraph className="text-danger-text">
              {t("mobile.agent.webhook.deleteNotification")}
            </Typography.Paragraph>
          </SettingsRow>
        ) : null}
      </SettingsSection>
    </>
  );
}

function ActivityRow({ entry }: { entry: EventActivity }) {
  const { t, format } = useText();
  const time = format.date(new Date(entry.occurredAt), { dateStyle: "medium", timeStyle: "short" });
  if (entry.kind === "received") {
    const outcome =
      entry.status === "started"
        ? t("mobile.agent.webhook.activity.started")
        : entry.reason
          ? t(IGNORED_KEYS[entry.reason])
          : t("mobile.agent.webhook.activity.ignored");
    return (
      <SettingsRow supportingText={`${outcome} · ${time}`}>
        <Typography.Paragraph numberOfLines={1}>
          {t("mobile.agent.webhook.activity.received", { eventType: entry.eventType })}
        </Typography.Paragraph>
      </SettingsRow>
    );
  }
  const details = [
    t(DELIVERY_KEYS[entry.status]),
    t("mobile.agent.webhook.activity.attempt", { attempt: format.number(entry.attempt) }),
    ...(entry.statusCode === null ? [] : [t("mobile.agent.webhook.activity.statusCode", { code: entry.statusCode })]),
    time,
  ];
  return (
    <SettingsRow supportingText={details.join(" · ")}>
      <Typography.Paragraph numberOfLines={1}>
        {t("mobile.agent.webhook.activity.delivery", { event: t(EVENT_KEYS[entry.eventType]) })}
      </Typography.Paragraph>
    </SettingsRow>
  );
}
