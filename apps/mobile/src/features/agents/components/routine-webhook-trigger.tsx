import {
  type EventFilterDraft,
  eventFilterDraft,
  eventFilterPointerValid,
  MASKED_WEBHOOK_SECRET,
} from "@openbot/contracts/event-filter-value";
import type { EventFilter } from "@openbot/contracts/ipc-events";
import * as Clipboard from "expo-clipboard";
import { Button, Typography } from "heroui-native";
import { Check, ChevronDown, ChevronRight, Copy, RefreshCw } from "lucide-react-native";
import { type ReactNode, useState } from "react";
import { Alert, View } from "react-native";
import { useCSSVariable } from "uniwind";
import { showFailureAlert } from "@/features/analytics/failure-reports";
import { SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

/** A filter row in the form. The ID keeps the row and its inputs mounted while the user types. */
export interface FilterDraft extends EventFilterDraft {
  id: string;
}

let nextFilterId = 0;

function newFilterDraft(): FilterDraft {
  nextFilterId += 1;
  return { id: `new-${nextFilterId}`, pointer: "", value: "" };
}

/** Saved filters get IDs from their position, so the rows stay mounted until the user edits them. */
export function filterDrafts(filters: readonly EventFilter[]): FilterDraft[] {
  return filters.map((filter, index) => ({ id: `saved-${index}`, ...eventFilterDraft(filter) }));
}

function useCopy() {
  const { t } = useText();
  const [copied, setCopied] = useState<"url" | "secret" | null>(null);
  function copy(kind: "url" | "secret", text: string) {
    void Clipboard.setStringAsync(text)
      .then(() => {
        setCopied(kind);
        void haptics.notification("success");
      })
      .catch((error: unknown) => {
        void haptics.notification("error");
        showFailureAlert(error, "agent", t("mobile.agent.webhook.copyFailed"));
      });
  }
  return { copied, copy };
}

function CardNote({ children, className = "text-grouped-secondary" }: { children: string; className?: string }) {
  return (
    <Typography.Paragraph type="body-xs" className={className}>
      {children}
    </Typography.Paragraph>
  );
}

/** A compact row of the card: a label, its value, and one action beside the value. */
function ValueRow({ label, action, children }: { label: string; action?: ReactNode; children: ReactNode }) {
  return (
    <SettingsRow trailing={action}>
      <Typography type="body-xs" className="text-grouped-secondary">
        {label}
      </Typography>
      {children}
    </SettingsRow>
  );
}

function IconAction({
  label,
  disabled = false,
  onPress,
  children,
}: {
  label: string;
  disabled?: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  return (
    <Button isIconOnly variant="ghost" size="sm" accessibilityLabel={label} isDisabled={disabled} onPress={onPress}>
      {children}
    </Button>
  );
}

/**
 * The webhook trigger as one card, as on desktop: the trigger picker in `header`, then the endpoint
 * and the signing secret. The events row shows only when an event type or a filter is set; else a
 * "Filter events" action opens it. The host makes the endpoint and the
 * signing secret; the user never types the inbound secret. `url` is undefined before the routine has
 * a saved webhook trigger, and null while the host has not made it yet.
 */
export function RoutineWebhookTrigger({
  header,
  url,
  secret,
  eventType,
  filters,
  disabled,
  rotatePending,
  onEventTypeChange,
  onFiltersChange,
  onSecretDismiss,
  onRotate,
}: {
  /** The first row of the card: the picker that changes the trigger. */
  header: ReactNode;
  url: string | null | undefined;
  /** The signing secret that the host returned one time. Null when there is nothing to show. */
  secret: string | null;
  eventType: string;
  filters: FilterDraft[];
  disabled: boolean;
  rotatePending: boolean;
  onEventTypeChange: (value: string) => void;
  onFiltersChange: (filters: FilterDraft[]) => void;
  onSecretDismiss: () => void;
  /** Makes a new secret. Left out, the action is hidden. */
  onRotate?: () => void;
}) {
  const { t } = useText();
  const { copied, copy } = useCopy();
  const muted = String(useCSSVariable("--openbot-text-grouped-secondary"));
  const [eventsOpen, setEventsOpen] = useState(false);
  const update = (id: string, change: Partial<FilterDraft>) =>
    onFiltersChange(filters.map((item) => (item.id === id ? { ...item, ...change } : item)));
  const eventsSummary = [eventType.trim() || t("mobile.agent.webhook.eventsAll")];
  if (filters.length > 0) eventsSummary.push(t("mobile.agent.webhook.filterCount", { count: filters.length }));
  const copyIcon = (kind: "url" | "secret") =>
    copied === kind ? <Check size={18} color={muted} /> : <Copy size={18} color={muted} />;
  const Disclosure = eventsOpen ? ChevronDown : ChevronRight;
  const showEvents = eventsOpen || Boolean(eventType.trim()) || filters.length > 0;
  // A save that adds the trigger returns the secret before the refreshed routine brings its URL.
  const saved = url !== undefined || secret !== null;
  return (
    <SettingsSection
      title={t("mobile.agent.record.whenToRun")}
      footer={eventsOpen ? t("mobile.agent.record.eventFiltersHint") : undefined}
    >
      {header}
      {!saved ? (
        <View className="px-4 py-3">
          <CardNote>{t("mobile.agent.webhook.urlNew")}</CardNote>
        </View>
      ) : null}
      {saved ? (
        <ValueRow
          label={t("mobile.agent.webhook.url")}
          action={
            url ? (
              <IconAction
                label={t(copied === "url" ? "common.copied" : "mobile.agent.webhook.copyUrl")}
                onPress={() => copy("url", url)}
              >
                {copyIcon("url")}
              </IconAction>
            ) : null
          }
        >
          {url ? (
            // The row leaves out "https://" to show more of the path. Copy gives the full URL.
            <Typography.Paragraph type="body-sm" className="font-mono" numberOfLines={1} selectable>
              {url.replace(/^https:\/\//, "")}
            </Typography.Paragraph>
          ) : (
            <CardNote>{t("mobile.agent.webhook.urlPending")}</CardNote>
          )}
        </ValueRow>
      ) : null}
      {saved ? (
        <ValueRow
          label={t("mobile.agent.webhook.secret")}
          action={
            secret ? (
              <IconAction
                label={t(copied === "secret" ? "common.copied" : "mobile.agent.webhook.copySecret")}
                onPress={() => copy("secret", secret)}
              >
                {copyIcon("secret")}
              </IconAction>
            ) : onRotate ? (
              <IconAction
                label={t("mobile.agent.webhook.rotate")}
                disabled={disabled || rotatePending}
                onPress={() =>
                  Alert.alert(t("mobile.agent.webhook.rotateTitle"), t("mobile.agent.webhook.rotateBody"), [
                    { text: t("common.cancel"), style: "cancel" },
                    { text: t("mobile.agent.webhook.rotateConfirm"), style: "destructive", onPress: onRotate },
                  ])
                }
              >
                <RefreshCw size={18} color={muted} />
              </IconAction>
            ) : null
          }
        >
          {secret ? (
            <Typography.Paragraph type="body-sm" className="font-mono" selectable>
              {secret}
            </Typography.Paragraph>
          ) : (
            <Typography.Paragraph
              type="body-sm"
              className="font-mono text-grouped-secondary"
              accessibilityLabel={t("mobile.agent.webhook.secretHidden")}
            >
              {MASKED_WEBHOOK_SECRET}
            </Typography.Paragraph>
          )}
        </ValueRow>
      ) : null}
      {secret ? (
        <View className="flex-row items-center gap-3 py-2 pl-4 pr-2">
          <View className="min-w-0 flex-1">
            <CardNote className="text-warning-text">{t("mobile.agent.webhook.secretOnce")}</CardNote>
          </View>
          <Button variant="ghost" size="sm" onPress={onSecretDismiss}>
            <Button.Label>{t("common.done")}</Button.Label>
          </Button>
        </View>
      ) : null}
      {showEvents ? null : (
        <SettingsRow disclosure={false} disabled={disabled} onPress={() => setEventsOpen(true)}>
          <Typography.Paragraph type="body-sm" className="text-accent">
            {t("mobile.agent.webhook.filterEvents")}
          </Typography.Paragraph>
        </SettingsRow>
      )}
      {showEvents ? (
        <SettingsRow
          disclosure={false}
          expanded={eventsOpen}
          trailing={<Disclosure size={18} color={muted} strokeWidth={1.5} />}
          onPress={() => setEventsOpen((open) => !open)}
        >
          <Typography type="body-xs" className="text-grouped-secondary">
            {t("mobile.agent.webhook.events")}
          </Typography>
          <Typography.Paragraph type="body-sm" numberOfLines={1}>
            {eventsSummary.join(" · ")}
          </Typography.Paragraph>
        </SettingsRow>
      ) : null}
      {eventsOpen ? (
        <View className="gap-3 p-4">
          <SheetFormField
            appearance="soft"
            label={t("mobile.agent.record.eventType")}
            placeholder={t("mobile.agent.record.eventTypePlaceholder")}
            hint={t("mobile.agent.record.eventTypeHint")}
            value={eventType}
            editable={!disabled}
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={onEventTypeChange}
          />
          {filters.map((filter) => (
            <View key={filter.id} className="gap-2">
              <SheetFormField
                appearance="soft"
                label={t("mobile.agent.record.eventFilterPointer")}
                hint={
                  eventFilterPointerValid(filter.pointer)
                    ? undefined
                    : t("mobile.agent.record.eventFilterPointerInvalid")
                }
                value={filter.pointer}
                editable={!disabled}
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={(pointer) => update(filter.id, { pointer })}
              />
              <SheetFormField
                appearance="soft"
                label={t("mobile.agent.record.eventFilterValue")}
                hint={t("mobile.agent.record.eventFilterValueHint")}
                value={filter.value}
                editable={!disabled}
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={(value) => update(filter.id, { value })}
              />
              <Button
                variant="ghost"
                size="sm"
                className="self-start"
                isDisabled={disabled}
                onPress={() => onFiltersChange(filters.filter((item) => item.id !== filter.id))}
              >
                <Button.Label className="text-danger-text">{t("mobile.agent.record.removeEventFilter")}</Button.Label>
              </Button>
            </View>
          ))}
          <Button
            variant="ghost"
            size="sm"
            className="self-start"
            isDisabled={disabled}
            onPress={() => onFiltersChange([...filters, newFilterDraft()])}
          >
            <Button.Label>{t("mobile.agent.record.addEventFilter")}</Button.Label>
          </Button>
        </View>
      ) : null}
    </SettingsSection>
  );
}
