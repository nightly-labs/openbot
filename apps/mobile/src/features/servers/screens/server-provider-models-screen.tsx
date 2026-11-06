import { type AgentModelId, isAgentProvider } from "@openbot/contracts/ipc";
import { Stack, useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import Check from "lucide-react-native/icons/check";
import { useMemo, useRef, useState } from "react";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import { useCSSVariable } from "uniwind";
import { useProviderModels } from "@/features/servers/model/use-provider-models";
import { useServerProviders } from "@/features/servers/model/use-server-providers";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { haptics } from "@/shared/lib/haptics";
import { isAndroid } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";

/** The page adds this many rows at a time, so a provider with a thousand models opens at once. */
const PAGE_SIZE = 100;
/** The next rows come when the reader is this close to the end. */
const END_DISTANCE = 600;

/**
 * Server settings > Providers > a provider > Models: every model of the provider, and the ones that
 * the model picker of the server shows (`model-visibility-v1`). Agents still reach every model. The
 * shown models come first, in the order of the first answer, and keep their place while the reader
 * changes them, as on desktop.
 */
export function ServerProviderModelsScreen() {
  const { t, errorMessage } = useText();
  const accent = String(useCSSVariable("--openbot-accent"));
  const [foreground, muted] = useThemeColor(["foreground", "muted"]);
  const params = useLocalSearchParams<{ serverId: string; provider: string }>();
  const serverId = params.serverId;
  const provider = isAgentProvider(params.provider) ? params.provider : null;
  const { available, admin, rows } = useServerProviders(serverId);
  const models = useProviderModels(serverId, provider, admin);
  const data = models.list.data;
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const order = useRef<readonly AgentModelId[]>([]);
  order.current = useMemo(() => {
    if (!data) return order.current;
    const listed = new Set(data.models.map((model) => model.id));
    const kept = order.current.filter((id) => listed.has(id));
    const placed = new Set(kept);
    const shown = new Set(data.shown);
    const added = data.models.map((model) => model.id).filter((id) => !placed.has(id));
    // Only the first answer, or models that came later, are sorted by their state.
    return [...kept, ...added.filter((id) => shown.has(id)), ...added.filter((id) => !shown.has(id))];
  }, [data]);
  const names = useMemo(() => new Map((data?.models ?? []).map((model) => [model.id, model.name])), [data]);
  const shown = useMemo(() => new Set(data?.shown ?? []), [data]);
  const needle = search.trim().toLowerCase();
  const matches = useMemo(
    () =>
      order.current
        .map((id) => ({ id, name: names.get(id) ?? id }))
        .filter((model) => !needle || `${model.name} ${model.id}`.toLowerCase().includes(needle)),
    [names, needle],
  );
  const name = rows.find((row) => row.id === provider)?.name;

  if (!available || !admin || !provider || !models.available || !data)
    return (
      <SettingsContent>
        <SettingsNote>
          {!available || !provider || (admin && !models.available)
            ? t("mobile.server.providers.unavailable")
            : models.list.isError
              ? errorMessage(models.list.error, t("mobile.server.providers.modelsLoadFailed"))
              : t("mobile.server.providers.modelsLoading")}
        </SettingsNote>
      </SettingsContent>
    );

  function toggle(id: AgentModelId) {
    void haptics.selection();
    const on = !shown.has(id);
    models.change(order.current.filter((candidate) => (candidate === id ? on : shown.has(candidate))));
  }

  function onScroll({ nativeEvent }: NativeSyntheticEvent<NativeScrollEvent>) {
    const end = nativeEvent.contentSize.height - nativeEvent.layoutMeasurement.height - nativeEvent.contentOffset.y;
    if (end < END_DISTANCE && limit < matches.length) setLimit((current) => current + PAGE_SIZE);
  }

  const total = data.models.length;
  return (
    // The native header holds the search field, which the Android blur header cannot draw.
    <SettingsContent androidNativeHeader onScroll={onScroll}>
      <Stack.Screen options={{ title: name ? t("mobile.server.providers.modelsTitle", { name }) : undefined }} />
      <Stack.SearchBar
        placeholder={t("mobile.server.providers.modelsSearch")}
        autoCapitalize="none"
        hideWhenScrolling={false}
        // In a sheet, the header and its back button stay while the search has focus.
        hideNavigationBar={false}
        // The native Android search view draws black icons and text in both themes.
        {...(isAndroid
          ? { headerIconColor: String(foreground), textColor: String(foreground), hintTextColor: String(muted) }
          : {})}
        onChangeText={(event) => {
          setSearch(event.nativeEvent.text);
          setLimit(PAGE_SIZE);
        }}
        onCancelButtonPress={() => setSearch("")}
        onClose={() => setSearch("")}
      />
      {models.error ? (
        <Typography.Paragraph accessibilityRole="alert" type="body-xs" className="px-4 text-danger-text">
          {models.error}
        </Typography.Paragraph>
      ) : null}
      {total === 0 ? (
        <SettingsNote>{t("mobile.server.providers.modelsNone")}</SettingsNote>
      ) : (
        <>
          <SettingsSection
            footer={`${t("mobile.server.providers.modelsSelected", { shown: shown.size, total })} ${t("mobile.server.providers.modelsHint")}`}
          >
            <SettingsRow disclosure={false} onPress={() => models.change(shown.size === 0 ? [...order.current] : [])}>
              <Typography.Paragraph className="text-accent">
                {t(
                  shown.size === 0 ? "mobile.server.providers.modelsShowAll" : "mobile.server.providers.modelsHideAll",
                )}
              </Typography.Paragraph>
            </SettingsRow>
            {data.changed ? (
              <SettingsRow disclosure={false} onPress={models.reset}>
                <Typography.Paragraph className="text-accent">
                  {t("mobile.server.providers.modelsReset")}
                </Typography.Paragraph>
              </SettingsRow>
            ) : null}
          </SettingsSection>
          {matches.length === 0 ? (
            <SettingsNote>{t("mobile.server.providers.modelsNoMatch")}</SettingsNote>
          ) : (
            <SettingsSection>
              {matches.slice(0, limit).map((model) => {
                const on = shown.has(model.id);
                return (
                  <SettingsRow
                    key={model.id}
                    checked={on}
                    multiple
                    disclosure={false}
                    supportingText={model.name === model.id ? undefined : model.id}
                    trailing={on ? <Check size={18} color={accent} strokeWidth={2} /> : null}
                    onPress={() => toggle(model.id)}
                  >
                    <Typography.Paragraph numberOfLines={1}>{model.name}</Typography.Paragraph>
                  </SettingsRow>
                );
              })}
            </SettingsSection>
          )}
        </>
      )}
    </SettingsContent>
  );
}
