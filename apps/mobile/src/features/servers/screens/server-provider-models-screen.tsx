import { type AgentModelId, isAgentProvider } from "@openbot/contracts/ipc";
import { Stack, useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import Check from "lucide-react-native/icons/check";
import EllipsisVertical from "lucide-react-native/icons/ellipsis-vertical";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { type NativeScrollEvent, type NativeSyntheticEvent, View } from "react-native";
import { useCSSVariable, useUniwind } from "uniwind";
import { useProviderModels } from "@/features/servers/model/use-provider-models";
import { useServerProviders } from "@/features/servers/model/use-server-providers";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { MenuView } from "@/shared/components/menu-view";
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
 * selected models are in their own section above the others. Each section keeps the order of the
 * first answer. The header menu selects or deselects all models, or resets the list to the default.
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
  // The search filters only the other models: the selected ones stay in view while the reader searches.
  const listed = useMemo(() => {
    const all = order.current.map((id) => ({ id, name: names.get(id) ?? id }));
    return [
      ...all.filter((model) => shown.has(model.id)),
      ...all.filter(
        (model) => !shown.has(model.id) && (!needle || `${model.name} ${model.id}`.toLowerCase().includes(needle)),
      ),
    ];
  }, [names, shown, needle]);
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
    if (end < END_DISTANCE && limit < listed.length) setLimit((current) => current + PAGE_SIZE);
  }

  function row(model: { id: AgentModelId; name: string }) {
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
  }

  const total = data.models.length;
  const visible = listed.slice(0, limit);
  const selectedRows = visible.filter((model) => shown.has(model.id));
  const otherRows = visible.filter((model) => !shown.has(model.id));
  const summary = `${t("mobile.server.providers.modelsSelected", { shown: shown.size, total })} ${t("mobile.server.providers.modelsHint")}`;
  return (
    // The native header holds the search field, which the Android blur header cannot draw.
    <SettingsContent androidNativeHeader onScroll={onScroll}>
      <Stack.Screen options={{ title: name ? t("mobile.server.providers.modelsTitle", { name }) : undefined }} />
      {total > 0 ? (
        <ModelsMenu
          canSelectAll={shown.size < total}
          canDeselectAll={shown.size > 0}
          canReset={data.changed}
          onSelectAll={() => models.change([...order.current])}
          onDeselectAll={() => models.change([])}
          onReset={models.reset}
        />
      ) : null}
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
          {selectedRows.length > 0 ? (
            <SettingsSection title={t("mobile.server.providers.modelsSectionSelected")} footer={summary}>
              {selectedRows.map(row)}
            </SettingsSection>
          ) : (
            <SettingsNote>{summary}</SettingsNote>
          )}
          {otherRows.length > 0 ? (
            <SettingsSection title={t("mobile.server.providers.modelsSectionOther")}>
              {otherRows.map(row)}
            </SettingsSection>
          ) : needle && shown.size < total && listed.length === shown.size ? (
            <SettingsNote>{t("mobile.server.providers.modelsNoMatch")}</SettingsNote>
          ) : null}
        </>
      )}
    </SettingsContent>
  );
}

interface ModelsMenuProps {
  canSelectAll: boolean;
  canDeselectAll: boolean;
  canReset: boolean;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onReset: () => void;
}

/**
 * The header menu of the Models page: Select all, Deselect all and Reset to default. Select all
 * shows only while a model is not selected, and Deselect all only while a model is selected. iOS
 * shows a native toolbar menu. Android shows a menu button in the right slot of the header.
 */
function ModelsMenu(props: ModelsMenuProps) {
  const { t } = useText();
  const { theme } = useUniwind();
  const foreground = String(useThemeColor("foreground"));
  const label = t("mobile.server.providers.modelsOptions");
  const selectAll = t("mobile.server.providers.modelsSelectAll");
  const deselectAll = t("mobile.server.providers.modelsDeselectAll");
  const reset = t("mobile.server.providers.modelsReset");
  const { canSelectAll, canDeselectAll, canReset } = props;
  // The header options change only when the menu looks different, as in `ProfileHeaderActions`.
  const actions = useRef(props);
  useLayoutEffect(() => {
    actions.current = props;
  });

  const androidOptions = useMemo(
    () => ({
      headerRight: () => (
        <MenuView
          colorScheme={theme === "dark" ? "dark" : "light"}
          actions={[
            ...(canSelectAll ? [{ id: "select-all", title: selectAll }] : []),
            ...(canDeselectAll ? [{ id: "deselect-all", title: deselectAll }] : []),
            { id: "reset", title: reset, attributes: { disabled: !canReset } },
          ]}
          onPressAction={({ nativeEvent }) => {
            void haptics.selection();
            if (nativeEvent.event === "select-all") actions.current.onSelectAll();
            if (nativeEvent.event === "deselect-all") actions.current.onDeselectAll();
            if (nativeEvent.event === "reset") actions.current.onReset();
          }}
        >
          <View
            accessible
            accessibilityRole="button"
            accessibilityLabel={label}
            className="size-12 items-center justify-center rounded-full"
          >
            <EllipsisVertical color={foreground} size={22} strokeWidth={2} />
          </View>
        </MenuView>
      ),
    }),
    [canDeselectAll, canReset, canSelectAll, deselectAll, foreground, label, reset, selectAll, theme],
  );

  if (isAndroid) return <Stack.Screen options={androidOptions} />;
  return (
    <Stack.Toolbar placement="right">
      <Stack.Toolbar.Menu icon="ellipsis" accessibilityLabel={label}>
        {canSelectAll ? (
          <Stack.Toolbar.MenuAction
            icon="checkmark.circle"
            onPress={() => {
              void haptics.selection();
              props.onSelectAll();
            }}
          >
            {selectAll}
          </Stack.Toolbar.MenuAction>
        ) : null}
        {canDeselectAll ? (
          <Stack.Toolbar.MenuAction
            icon="circle"
            onPress={() => {
              void haptics.selection();
              props.onDeselectAll();
            }}
          >
            {deselectAll}
          </Stack.Toolbar.MenuAction>
        ) : null}
        <Stack.Toolbar.MenuAction
          icon="arrow.counterclockwise"
          disabled={!canReset}
          onPress={() => {
            void haptics.selection();
            props.onReset();
          }}
        >
          {reset}
        </Stack.Toolbar.MenuAction>
      </Stack.Toolbar.Menu>
    </Stack.Toolbar>
  );
}
