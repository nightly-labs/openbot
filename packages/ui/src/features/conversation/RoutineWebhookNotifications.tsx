import type {
  EventActivity,
  EventSource,
  EventStatus,
  SaveEventSourceInput,
  SaveWebhookDestinationInput,
  WebhookDestination,
  WebhookMethod,
} from "@openbot/contracts/ipc-events";
import {
  Badge,
  Button,
  ConfirmDialog,
  Input,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  Plus,
  RefreshCw,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SettingsSection,
  Switch,
  Text,
  Textarea,
  Trash2,
  toast,
  X,
} from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createEffect, createSignal, For, Show, untrack } from "solid-js";
import { useText } from "../../text";

export interface RoutineWebhooksApi {
  getStatus: () => Promise<EventStatus>;
  listSources: () => Promise<EventSource[]>;
  saveSource: (input: SaveEventSourceInput) => Promise<EventSource>;
  deleteSource: (input: { id: string }) => Promise<void>;
  listDestinations: () => Promise<WebhookDestination[]>;
  saveDestination: (input: SaveWebhookDestinationInput) => Promise<WebhookDestination>;
  deleteDestination: (input: { id: string }) => Promise<void>;
  listActivity: (input?: { limit?: number }) => Promise<EventActivity[]>;
  retryDelivery: (input: { id: string }) => Promise<void>;
}

export interface RoutineWebhookNotificationsProps {
  api: RoutineWebhooksApi;
  canManage: boolean;
  busy?: boolean;
  routineId: string;
  sourceId?: string;
}

type Panel = "destinations" | "activity";
type HeaderDraft = { name: string; value: string };
type DestinationDraft = {
  id?: string;
  name: string;
  active: boolean;
  url: string;
  method: WebhookMethod;
  eventTypes: string;
  routineIds: string;
  payloadTemplate: string;
  headers: HeaderDraft[];
  headersTouched: boolean;
  secret: string;
};

const EMPTY_DESTINATION: DestinationDraft = {
  name: "",
  active: true,
  url: "",
  method: "POST",
  eventTypes: "routine.run.started, routine.run.succeeded, routine.run.failed, routine.run.needs_attention",
  routineIds: "",
  payloadTemplate: "",
  headers: [],
  headersTouched: false,
  secret: "",
};

const ACTIVITY_KIND_LABELS = {
  received: "server.events.received",
  "routine-run": "server.events.routineRun",
  delivery: "server.events.delivery",
} as const;
const ACTIVITY_STATUS_LABELS = {
  accepted: "server.events.status.accepted",
  duplicate: "server.events.status.duplicate",
  queued: "server.events.status.queued",
  running: "server.events.status.running",
  "needs-attention": "routine.runStatus.needsAttention",
  succeeded: "server.events.status.succeeded",
  failed: "server.events.status.failed",
} as const;

export function RoutineWebhookNotifications(props: RoutineWebhookNotificationsProps) {
  const { t, errorMessage, format } = useText();
  const [panel, setPanel] = createSignal<Panel>("destinations");
  const [destinations, setDestinations] = createSignal<WebhookDestination[]>([]);
  const [activity, setActivity] = createSignal<EventActivity[]>([]);
  const [destinationDraft, setDestinationDraft] = createSignal<DestinationDraft | null>(null);
  const [pendingDelete, setPendingDelete] = createSignal<{
    kind: "destination";
    id: string;
    name: string;
  } | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [activityFilter, setActivityFilter] = createSignal<string | null>(null);
  const [advanced, setAdvanced] = createSignal(false);

  async function loadDestinations(): Promise<void> {
    setLoading(true);
    try {
      setDestinations(await props.api.listDestinations());
    } catch (cause) {
      setError(errorMessage(cause, t("server.events.loadFailed")));
    } finally {
      setLoading(false);
    }
  }

  async function loadActivity(): Promise<void> {
    setLoading(true);
    try {
      setActivity(await props.api.listActivity({ limit: 100 }));
    } catch (cause) {
      setError(errorMessage(cause, t("server.events.loadFailed")));
    } finally {
      setLoading(false);
    }
  }

  createEffect(
    () => panel(),
    (current) => {
      setError(null);
      if (current === "destinations") void untrack(loadDestinations);
      if (current === "activity") void untrack(loadActivity);
    },
  );

  createEffect(
    () => props.routineId,
    () => {
      setDestinationDraft(null);
      setPendingDelete(null);
      setActivityFilter(null);
      setPanel("destinations");
    },
  );

  function editDestination(destination?: WebhookDestination): void {
    setError(null);
    setDestinationDraft(
      destination
        ? {
            id: destination.id,
            name: destination.name,
            active: destination.active,
            url: destination.url,
            method: destination.method,
            eventTypes: destination.eventTypes.join(", "),
            routineIds: destination.routineIds.join(", "),
            payloadTemplate: destination.payloadTemplate ? JSON.stringify(destination.payloadTemplate, null, 2) : "",
            // Header values are write-only. Keep this empty when editing so a save preserves
            // existing headers instead of clearing them.
            headers: destination.headerNames.map((name) => ({ name, value: "" })),
            headersTouched: false,
            secret: "",
          }
        : { ...EMPTY_DESTINATION, routineIds: props.routineId },
    );
  }

  async function saveDestination(): Promise<void> {
    const draft = destinationDraft();
    if (!draft?.name.trim() || !draft.url.trim() || saving() || !secretIsValid(draft)) {
      if (draft && !secretIsValid(draft)) setError(t("error.backend.webhookSecretRequired"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      let payloadTemplate = null;
      if (draft.payloadTemplate.trim()) {
        const parsed = JSON.parse(draft.payloadTemplate);
        if (!isEventJsonValue(parsed)) throw new Error(t("server.events.saveFailed"));
        payloadTemplate = parsed;
      }
      const input: SaveWebhookDestinationInput = {
        ...(draft.id ? { id: draft.id } : {}),
        name: draft.name.trim(),
        active: draft.active,
        url: draft.url.trim(),
        method: draft.method,
        eventTypes: splitList(draft.eventTypes),
        routineIds: splitList(draft.routineIds),
        payloadTemplate,
        ...(draft.headersTouched
          ? {
              headers: Object.fromEntries(
                draft.headers
                  .map(({ name, value }) => [name.trim(), value])
                  .filter(([name, value]) => Boolean(name && value)),
              ),
            }
          : {}),
        ...(draft.secret.trim() ? { secret: draft.secret } : {}),
      };
      await props.api.saveDestination(input);
      setDestinationDraft(null);
      toast.success(draft.id ? t("server.events.destinationUpdated") : t("server.events.destinationCreated"));
      await loadDestinations();
    } catch (cause) {
      setError(errorMessage(cause, t("server.events.saveFailed")));
    } finally {
      setSaving(false);
    }
  }

  async function deletePending(): Promise<void> {
    const pending = pendingDelete();
    if (!pending || saving()) return;
    setSaving(true);
    setError(null);
    try {
      await props.api.deleteDestination({ id: pending.id });
      await loadDestinations();
      if (destinationDraft()?.id === pending.id) setDestinationDraft(null);
      toast.success(t("server.events.destinationDeleted"));
      setPendingDelete(null);
    } catch (cause) {
      setError(errorMessage(cause, t("server.events.deleteFailed")));
    } finally {
      setSaving(false);
    }
  }

  async function retryDelivery(item: EventActivity): Promise<void> {
    if (!item.deliveryId || saving()) return;
    setSaving(true);
    setError(null);
    try {
      await props.api.retryDelivery({ id: item.deliveryId });
      await loadActivity();
    } catch (cause) {
      setError(errorMessage(cause, t("server.events.retryFailed")));
    } finally {
      setSaving(false);
    }
  }

  const destinationRows = () =>
    destinations().filter((item) => item.routineIds.length === 0 || item.routineIds.includes(props.routineId));
  const activityRows = () => {
    const filter = activityFilter();
    const relevant = activity().filter(
      (item) => item.routineId === props.routineId || (item.kind === "received" && item.sourceId === props.sourceId),
    );
    if (!filter) return relevant;
    return relevant.filter((item) =>
      [item.eventId, item.sourceId, item.routineId, item.runId, item.destinationId, item.deliveryId].includes(filter),
    );
  };
  const canEdit = () => props.canManage && !props.busy && !saving();

  function activitySummary(item: EventActivity): string {
    switch (item.summary) {
      case "event.duplicate":
        return t("server.events.summary.eventDuplicate");
      case "event.received":
        return t("server.events.summary.eventReceived");
      case "webhook.queued":
        return t("server.events.summary.webhookQueued");
      case "webhook.retrying":
        return t("server.events.summary.webhookRetrying");
      case "webhook.retry":
        return t("server.events.summary.webhookRetry");
      case "webhook.delivered":
        return t("server.events.summary.webhookDelivered");
      case "webhook.failed":
        return t("server.events.summary.webhookFailed");
      default:
        if (item.summary.startsWith("routine.run.")) {
          const status = item.summary.slice("routine.run.".length);
          const labels: Record<string, string> = {
            queued: t("server.events.status.queued"),
            running: t("server.events.status.running"),
            started: t("server.events.status.running"),
            succeeded: t("server.events.status.succeeded"),
            failed: t("server.events.status.failed"),
            needs_attention: t("routine.runStatus.needsAttention"),
            "needs-attention": t("routine.runStatus.needsAttention"),
          };
          return t("server.events.summary.routineRun", { status: labels[status] ?? status });
        }
        return t("server.events.summary.eventReceived");
    }
  }

  function relatedButton(label: string, id: string | null): JSX.Element {
    return (
      <Show when={id}>
        {(value) => (
          <Button type="button" size="sm" variant="link" onClick={() => setActivityFilter(value())}>
            {label}: {value()}
          </Button>
        )}
      </Show>
    );
  }

  return (
    <div class="server-events-settings">
      <div class="server-events-tabs">
        <Button
          type="button"
          variant={panel() === "destinations" ? "secondary" : "ghost"}
          aria-pressed={panel() === "destinations" ? "true" : "false"}
          onClick={() => setPanel("destinations")}
        >
          {t("server.events.destinations")}
        </Button>
        <Button
          type="button"
          variant={panel() === "activity" ? "secondary" : "ghost"}
          aria-pressed={panel() === "activity" ? "true" : "false"}
          onClick={() => setPanel("activity")}
        >
          {t("server.events.activity")}
        </Button>
      </div>

      <Show when={error()}>
        {(message) => (
          <Text variant="caption" tone="danger" role="alert">
            {message()}
          </Text>
        )}
      </Show>

      <Show when={panel() === "destinations"}>
        <SettingsSection
          title={t("server.events.destinationTitle")}
          description={t("server.events.destinationDescription")}
        >
          <div class="server-events-toolbar">
            <Button type="button" size="sm" disabled={!canEdit()} onClick={() => editDestination()}>
              <Plus aria-hidden="true" />
              {t("server.events.createDestination")}
            </Button>
          </div>
          <Show
            when={!loading() || destinationRows().length > 0}
            fallback={<Text tone="muted">{t("common.loading")}</Text>}
          >
            <Show
              when={destinationRows().length > 0}
              fallback={<Text tone="muted">{t("server.events.emptyDestinations")}</Text>}
            >
              <ItemGroup class="settings-modal-card server-events-list" surface="subtle">
                <For each={destinationRows()}>
                  {(destination) => (
                    <Item size="spacious">
                      <ItemContent>
                        <ItemTitle>{destination.name}</ItemTitle>
                        <ItemDescription>
                          <Badge variant={destination.active ? "success-light" : "secondary"}>
                            {t(destination.active ? "server.events.status.active" : "server.events.status.paused")}
                          </Badge>
                          <span>
                            {destination.method} · {destination.url}
                          </span>
                          <Show when={destination.headerNames.length > 0}>
                            <span>
                              {t("server.events.headersStored", { names: destination.headerNames.join(", ") })}
                            </span>
                          </Show>
                        </ItemDescription>
                      </ItemContent>
                      <ItemActions>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={!canEdit()}
                          onClick={() => editDestination(destination)}
                        >
                          {t("server.events.edit")}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive-ghost"
                          disabled={!canEdit()}
                          aria-label={t("server.events.deleteLabel", { name: destination.name })}
                          onClick={() =>
                            setPendingDelete({ kind: "destination", id: destination.id, name: destination.name })
                          }
                        >
                          <Trash2 aria-hidden="true" />
                          {t("server.events.delete")}
                        </Button>
                      </ItemActions>
                    </Item>
                  )}
                </For>
              </ItemGroup>
            </Show>
          </Show>
          <Show when={destinationDraft()}>
            {(draft) => (
              <form
                class="server-events-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveDestination();
                }}
              >
                <div class="server-events-form-header">
                  <Text variant="body">
                    {draft().id ? t("server.events.edit") : t("server.events.createDestination")}
                  </Text>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setDestinationDraft(null)}>
                    {t("server.events.cancelEdit")}
                  </Button>
                </div>
                <label class="settings-field">
                  <span>{t("server.events.name")}</span>
                  <Input
                    value={draft().name}
                    placeholder={t("server.events.namePlaceholder")}
                    onValueChange={(name) => setDestinationDraft((value) => value && { ...value, name })}
                  />
                </label>
                <div class="settings-field">
                  <span>{t("server.events.url")}</span>
                  <Input
                    type="url"
                    value={draft().url}
                    placeholder={t("server.events.urlPlaceholder")}
                    onValueChange={(url) => setDestinationDraft((value) => value && { ...value, url })}
                  />
                </div>
                <div class="settings-field">
                  <span>{t("server.events.secret")}</span>
                  <Input
                    type="password"
                    value={draft().secret}
                    placeholder={t("server.events.secretPlaceholder")}
                    autocomplete="new-password"
                    onValueChange={(secret) => setDestinationDraft((value) => value && { ...value, secret })}
                  />
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-expanded={advanced() ? "true" : "false"}
                  onClick={() => setAdvanced((value) => !value)}
                >
                  {t("routine.settings.deliveryOptions")}
                </Button>
                <Show when={advanced()}>
                  <div class="server-events-form-grid">
                    <div class="settings-field">
                      <span>{t("server.events.method")}</span>
                      <Select<WebhookMethod>
                        options={["POST", "PUT", "PATCH"]}
                        value={draft().method}
                        onChange={(method) => method && setDestinationDraft((value) => value && { ...value, method })}
                        itemComponent={(item) => <SelectItem item={item.item}>{item.item.rawValue}</SelectItem>}
                      >
                        <SelectTrigger aria-label={t("server.events.method")}>
                          <SelectValue<WebhookMethod>>{(state) => state.selectedOption()}</SelectValue>
                        </SelectTrigger>
                        <SelectContent />
                      </Select>
                    </div>
                    <div class="settings-field">
                      <span>{t("server.events.eventTypes")}</span>
                      <Input
                        value={draft().eventTypes}
                        placeholder={t("server.events.eventTypesPlaceholder")}
                        onValueChange={(eventTypes) =>
                          setDestinationDraft((value) => value && { ...value, eventTypes })
                        }
                      />
                    </div>
                  </div>
                  <div class="settings-field">
                    <span>{t("server.events.headers")}</span>
                    <Text variant="caption" tone="muted">
                      {t("server.events.headersHint")}
                    </Text>
                    <div class="server-events-headers">
                      <For each={draft().headers}>
                        {(header, index) => (
                          <div class="server-events-header-row">
                            <Input
                              value={header.name}
                              placeholder={t("server.events.headerNamePlaceholder")}
                              aria-label={t("server.events.headerName")}
                              onValueChange={(name) =>
                                setDestinationDraft(
                                  (value) =>
                                    value && {
                                      ...value,
                                      headers: value.headers.map((item, itemIndex) =>
                                        itemIndex === index() ? { ...item, name } : item,
                                      ),
                                      headersTouched: true,
                                    },
                                )
                              }
                            />
                            <Input
                              type="password"
                              value={header.value}
                              placeholder={t("server.events.headerValuePlaceholder")}
                              aria-label={t("server.events.headerValue")}
                              autocomplete="new-password"
                              onValueChange={(headerValue) =>
                                setDestinationDraft(
                                  (value) =>
                                    value && {
                                      ...value,
                                      headers: value.headers.map((item, itemIndex) =>
                                        itemIndex === index() ? { ...item, value: headerValue } : item,
                                      ),
                                      headersTouched: true,
                                    },
                                )
                              }
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              aria-label={t("server.events.removeHeader")}
                              onClick={() =>
                                setDestinationDraft(
                                  (value) =>
                                    value && {
                                      ...value,
                                      headers: value.headers.filter((_, itemIndex) => itemIndex !== index()),
                                      headersTouched: true,
                                    },
                                )
                              }
                            >
                              <X aria-hidden="true" />
                            </Button>
                          </div>
                        )}
                      </For>
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        setDestinationDraft(
                          (value) =>
                            value && {
                              ...value,
                              headers: [...value.headers, { name: "", value: "" }],
                              headersTouched: true,
                            },
                        )
                      }
                    >
                      <Plus aria-hidden="true" />
                      {t("server.events.addHeader")}
                    </Button>
                  </div>
                  <div class="settings-field">
                    <span>{t("server.events.payloadTemplate")}</span>
                    <Textarea
                      value={draft().payloadTemplate}
                      placeholder={t("server.events.payloadTemplatePlaceholder")}
                      onValueChange={(payloadTemplate) =>
                        setDestinationDraft((value) => value && { ...value, payloadTemplate })
                      }
                    />
                    <Text variant="caption" tone="muted">
                      {t("server.events.payloadTemplateHint")}
                    </Text>
                  </div>
                </Show>
                <div class="server-events-switch">
                  <Switch
                    aria-label={t("server.events.destinationActive")}
                    checked={draft().active}
                    onChange={(active) => setDestinationDraft((value) => value && { ...value, active })}
                  />
                  <span>{t("server.events.destinationActive")}</span>
                </div>
                <Button
                  type="submit"
                  size="sm"
                  disabled={!canEdit() || !draft().name.trim() || !draft().url.trim() || !secretIsValid(draft())}
                  loading={saving()}
                  loadingLabel={t("common.saving")}
                >
                  {t("server.events.save")}
                </Button>
              </form>
            )}
          </Show>
        </SettingsSection>
      </Show>

      <Show when={panel() === "activity"}>
        <SettingsSection title={t("server.events.activityTitle")} description={t("server.events.activityDescription")}>
          <div class="server-events-toolbar">
            <Button type="button" size="sm" variant="ghost" disabled={loading()} onClick={() => void loadActivity()}>
              <RefreshCw aria-hidden="true" />
              {t("common.retry")}
            </Button>
            <Show when={activityFilter()}>
              <Button type="button" size="sm" variant="ghost" onClick={() => setActivityFilter(null)}>
                {t("server.events.clearFilter")}
              </Button>
            </Show>
          </div>
          <Show
            when={!loading() || activityRows().length > 0}
            fallback={<Text tone="muted">{t("common.loading")}</Text>}
          >
            <Show
              when={activityRows().length > 0}
              fallback={<Text tone="muted">{t("server.events.emptyActivity")}</Text>}
            >
              <ItemGroup class="settings-modal-card server-events-list" surface="subtle">
                <For each={activityRows()}>
                  {(item) => (
                    <Item>
                      <ItemContent>
                        <ItemTitle>{t(ACTIVITY_KIND_LABELS[item.kind])}</ItemTitle>
                        <ItemDescription>{activitySummary(item)}</ItemDescription>
                        <div class="server-events-related">
                          {relatedButton(t("server.events.relatedEvent"), item.eventId)}
                          {relatedButton(t("server.events.relatedRoutine"), item.routineId)}
                          {relatedButton(t("server.events.relatedRun"), item.runId)}
                          {relatedButton(t("server.events.relatedDestination"), item.destinationId)}
                          {relatedButton(t("server.events.relatedDelivery"), item.deliveryId)}
                        </div>
                        <Text variant="caption" tone="muted">
                          {t(ACTIVITY_STATUS_LABELS[item.status])} ·{" "}
                          {format.date(new Date(item.occurredAt), { dateStyle: "medium", timeStyle: "short" })}
                        </Text>
                      </ItemContent>
                      <ItemActions>
                        <Show when={item.kind === "delivery" && item.status === "failed" && item.deliveryId}>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={!canEdit()}
                            onClick={() => void retryDelivery(item)}
                          >
                            {t("server.events.retry")}
                          </Button>
                        </Show>
                      </ItemActions>
                    </Item>
                  )}
                </For>
              </ItemGroup>
            </Show>
          </Show>
        </SettingsSection>
      </Show>

      <ConfirmDialog
        open={pendingDelete() !== null}
        title={t("server.events.deleteDestinationTitle")}
        description={t("server.events.deleteDescription")}
        confirmLabel={t("server.events.confirmDelete")}
        cancelLabel={t("server.events.cancel")}
        pending={saving()}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void deletePending()}
      />
    </div>
  );
}

function secretIsValid(value: { id?: string; secret: string }): boolean {
  const length = value.secret.trim().length;
  return value.id ? length === 0 || length >= 32 : length >= 32;
}

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function isEventJsonValue(value: unknown): value is SaveWebhookDestinationInput["payloadTemplate"] {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isEventJsonValue);
  if (!value || typeof value !== "object") return false;
  return Object.values(value).every(isEventJsonValue);
}
