import {
  type EventActivity,
  type EventRoutineRef,
  type EventStatus,
  isEventJsonValue,
  type ListEventActivityInput,
  type ListWebhookDestinationsInput,
  ROUTINE_RUN_EVENT_TYPES,
  type RoutineRunEventType,
  type SaveWebhookDestinationInput,
  type WebhookDeliveryRef,
  type WebhookDestination,
  type WebhookDestinationRef,
  type WebhookMethod,
  type WebhookSecret,
} from "@openbot/contracts/ipc-events";
import {
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  Input,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  Plus,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Text,
  Textarea,
  Trash2,
  toast,
  X,
} from "@openbot/ui";
import { createEffect, createSignal, createUniqueId, For, Show, untrack } from "solid-js";
import { useText } from "../../text";

/** The webhook operations of one host. Every list and action names its routine. */
export interface RoutineWebhooksApi {
  getStatus: () => Promise<EventStatus>;
  rotateSecret: (input: EventRoutineRef) => Promise<WebhookSecret>;
  listDestinations: (input: ListWebhookDestinationsInput) => Promise<WebhookDestination[]>;
  saveDestination: (input: SaveWebhookDestinationInput) => Promise<WebhookDestination>;
  deleteDestination: (input: WebhookDestinationRef) => Promise<void>;
  listActivity: (input: ListEventActivityInput) => Promise<EventActivity[]>;
  retryDelivery: (input: WebhookDeliveryRef) => Promise<void>;
}

export interface RoutineWebhookNotificationsProps {
  api: RoutineWebhooksApi;
  routine: EventRoutineRef;
  disabled?: boolean;
}

type HeaderDraft = { name: string; value: string };
type DestinationDraft = {
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
  /** True when the save sends `headers`. A saved destination keeps its headers until the user replaces them. */
  replaceHeaders: boolean;
  headers: HeaderDraft[];
};

const METHODS: WebhookMethod[] = ["POST", "PUT", "PATCH"];
/** The host signs with HMAC-SHA256 and asks for at least this many characters. */
const SECRET_MIN_LENGTH = 32;
const TEMPLATE_FIELDS = ["routineName", "status", "eventType", "runId", "routineId", "occurredAt", "id"];
const PAYLOAD_TEMPLATE_EXAMPLE = '{ "text": "{{routineName}}: {{status}}" }';

export const ROUTINE_RUN_EVENT_LABELS = {
  "routine.run.started": "routine.notifications.eventType.started",
  "routine.run.succeeded": "routine.notifications.eventType.succeeded",
  "routine.run.failed": "routine.notifications.eventType.failed",
  "routine.run.needs_attention": "routine.notifications.eventType.needsAttention",
} as const satisfies Record<RoutineRunEventType, string>;

const EMPTY_DESTINATION: DestinationDraft = {
  active: true,
  url: "",
  method: "POST",
  eventTypes: [...ROUTINE_RUN_EVENT_TYPES],
  payloadTemplate: "",
  hasSecret: false,
  secret: "",
  removeSecret: false,
  headerNames: [],
  replaceHeaders: true,
  headers: [],
};

export function RoutineWebhookNotifications(props: RoutineWebhookNotificationsProps) {
  const { t, errorMessage, format } = useText();
  const formId = `routine-notification-${createUniqueId()}`;
  const [destinations, setDestinations] = createSignal<WebhookDestination[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [draft, setDraft] = createSignal<DestinationDraft | null>(null);
  const [options, setOptions] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [pendingDelete, setPendingDelete] = createSignal<WebhookDestination | null>(null);
  const [deleteError, setDeleteError] = createSignal<string | null>(null);

  async function load(): Promise<void> {
    const routine = props.routine;
    setLoading(true);
    try {
      const rows = await props.api.listDestinations({ owner: routine.owner, routineId: routine.id });
      if (props.routine.id === routine.id) setDestinations(rows);
    } catch (cause) {
      setError(errorMessage(cause, t("routine.notifications.loadFailed")));
    } finally {
      setLoading(false);
    }
  }

  createEffect(
    () => props.routine.id,
    () => {
      setDraft(null);
      setPendingDelete(null);
      setError(null);
      setDestinations([]);
      void untrack(load);
    },
  );

  function update(change: Partial<DestinationDraft>): void {
    setDraft((value) => value && { ...value, ...change });
  }

  function edit(destination?: WebhookDestination): void {
    setError(null);
    setOptions(false);
    setDraft(
      destination
        ? {
            id: destination.id,
            active: destination.active,
            url: destination.url,
            method: destination.method,
            eventTypes: [...destination.eventTypes],
            // `false`, `0` and `""` are valid templates, so only `null` means no template.
            payloadTemplate:
              destination.payloadTemplate === null ? "" : JSON.stringify(destination.payloadTemplate, null, 2),
            hasSecret: destination.hasSecret,
            secret: "",
            removeSecret: false,
            headerNames: destination.headerNames,
            replaceHeaders: false,
            headers: [],
          }
        : { ...EMPTY_DESTINATION, eventTypes: [...EMPTY_DESTINATION.eventTypes] },
    );
  }

  function toggleEventType(eventType: RoutineRunEventType, checked: boolean): void {
    setDraft(
      (value) =>
        value && {
          ...value,
          eventTypes: checked
            ? ROUTINE_RUN_EVENT_TYPES.filter((item) => item === eventType || value.eventTypes.includes(item))
            : value.eventTypes.filter((item) => item !== eventType),
        },
    );
  }

  function updateHeader(index: number, change: Partial<HeaderDraft>): void {
    setDraft(
      (value) =>
        value && {
          ...value,
          headers: value.headers.map((header, itemIndex) => (itemIndex === index ? { ...header, ...change } : header)),
        },
    );
  }

  const urlValid = (value: DestinationDraft) => value.url.trim().startsWith("https://");
  const secretValid = (value: DestinationDraft) =>
    value.removeSecret || value.secret.length === 0 || value.secret.length >= SECRET_MIN_LENGTH;
  const headersValid = (value: DestinationDraft) =>
    !value.replaceHeaders || value.headers.every((header) => header.name.trim() && header.value);
  const draftValid = (value: DestinationDraft) =>
    urlValid(value) && value.eventTypes.length > 0 && secretValid(value) && headersValid(value);

  async function save(): Promise<void> {
    const value = draft();
    if (!value || saving() || !draftValid(value)) return;
    let payloadTemplate: SaveWebhookDestinationInput["payloadTemplate"] = null;
    if (value.payloadTemplate.trim()) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(value.payloadTemplate);
      } catch {
        parsed = undefined;
      }
      if (parsed === undefined || !isEventJsonValue(parsed)) {
        setError(t("routine.notifications.payloadTemplateInvalid"));
        return;
      }
      payloadTemplate = parsed;
    }
    const secret = value.removeSecret ? "" : value.secret || undefined;
    const headers =
      value.replaceHeaders && (value.id || value.headers.length > 0)
        ? Object.fromEntries(value.headers.map((header) => [header.name.trim(), header.value]))
        : undefined;
    const input: SaveWebhookDestinationInput = {
      ...(value.id ? { id: value.id } : {}),
      owner: props.routine.owner,
      routineId: props.routine.id,
      active: value.active,
      url: value.url.trim(),
      method: value.method,
      eventTypes: value.eventTypes,
      payloadTemplate,
      ...(secret === undefined ? {} : { secret }),
      ...(headers === undefined ? {} : { headers }),
    };
    setSaving(true);
    setError(null);
    try {
      await props.api.saveDestination(input);
      setDraft(null);
      toast.success(t(value.id ? "routine.notifications.updated" : "routine.notifications.created"));
      await load();
    } catch (cause) {
      setError(errorMessage(cause, t("routine.notifications.saveFailed")));
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete(): Promise<void> {
    const destination = pendingDelete();
    if (!destination) return;
    setDeleteError(null);
    try {
      await props.api.deleteDestination({
        id: destination.id,
        owner: props.routine.owner,
        routineId: props.routine.id,
      });
      if (draft()?.id === destination.id) setDraft(null);
      setPendingDelete(null);
      toast.success(t("routine.notifications.deleted"));
      await load();
    } catch (cause) {
      setDeleteError(errorMessage(cause, t("routine.notifications.deleteFailed")));
    }
  }

  const eventTypeList = (eventTypes: readonly RoutineRunEventType[]) =>
    format.list(eventTypes.map((eventType) => t(ROUTINE_RUN_EVENT_LABELS[eventType])));
  const locked = () => Boolean(props.disabled) || saving();

  return (
    <div class="agent-routine-notifications">
      <Text variant="caption" tone="muted">
        {t("routine.notifications.description")}
      </Text>

      <Show when={error()}>
        {(message) => (
          <Text variant="caption" tone="danger" role="alert">
            {message()}
          </Text>
        )}
      </Show>

      <Show
        when={!loading() || destinations().length > 0}
        fallback={
          <Text variant="caption" tone="muted">
            {t("common.loading")}
          </Text>
        }
      >
        <Show
          when={destinations().length > 0}
          fallback={
            <Show when={!draft()}>
              <Text variant="caption" tone="muted">
                {t("routine.notifications.empty")}
              </Text>
            </Show>
          }
        >
          <ItemGroup class="agent-routine-webhook-list" surface="subtle">
            <For each={destinations()}>
              {(destination) => (
                <Item size="compact">
                  <ItemContent>
                    <ItemTitle class="agent-routine-webhook-url">{destination.url}</ItemTitle>
                    <ItemDescription>
                      {destination.method} · {eventTypeList(destination.eventTypes)}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Show when={!destination.active}>
                      <Badge variant="secondary">{t("routine.settings.paused")}</Badge>
                    </Show>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={locked()}
                      onClick={() => edit(destination)}
                    >
                      {t("common.edit")}
                    </Button>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="destructive-ghost"
                      disabled={locked()}
                      aria-label={t("routine.notifications.deleteLabel", { url: destination.url })}
                      onClick={() => {
                        setDeleteError(null);
                        setPendingDelete(destination);
                      }}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </ItemActions>
                </Item>
              )}
            </For>
          </ItemGroup>
        </Show>
      </Show>

      <Show
        when={draft()}
        fallback={
          <Button
            type="button"
            size="sm"
            variant="secondary"
            class="agent-routine-disclosure"
            disabled={locked()}
            onClick={() => edit()}
          >
            <Plus aria-hidden="true" />
            {t("routine.notifications.add")}
          </Button>
        }
      >
        {(current) => (
          <form
            class="agent-routine-webhook-form"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <label class="settings-field">
              <span>{t("routine.notifications.url")}</span>
              <Input
                type="url"
                value={current().url}
                placeholder={t("routine.notifications.urlPlaceholder")}
                invalid={current().url.trim() !== "" && !urlValid(current())}
                onValueChange={(url) => update({ url })}
              />
              <Text variant="caption" tone="muted">
                {t("routine.notifications.urlHint")}
              </Text>
            </label>

            <fieldset class="agent-routine-webhook-events">
              <legend>{t("routine.notifications.eventTypes")}</legend>
              <For each={ROUTINE_RUN_EVENT_TYPES}>
                {(eventType) => (
                  <label class="agent-routine-webhook-check" for={`${formId}-${eventType}`}>
                    <Checkbox
                      id={`${formId}-${eventType}`}
                      checked={current().eventTypes.includes(eventType)}
                      onChange={(event) => toggleEventType(eventType, event.currentTarget.checked)}
                    />
                    <span>{t(ROUTINE_RUN_EVENT_LABELS[eventType])}</span>
                  </label>
                )}
              </For>
            </fieldset>

            <div class="agent-routine-webhook-check">
              <Switch
                aria-label={t("routine.notifications.active")}
                checked={current().active}
                onChange={(active) => update({ active })}
              />
              <span>{t("routine.notifications.active")}</span>
            </div>

            <Button
              type="button"
              size="sm"
              variant="ghost"
              class="agent-routine-disclosure"
              aria-expanded={options() ? "true" : "false"}
              onClick={() => setOptions((open) => !open)}
            >
              {t("routine.notifications.options")}
            </Button>

            <Show when={options()}>
              <div class="agent-routine-webhook-options">
                <div class="settings-field">
                  <span>{t("routine.notifications.method")}</span>
                  <Select<WebhookMethod>
                    options={METHODS}
                    value={current().method}
                    onChange={(method) => method && update({ method })}
                    itemComponent={(item) => <SelectItem item={item.item}>{item.item.rawValue}</SelectItem>}
                  >
                    <SelectTrigger aria-label={t("routine.notifications.method")}>
                      <SelectValue<WebhookMethod>>{(state) => state.selectedOption()}</SelectValue>
                    </SelectTrigger>
                    <SelectContent />
                  </Select>
                </div>

                <div class="settings-field">
                  <span>{t("routine.notifications.secret")}</span>
                  <Show
                    when={!current().removeSecret}
                    fallback={
                      <Text variant="caption" tone="muted">
                        {t("routine.notifications.secretRemoved")}
                      </Text>
                    }
                  >
                    <Input
                      type="password"
                      autocomplete="new-password"
                      value={current().secret}
                      placeholder={t(
                        current().hasSecret
                          ? "routine.notifications.secretReplacePlaceholder"
                          : "routine.notifications.secretPlaceholder",
                      )}
                      invalid={!secretValid(current())}
                      onValueChange={(secret) => update({ secret })}
                    />
                  </Show>
                  <Text variant="caption" tone={secretValid(current()) ? "muted" : "danger"}>
                    {t("routine.notifications.secretHint", { min: SECRET_MIN_LENGTH })}
                  </Text>
                  <Show when={current().hasSecret}>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      class="agent-routine-disclosure"
                      onClick={() => update({ removeSecret: !current().removeSecret, secret: "" })}
                    >
                      {t(
                        current().removeSecret
                          ? "routine.notifications.keepSecret"
                          : "routine.notifications.removeSecret",
                      )}
                    </Button>
                  </Show>
                </div>

                <div class="settings-field">
                  <span>{t("routine.notifications.headers")}</span>
                  <Text variant="caption" tone="muted">
                    {t("routine.notifications.headersHint")}
                  </Text>
                  <Show
                    when={current().replaceHeaders}
                    fallback={
                      <>
                        <Show when={current().headerNames.length > 0}>
                          <Text variant="caption">
                            {t("routine.notifications.headersStored", { names: format.list(current().headerNames) })}
                          </Text>
                        </Show>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          class="agent-routine-disclosure"
                          onClick={() => update({ replaceHeaders: true, headers: [] })}
                        >
                          {t("routine.notifications.replaceHeaders")}
                        </Button>
                      </>
                    }
                  >
                    <For each={current().headers}>
                      {(header, index) => (
                        <div class="agent-routine-event-filter">
                          <Input
                            value={header.name}
                            placeholder={t("routine.notifications.headerNamePlaceholder")}
                            aria-label={t("routine.notifications.headerName")}
                            invalid={!header.name.trim() && Boolean(header.value)}
                            onValueChange={(name) => updateHeader(index(), { name })}
                          />
                          <Input
                            type="password"
                            autocomplete="new-password"
                            value={header.value}
                            placeholder={t("routine.notifications.headerValuePlaceholder")}
                            aria-label={t("routine.notifications.headerValue")}
                            onValueChange={(value) => updateHeader(index(), { value })}
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t("routine.notifications.removeHeader")}
                            onClick={() =>
                              setDraft(
                                (value) =>
                                  value && {
                                    ...value,
                                    headers: value.headers.filter((_, itemIndex) => itemIndex !== index()),
                                  },
                              )
                            }
                          >
                            <X aria-hidden="true" />
                          </Button>
                        </div>
                      )}
                    </For>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      class="agent-routine-disclosure"
                      onClick={() =>
                        setDraft((value) => value && { ...value, headers: [...value.headers, { name: "", value: "" }] })
                      }
                    >
                      <Plus aria-hidden="true" />
                      {t("routine.notifications.addHeader")}
                    </Button>
                  </Show>
                </div>

                <label class="settings-field">
                  <span>{t("routine.notifications.payloadTemplate")}</span>
                  <Textarea
                    value={current().payloadTemplate}
                    placeholder={PAYLOAD_TEMPLATE_EXAMPLE}
                    onValueChange={(payloadTemplate) => update({ payloadTemplate })}
                  />
                  <Text variant="caption" tone="muted">
                    {t("routine.notifications.payloadTemplateHint", {
                      fields: TEMPLATE_FIELDS.map((field) => `{{${field}}}`).join(", "),
                    })}
                  </Text>
                </label>
              </div>
            </Show>

            <div class="agent-routine-webhook-form-actions">
              <Button type="button" size="sm" variant="ghost" disabled={saving()} onClick={() => setDraft(null)}>
                {t("common.cancel")}
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={locked() || !draftValid(current())}
                loading={saving()}
                loadingLabel={t("common.saving")}
              >
                {t("common.save")}
              </Button>
            </div>
          </form>
        )}
      </Show>

      <ConfirmDialog
        open={pendingDelete() !== null}
        title={t("routine.notifications.deleteTitle")}
        description={t("routine.notifications.deleteDescription", { url: pendingDelete()?.url ?? "" })}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        error={deleteError() ?? undefined}
        onCancel={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
