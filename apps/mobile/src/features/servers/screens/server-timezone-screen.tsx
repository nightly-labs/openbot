import { useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import Check from "lucide-react-native/icons/check";
import { useMemo, useState } from "react";
import { useCSSVariable } from "uniwind";
import { knownTimeZones, matchTimeZones, timeZoneLabel } from "@/features/servers/model/time-zones";
import { useServerTimezone } from "@/features/servers/model/use-server-timezone";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

/** A search shows this many zones at most, so the page needs no virtualized list. */
const MATCH_LIMIT = 50;

/**
 * Server settings > Timezone: the zone of a routine that an agent creates when neither the tool call
 * nor the sender's message names one (`host-timezone-v1`). Without a search the page shows
 * Automatic, the saved zone, this phone's zone and UTC. The host checks the role and the zone again.
 */
export function ServerTimezoneScreen() {
  const { t, errorMessage } = useText();
  const accent = String(useCSSVariable("--openbot-accent"));
  const { serverId } = useLocalSearchParams<{ serverId: string }>();
  const { available, query, save } = useServerTimezone(serverId);
  const [search, setSearch] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const zones = useMemo(knownTimeZones, []);
  const settings = query.data;
  if (!available || !settings)
    return (
      <SettingsContent>
        <SettingsNote>
          {!available
            ? t("mobile.server.settings.timezoneUnavailable")
            : query.isError
              ? errorMessage(query.error, t("mobile.server.settings.timezoneLoadFailed"))
              : t("mobile.server.settings.timezoneLoading")}
        </SettingsNote>
      </SettingsContent>
    );
  const phoneZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const suggested = [...new Set([settings.timezone, phoneZone, "UTC"].filter((zone): zone is string => Boolean(zone)))];
  const results = search.trim() ? matchTimeZones(zones, search, MATCH_LIMIT) : null;

  function choose(zone: string | null) {
    if (pending !== null || zone === settings?.timezone) return;
    void haptics.selection();
    setPending(zone ?? "");
    setError(null);
    save(zone)
      .then(() => {
        void haptics.notification("success");
      })
      .catch((cause: unknown) => {
        void haptics.notification("error");
        setError(errorMessage(cause, t("mobile.server.settings.timezoneSaveFailed")));
      })
      .finally(() => setPending(null));
  }

  const row = (zone: string | null, label: string, supportingText?: string) => {
    const selected = zone === settings.timezone;
    return (
      <SettingsRow
        key={zone ?? ""}
        checked={selected}
        disabled={pending !== null}
        disclosure={false}
        supportingText={supportingText}
        trailing={selected ? <Check size={18} color={accent} strokeWidth={2} /> : null}
        onPress={() => choose(zone)}
      >
        <Typography.Paragraph numberOfLines={1}>{label}</Typography.Paragraph>
      </SettingsRow>
    );
  };

  return (
    <SettingsContent>
      <SheetFormField
        label={t("mobile.server.settings.timezoneSearch")}
        hideLabel
        placeholder={t("mobile.server.settings.timezoneSearch")}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        value={search}
        onChangeText={setSearch}
      />
      {error ? (
        <Typography.Paragraph accessibilityRole="alert" type="body-xs" className="-mt-4 px-4 text-danger-text">
          {error}
        </Typography.Paragraph>
      ) : null}
      {results ? (
        <SettingsSection
          footer={
            results.length === 0
              ? t("mobile.server.settings.timezoneNoMatch")
              : results.length === MATCH_LIMIT
                ? t("mobile.server.settings.timezoneMore")
                : undefined
          }
        >
          {results.map((zone) => row(zone, timeZoneLabel(zone)))}
        </SettingsSection>
      ) : (
        <SettingsSection footer={t("mobile.server.settings.timezoneDescription")}>
          {row(
            null,
            t("mobile.server.settings.timezoneAutomatic"),
            t("mobile.server.settings.timezoneSystem", { zone: timeZoneLabel(settings.systemTimezone) }),
          )}
          {suggested.map((zone) =>
            row(zone, timeZoneLabel(zone), zone === phoneZone ? t("mobile.server.settings.timezonePhone") : undefined),
          )}
        </SettingsSection>
      )}
    </SettingsContent>
  );
}
