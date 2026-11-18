import type { AvatarColor, AvatarHue } from "@openbot/contracts/ipc";
import { Stack } from "expo-router";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import Check from "lucide-react-native/icons/check";
import EllipsisVertical from "lucide-react-native/icons/ellipsis-vertical";
import { memo, useLayoutEffect, useMemo, useRef } from "react";
import { View } from "react-native";
import { useCSSVariable, useUniwind } from "uniwind";
import { BloubAvatarThumbnail } from "@/features/agents/components/bloub-avatar";
import { SettingsRow } from "@/features/settings/components/settings-content";
import { MenuView } from "@/shared/components/menu-view";
import { isAndroid } from "@/shared/lib/platform";

// The row and the header menu of the agent search sheets: a channel's agents and a Vault item's agents.

// No workspace/activity subscriptions, animation frames, or live agent avatars in this row.
export const AgentChoiceRow = memo(function AgentChoiceRow({
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
export function AgentSelectAllMenu({
  label,
  selectAll,
  deselectAll,
  canSelect,
  canDeselect,
  onSelectAll,
  onDeselectAll,
}: {
  /** The labels come from the area of the screen that shows the menu. */
  label: string;
  selectAll: string;
  deselectAll: string;
  canSelect: boolean;
  canDeselect: boolean;
  onSelectAll: () => void;
  onDeselectAll: () => void;
}) {
  const { theme } = useUniwind();
  const foreground = String(useThemeColor("foreground"));
  const actions = useRef({ onSelectAll, onDeselectAll });
  useLayoutEffect(() => {
    actions.current = { onSelectAll, onDeselectAll };
  });
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
