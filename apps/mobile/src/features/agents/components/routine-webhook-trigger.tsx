import { type EventFilter, type EventScalar, isEventFilterPointer } from "@openbot/contracts/ipc-events";
import * as Clipboard from "expo-clipboard";
import { Typography } from "heroui-native";
import { useState } from "react";
import { Alert, View } from "react-native";
import { SettingsNote, SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

/** A filter row in the form. The ID keeps the row and its inputs mounted while the user types. */
export interface FilterDraft {
  id: string;
  pointer: string;
  value: string;
}

let nextFilterId = 0;

export function newFilterDraft(): FilterDraft {
  nextFilterId += 1;
  return { id: `new-${nextFilterId}`, pointer: "", value: "" };
}

function isScalar(value: unknown): value is EventScalar {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

/** The scalar that the text is as JSON, or undefined when the text is not a JSON scalar. */
function parseScalar(text: string): EventScalar | undefined {
  try {
    const parsed = JSON.parse(text);
    return isScalar(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Text that reads back as the same value: a string that is also a JSON scalar gets quotes. */
function filterValueText(value: EventScalar): string {
  if (typeof value === "string") return parseScalar(value) === undefined ? value : JSON.stringify(value);
  return JSON.stringify(value);
}

function filterValue(text: string): EventScalar {
  const parsed = parseScalar(text.trim());
  return parsed === undefined ? text : parsed;
}

/** Saved filters get IDs from their position, so the rows stay mounted until the user edits them. */
export function filterDrafts(filters: readonly EventFilter[]): FilterDraft[] {
  return filters.map((filter, index) => ({
    id: `saved-${index}`,
    pointer: filter.pointer,
    value: filterValueText(filter.value),
  }));
}

export function eventFilters(drafts: readonly FilterDraft[]): EventFilter[] {
  return drafts.map((draft) => ({ pointer: draft.pointer.trim(), value: filterValue(draft.value) }));
}

export function filtersValid(drafts: readonly FilterDraft[]): boolean {
  return drafts.every((draft) => isEventFilterPointer(draft.pointer.trim()));
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
      .catch(() => {
        void haptics.notification("error");
        Alert.alert(t("mobile.agent.webhook.copyFailed"));
      });
  }
  return { copied, copy };
}

/**
 * The webhook part of a routine. The host makes the URL and the signing secret; the user never
 * types the inbound secret. `url` is undefined before the routine has a saved webhook trigger.
 */
export function RoutineWebhookTrigger({
  url,
  secret,
  eventType,
  filters,
  disabled,
  rotatePending,
  onEventTypeChange,
  onFiltersChange,
  onRotate,
}: {
  url: string | null | undefined;
  secret: string | null;
  eventType: string;
  filters: FilterDraft[];
  disabled: boolean;
  rotatePending: boolean;
  onEventTypeChange: (value: string) => void;
  onFiltersChange: (filters: FilterDraft[]) => void;
  onRotate?: () => void;
}) {
  const { t } = useText();
  const { copied, copy } = useCopy();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const update = (id: string, change: Partial<FilterDraft>) =>
    onFiltersChange(filters.map((item) => (item.id === id ? { ...item, ...change } : item)));
  return (
    <>
      <SettingsSection title={t("mobile.agent.record.trigger.webhook")}>
        {url ? (
          <SettingsRow supportingText={t("mobile.agent.webhook.url")}>
            <Typography.Paragraph type="body-sm" selectable>
              {url}
            </Typography.Paragraph>
          </SettingsRow>
        ) : (
          <SettingsNote>
            {t(url === null ? "mobile.agent.webhook.urlPending" : "mobile.agent.webhook.urlNew")}
          </SettingsNote>
        )}
        {url ? (
          <SettingsRow disclosure={false} onPress={() => copy("url", url)}>
            <Typography.Paragraph className="text-accent">
              {t(copied === "url" ? "common.copied" : "mobile.agent.webhook.copyUrl")}
            </Typography.Paragraph>
          </SettingsRow>
        ) : null}
        {secret ? (
          <SettingsRow supportingText={t("mobile.agent.webhook.secretOnce")}>
            <Typography type="body-xs" className="text-grouped-secondary">
              {t("mobile.agent.webhook.secret")}
            </Typography>
            <Typography.Paragraph type="body-sm" selectable>
              {secret}
            </Typography.Paragraph>
          </SettingsRow>
        ) : null}
        {secret ? (
          <SettingsRow disclosure={false} onPress={() => copy("secret", secret)}>
            <Typography.Paragraph className="text-accent">
              {t(copied === "secret" ? "common.copied" : "mobile.agent.webhook.copySecret")}
            </Typography.Paragraph>
          </SettingsRow>
        ) : null}
        {onRotate ? (
          <SettingsRow
            disclosure={false}
            disabled={disabled || rotatePending}
            onPress={() =>
              Alert.alert(t("mobile.agent.webhook.rotateTitle"), t("mobile.agent.webhook.rotateBody"), [
                { text: t("common.cancel"), style: "cancel" },
                { text: t("mobile.agent.webhook.rotateConfirm"), style: "destructive", onPress: onRotate },
              ])
            }
          >
            <Typography.Paragraph className="text-danger-text">{t("mobile.agent.webhook.rotate")}</Typography.Paragraph>
          </SettingsRow>
        ) : null}
      </SettingsSection>
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
      <SettingsSection footer={filtersOpen ? t("mobile.agent.record.eventFiltersHint") : undefined}>
        <SettingsRow
          disclosure={false}
          onPress={() => setFiltersOpen((open) => !open)}
          trailing={
            <Typography type="body-sm" className="text-grouped-secondary">
              {filters.length}
            </Typography>
          }
        >
          <Typography.Paragraph>{t("mobile.agent.record.eventFilters")}</Typography.Paragraph>
        </SettingsRow>
        {filtersOpen
          ? filters.map((filter) => (
              <View key={filter.id} className="gap-2 p-4">
                <SheetFormField
                  appearance="soft"
                  label={t("mobile.agent.record.eventFilterPointer")}
                  hint={
                    isEventFilterPointer(filter.pointer.trim())
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
                <SettingsRow
                  disclosure={false}
                  disabled={disabled}
                  onPress={() => onFiltersChange(filters.filter((item) => item.id !== filter.id))}
                >
                  <Typography.Paragraph className="text-danger-text">
                    {t("mobile.agent.record.removeEventFilter")}
                  </Typography.Paragraph>
                </SettingsRow>
              </View>
            ))
          : null}
        {filtersOpen ? (
          <SettingsRow
            disclosure={false}
            disabled={disabled}
            onPress={() => onFiltersChange([...filters, newFilterDraft()])}
          >
            <Typography.Paragraph className="text-accent">
              {t("mobile.agent.record.addEventFilter")}
            </Typography.Paragraph>
          </SettingsRow>
        ) : null}
      </SettingsSection>
    </>
  );
}
