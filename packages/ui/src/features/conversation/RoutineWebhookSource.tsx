import type { EventSource } from "@openbot/contracts/ipc-events";
import {
  Button,
  ConfirmDialog,
  CopyButton,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Text,
} from "@openbot/ui";
import { createEffect, createSignal, Show } from "solid-js";
import { useText } from "../../text";
import type { RoutineWebhooksApi } from "./RoutineWebhookNotifications";

export function RoutineWebhookSource(props: {
  api: RoutineWebhooksApi;
  sources: EventSource[];
  sourceId: string;
  name: string;
  onChange: (sourceId: string) => void;
  onSourcesChange: (sources: EventSource[]) => void;
}) {
  const { t, errorMessage } = useText();
  const [draft, setDraft] = createSignal<{ id?: string; name: string; secret: string; active: boolean } | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [confirmDelete, setConfirmDelete] = createSignal(false);
  const [connected, setConnected] = createSignal<boolean | null>(null);
  const source = () => props.sources.find((item) => item.id === props.sourceId);
  createEffect(
    () => ({ sourceId: props.sourceId, api: props.api }),
    ({ api }) => {
      setDraft(null);
      setError(null);
      void api.getStatus().then(
        (status) => setConnected(status.connected),
        () => setConnected(null),
      );
    },
  );
  function edit(create = false) {
    const current = create ? undefined : source();
    setDraft({
      ...(current ? { id: current.id } : {}),
      name: current?.name ?? props.name,
      secret: "",
      active: current?.active ?? true,
    });
  }
  async function save() {
    const value = draft();
    if (!value || busy()) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await props.api.saveSource({
        ...(value.id ? { id: value.id } : {}),
        name: value.name.trim(),
        active: value.active,
        ...(value.secret ? { secret: value.secret } : {}),
      });
      props.onSourcesChange([...props.sources.filter((item) => item.id !== saved.id), saved]);
      props.onChange(saved.id);
      setDraft(null);
    } catch (cause) {
      setError(errorMessage(cause, t("server.events.saveFailed")));
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    const current = source();
    if (!current || busy()) return;
    setBusy(true);
    setError(null);
    try {
      await props.api.deleteSource({ id: current.id });
      props.onSourcesChange(props.sources.filter((item) => item.id !== current.id));
      props.onChange("");
      setDraft(null);
      setConfirmDelete(false);
    } catch (cause) {
      setError(errorMessage(cause, t("server.events.deleteFailed")));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div class="agent-routine-event-trigger">
      <Show when={props.sources.length > 0}>
        <div class="agent-routine-webhook-row">
          <Select<string>
            options={props.sources.map((item) => item.id)}
            value={props.sourceId}
            placeholder={t("routine.settings.eventSourcePlaceholder")}
            disabled={busy()}
            onChange={(id) => {
              if (id && id !== props.sourceId) props.onChange(id);
            }}
            itemComponent={(item) => (
              <SelectItem item={item.item}>
                {props.sources.find((source) => source.id === item.item.rawValue)?.name}
              </SelectItem>
            )}
          >
            <SelectTrigger aria-label={t("routine.settings.eventSource")}>
              <SelectValue<string>>
                {(state) =>
                  props.sources.find((item) => item.id === state.selectedOption())?.name ??
                  t("routine.settings.eventSourcePlaceholder")
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent />
          </Select>
          <Button variant="ghost" size="sm" disabled={busy()} onClick={() => edit(true)}>
            {t("routine.settings.newWebhook")}
          </Button>
        </div>
      </Show>
      <Show when={source()}>
        {(current) => (
          <>
            <Show when={current().url}>
              {(url) => (
                <div class="agent-routine-webhook-row">
                  <Input readonly value={url()} aria-label={t("server.events.urlLabel")} />
                  <CopyButton
                    value={url()}
                    label={t("server.events.copyUrl")}
                    copiedLabel={t("common.copied")}
                    size="sm"
                  />
                </div>
              )}
            </Show>
            <div class="agent-routine-webhook-row">
              <Text variant="caption" tone="muted">
                {t(
                  !current().active
                    ? "server.events.status.paused"
                    : connected()
                      ? "server.events.relayConnected"
                      : "server.events.relayOffline",
                )}
              </Text>
              <Button variant="ghost" size="sm" disabled={busy()} onClick={() => edit()}>
                {t("routine.settings.webhookDetails")}
              </Button>
            </div>
          </>
        )}
      </Show>
      <Show when={props.sources.length === 0 && !draft()}>
        <Button variant="secondary" size="sm" disabled={busy()} onClick={() => edit(true)}>
          {t("routine.settings.createWebhook")}
        </Button>
      </Show>
      <Show when={draft()}>
        {(value) => (
          <div class="agent-routine-event-trigger">
            <label class="settings-field">
              <span>{t("routine.settings.webhookName")}</span>
              <Input
                value={value().name}
                onValueChange={(name) => setDraft((current) => current && { ...current, name })}
              />
            </label>
            <label class="settings-field">
              <span>{t("server.events.secret")}</span>
              <Input
                type="password"
                autocomplete="new-password"
                value={value().secret}
                placeholder={t("server.events.secretPlaceholder")}
                onValueChange={(secret) => setDraft((current) => current && { ...current, secret })}
              />
            </label>
            <Show when={value().id}>
              <div class="agent-routine-webhook-row">
                <Switch
                  aria-label={t("server.events.active")}
                  checked={value().active}
                  onChange={(active) => setDraft((current) => current && { ...current, active })}
                />
                <Text variant="caption">{t("server.events.active")}</Text>
              </div>
            </Show>
            <div class="agent-routine-webhook-row">
              <Button
                size="sm"
                disabled={
                  busy() ||
                  !value().name.trim() ||
                  (value().secret.length > 0 ? value().secret.trim().length < 32 : !value().id)
                }
                onClick={() => void save()}
              >
                {t("routine.settings.saveWebhook")}
              </Button>
              <Button size="sm" variant="ghost" disabled={busy()} onClick={() => setDraft(null)}>
                {t("common.cancel")}
              </Button>
              <Show when={value().id}>
                <Button
                  size="sm"
                  variant="destructive-ghost"
                  disabled={busy()}
                  aria-label={t("server.events.deleteLabel", { name: value().name })}
                  onClick={() => setConfirmDelete(true)}
                >
                  {t("server.events.delete")}
                </Button>
              </Show>
            </div>
          </div>
        )}
      </Show>
      <Show when={error()}>
        {(message) => (
          <Text variant="caption" tone="danger" role="alert">
            {message()}
          </Text>
        )}
      </Show>
      <ConfirmDialog
        open={confirmDelete()}
        title={t("server.events.deleteSourceTitle")}
        description={t("server.events.deleteDescription")}
        confirmLabel={t("server.events.delete")}
        cancelLabel={t("common.cancel")}
        pending={busy()}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => void remove()}
      />
    </div>
  );
}
