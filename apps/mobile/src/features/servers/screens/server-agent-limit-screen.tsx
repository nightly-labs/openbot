import { useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import { useRef, useState } from "react";
import { useServerAgentLimit } from "@/features/servers/model/use-server-agent-limit";
import { SettingsContent, SettingsNote } from "@/features/settings/components/settings-content";
import { SheetCloseAction } from "@/shared/components/sheet-close-action";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { SheetSaveAction } from "@/shared/components/sheet-save-action";
import { SheetScrollView } from "@/shared/components/sheet-scroll-view";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

export function ServerAgentLimitScreen() {
  const { t, errorMessage, format } = useText();
  const { serverId } = useLocalSearchParams<{ serverId: string }>();
  const { available, query, save } = useServerAgentLimit(serverId);
  const settings = query.data;
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [triedSave, setTriedSave] = useState(false);
  const pending = useRef(false);
  if (!available || !settings) {
    return (
      <SettingsContent>
        <SettingsNote>
          {!available
            ? t("mobile.server.settings.agentLimitUnavailable")
            : query.isError
              ? errorMessage(query.error, t("mobile.server.settings.agentLimitLoadFailed"))
              : t("mobile.server.settings.agentLimitLoading")}
        </SettingsNote>
      </SettingsContent>
    );
  }
  const field = draft ?? (settings.limit === null ? "" : `${settings.limit}`);
  const parsed = field.trim() === "" ? null : Number(field.trim());
  const valid = parsed === null || (Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= settings.maxLimit);
  const dirty = parsed !== settings.limit;

  async function submit(): Promise<void> {
    if (!valid || !dirty || pending.current) {
      if (!valid) {
        setTriedSave(true);
        void haptics.notification("error");
      }
      return;
    }
    pending.current = true;
    setSaving(true);
    setError(null);
    try {
      await save(parsed);
      void haptics.notification("success");
      setDraft(null);
      setTriedSave(false);
    } catch (cause) {
      void haptics.notification("error");
      setError(errorMessage(cause, t("mobile.server.settings.agentLimitSaveFailed")));
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  return (
    <SheetScrollView
      className="bg-sheet"
      contentContainerClassName="gap-5 px-5 pb-safe-offset-5 pt-5"
      contentInsetAdjustmentBehavior="automatic"
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
    >
      <SheetCloseAction
        disabled={saving}
        onPress={() => {
          void haptics.impact("soft");
          setDraft(null);
          setTriedSave(false);
        }}
      />
      <SheetSaveAction
        dirty={dirty}
        canSave={valid}
        pending={saving}
        label={t("common.save")}
        pendingLabel={t("common.saving")}
        onSave={() => void submit()}
      />
      <SheetFormField
        editable={!saving}
        inputMode="numeric"
        label={t("mobile.server.settings.agentLimit")}
        placeholder={t("mobile.server.settings.agentLimitDefault", { count: format.number(settings.defaultLimit) })}
        value={field}
        error={
          triedSave && !valid
            ? t("mobile.server.settings.agentLimitInvalid", { max: format.number(settings.maxLimit) })
            : undefined
        }
        onChangeText={setDraft}
      />
      <Typography.Paragraph type="body-xs" className="px-4 text-text-secondary">
        {t("mobile.server.settings.agentLimitDescription", { max: format.number(settings.maxLimit) })}
      </Typography.Paragraph>
      {error ? (
        <Typography.Paragraph accessibilityRole="alert" align="center" className="text-danger-text">
          {error}
        </Typography.Paragraph>
      ) : null}
    </SheetScrollView>
  );
}
