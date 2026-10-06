import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { Typography } from "heroui-native";
import { useState, useSyncExternalStore } from "react";
import { Alert, Linking } from "react-native";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { formatSupportLogEntry, type SupportLogLevel, supportLog } from "@/features/support/model/support-log";
import { clearSupportLog, supportLogFileText } from "@/features/support/model/support-log-capture";
import { useText } from "@/shared/lib/text";

/** The OpenBot account, the same contact as the website. */
const SUPPORT_X_HANDLE = "@OpenBot_";
const SUPPORT_X_URL = "https://x.com/OpenBot_";
const ISSUES_URL = "https://github.com/nightly-labs/openbot/issues/new";
/** The screen shows the newest events. The saved file has all of them. */
const SHOWN_ENTRIES = 100;
const LEVEL_CLASS = {
  info: "text-grouped-secondary",
  warn: "text-warning-text",
  error: "text-danger-text",
} as const satisfies Record<SupportLogLevel, string>;

export function SupportSettingsScreen() {
  const { t } = useText();
  const entries = useSyncExternalStore(supportLog.subscribe, supportLog.entries);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function open(url: string) {
    setLinkError(null);
    void Linking.openURL(url).catch(() => setLinkError(t("mobile.settings.about.openFailed")));
  }

  async function save() {
    setSaveError(null);
    if (!(await Sharing.isAvailableAsync())) {
      setSaveError(t("mobile.settings.support.sharingUnavailable"));
      return;
    }
    setSaving(true);
    const file = new File(Paths.cache, `openbot-support-log-${new Date().toISOString().replace(/[:.]/gu, "-")}.txt`);
    try {
      file.write(supportLogFileText());
      await Sharing.shareAsync(file.uri, {
        mimeType: "text/plain",
        UTI: "public.plain-text",
        dialogTitle: t("mobile.settings.support.save"),
      });
    } catch {
      setSaveError(t("mobile.settings.support.saveFailed"));
    } finally {
      if (file.exists) file.delete();
      setSaving(false);
    }
  }

  function clear() {
    Alert.alert(t("mobile.settings.support.clearTitle"), t("mobile.settings.support.clearBody"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("mobile.settings.support.clear"), style: "destructive", onPress: clearSupportLog },
    ]);
  }

  return (
    <SettingsContent>
      <SettingsSection title={t("mobile.settings.support.help")} footer={t("mobile.settings.support.helpFooter")}>
        <SettingsRow onPress={() => open(ISSUES_URL)}>
          <Typography.Paragraph type="body-sm">{t("mobile.settings.support.issues")}</Typography.Paragraph>
        </SettingsRow>
        <SettingsRow onPress={() => open(SUPPORT_X_URL)} supportingText={SUPPORT_X_HANDLE}>
          <Typography.Paragraph type="body-sm">{t("mobile.settings.support.message")}</Typography.Paragraph>
        </SettingsRow>
        {linkError ? <SettingsNote>{linkError}</SettingsNote> : null}
      </SettingsSection>
      <SettingsSection title={t("mobile.settings.support.log")} footer={t("mobile.settings.support.logFooter")}>
        <SettingsRow
          onPress={() => void save()}
          disabled={saving}
          disclosure={false}
          supportingText={t("mobile.settings.support.events", { count: entries.length })}
        >
          <Typography.Paragraph type="body-sm">{t("mobile.settings.support.save")}</Typography.Paragraph>
        </SettingsRow>
        <SettingsRow onPress={clear} disabled={entries.length === 0} disclosure={false}>
          <Typography.Paragraph type="body-sm" className="text-danger-text">
            {t("mobile.settings.support.clear")}
          </Typography.Paragraph>
        </SettingsRow>
        {saveError ? <SettingsNote>{saveError}</SettingsNote> : null}
      </SettingsSection>
      <SettingsSection title={t("mobile.settings.support.recent")} footer={t("mobile.settings.support.recentFooter")}>
        <SettingsRow>
          {entries.length === 0 ? (
            <Typography.Paragraph type="body-xs" className="text-grouped-secondary">
              {t("mobile.settings.support.empty")}
            </Typography.Paragraph>
          ) : (
            entries
              .slice(-SHOWN_ENTRIES)
              .reverse()
              .map((entry) => (
                <Typography.Paragraph
                  key={entry.id}
                  type="body-xs"
                  className={`font-mono ${LEVEL_CLASS[entry.level]}`}
                  selectable
                >
                  {formatSupportLogEntry(entry)}
                </Typography.Paragraph>
              ))
          )}
        </SettingsRow>
      </SettingsSection>
    </SettingsContent>
  );
}
