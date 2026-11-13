import type { AvatarColor, AvatarHue } from "@openbot/contracts/ipc";
import { router, Stack } from "expo-router";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import Check from "lucide-react-native/icons/check";
import EllipsisVertical from "lucide-react-native/icons/ellipsis-vertical";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { useCSSVariable, useUniwind } from "uniwind";
import { BloubAvatarThumbnail } from "@/features/agents/components/bloub-avatar";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { useMobileWorkspaceSelector } from "@/features/workspace/context/mobile-workspace-context";
import { MenuView } from "@/shared/components/menu-view";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { haptics } from "@/shared/lib/haptics";
import { isAndroid, isIOS } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";
import { useChannelAgentPicker } from "../model/channel-agent-picker";

// No workspace/activity subscriptions, animation frames, or live agent avatars in this row.
const MemberChoice = memo(function MemberChoice({
  id,
  name,
  serverId,
  avatarSeed,
  avatarHue,
  avatarColor,
  selected,
  onToggle,
}: {
  id: string;
  name: string;
  serverId: string;
  avatarSeed: string;
  avatarHue: AvatarHue | null;
  avatarColor: AvatarColor | null;
  selected: boolean;
  onToggle: (id: string) => void;
}) {
  const accent = String(useCSSVariable("--openbot-accent"));
  return (
    <SettingsRow
      checked={selected}
      multiple
      disclosure={false}
      leading={
        <BloubAvatarThumbnail
          agentId={id}
          serverId={serverId}
          seed={avatarSeed}
          hue={avatarHue}
          color={avatarColor}
          size={32}
        />
      }
      trailing={selected ? <Check size={18} color={accent} strokeWidth={2} /> : null}
      onPress={() => onToggle(id)}
    >
      <Typography.Paragraph numberOfLines={1}>{name}</Typography.Paragraph>
    </SettingsRow>
  );
});

/**
 * The header menu of the list: select or deselect all the agents that the search shows. The Android
 * header options change only when the menu looks different, so typing in the search does not rebuild it.
 */
function SelectAllMenu({
  canSelect,
  canDeselect,
  onSelectAll,
  onDeselectAll,
}: {
  canSelect: boolean;
  canDeselect: boolean;
  onSelectAll: () => void;
  onDeselectAll: () => void;
}) {
  const { t } = useText();
  const { theme } = useUniwind();
  const foreground = String(useThemeColor("foreground"));
  const actions = useRef({ onSelectAll, onDeselectAll });
  useLayoutEffect(() => {
    actions.current = { onSelectAll, onDeselectAll };
  });
  const label = t("mobile.channel.form.agentOptions");
  const selectAll = t("mobile.channel.form.selectAll");
  const deselectAll = t("mobile.channel.form.deselectAll");
  const androidOptions = useMemo(
    () => ({
      headerRight: () => (
        <MenuView
          colorScheme={theme === "dark" ? "dark" : "light"}
          actions={[
            { id: "select-all", title: selectAll, attributes: { disabled: !canSelect } },
            { id: "deselect-all", title: deselectAll, attributes: { disabled: !canDeselect } },
          ]}
          onPressAction={({ nativeEvent }) => {
            if (nativeEvent.event === "select-all") actions.current.onSelectAll();
            if (nativeEvent.event === "deselect-all") actions.current.onDeselectAll();
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
    [canDeselect, canSelect, deselectAll, foreground, label, selectAll, theme],
  );
  if (isAndroid) return <Stack.Screen options={androidOptions} />;
  return (
    <Stack.Toolbar placement="right">
      <Stack.Toolbar.Menu icon="ellipsis" accessibilityLabel={label}>
        <Stack.Toolbar.MenuAction icon="checkmark.circle" disabled={!canSelect} onPress={onSelectAll}>
          {selectAll}
        </Stack.Toolbar.MenuAction>
        <Stack.Toolbar.MenuAction icon="circle" disabled={!canDeselect} onPress={onDeselectAll}>
          {deselectAll}
        </Stack.Toolbar.MenuAction>
      </Stack.Toolbar.Menu>
    </Stack.Toolbar>
  );
}

/** Channel info > Agents, and New channel > Agents: the agents of the server, with a search. */
export function ChannelAgentPickerScreen() {
  const { t } = useText();
  const request = useChannelAgentPicker((state) => state.request);
  const [selected, setSelected] = useState(() => new Set(request?.members ?? []));
  const [search, setSearch] = useState("");
  const serverId = request?.serverId ?? "";
  const agents = useMobileWorkspaceSelector((current) => current.agents);
  const choices = useMemo(() => agents.filter((agent) => agent.serverId === serverId), [agents, serverId]);
  // Only the Agents row opens the page. Without its request there is no form to give the change to.
  useEffect(() => {
    if (!request && router.canGoBack()) router.back();
  }, [request]);
  const words = search.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  const matches = choices.filter((agent) => {
    const text = `${agent.name} ${agent.title}`.toLocaleLowerCase();
    return words.every((word) => text.includes(word));
  });
  const availableIds = new Set(choices.map((agent) => agent.id));
  const unavailable = [...selected].filter((id) => !availableIds.has(id));
  const toggle = (id: string) => {
    request?.toggle(id);
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  };
  // With a search, the menu acts on the agents that the search shows.
  const toSelect = matches.filter((agent) => !selected.has(agent.id));
  const toDeselect = matches.filter((agent) => selected.has(agent.id));
  const toggleAll = (agents: readonly { id: string }[]) => {
    if (!agents.length) return;
    void haptics.selection();
    for (const agent of agents) toggle(agent.id);
  };

  return (
    <SettingsContent>
      <Stack.Screen options={{ title: t("mobile.channel.form.agents") }} />
      {request && choices.length > 0 ? (
        <SelectAllMenu
          canSelect={toSelect.length > 0}
          canDeselect={toDeselect.length > 0}
          onSelectAll={() => toggleAll(toSelect)}
          onDeselectAll={() => toggleAll(toDeselect)}
        />
      ) : null}
      {isIOS ? (
        <Stack.SearchBar
          placeholder={t("mobile.channel.form.searchAgents")}
          autoCapitalize="none"
          hideWhenScrolling={false}
          // In a sheet, the header and its back button stay while the search has focus.
          hideNavigationBar={false}
          onChangeText={(event) => setSearch(event.nativeEvent.text)}
          onCancelButtonPress={() => setSearch("")}
        />
      ) : (
        // The Android blur header cannot draw a `Stack.SearchBar`, so the field is in the content.
        <SheetFormField
          label={t("mobile.channel.form.searchAgents")}
          hideLabel
          appearance="soft"
          placeholder={t("mobile.channel.form.searchAgents")}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          value={search}
          onChangeText={setSearch}
        />
      )}
      {!request ? null : choices.length === 0 ? (
        <SettingsNote>{t("mobile.channel.form.noAgents")}</SettingsNote>
      ) : matches.length === 0 ? (
        <SettingsNote>{t("mobile.channel.form.noMatches")}</SettingsNote>
      ) : (
        <SettingsSection>
          {matches.map((agent) => (
            <MemberChoice
              key={agent.id}
              id={agent.id}
              name={agent.name}
              serverId={agent.serverId}
              avatarSeed={agent.avatarSeed}
              avatarHue={agent.avatarHue}
              avatarColor={agent.avatarColor}
              selected={selected.has(agent.id)}
              onToggle={toggle}
            />
          ))}
        </SettingsSection>
      )}
      {request && unavailable.length > 0 ? (
        <SettingsSection>
          {unavailable.map((id) => (
            <SettingsRow key={id} disclosure={false} onPress={() => toggle(id)}>
              <Typography.Paragraph>{t("mobile.channel.form.removeUnavailable")}</Typography.Paragraph>
            </SettingsRow>
          ))}
        </SettingsSection>
      ) : null}
    </SettingsContent>
  );
}
