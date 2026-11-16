import { Typography } from "heroui-native";
import ChevronsUpDown from "lucide-react-native/icons/chevrons-up-down";
import { View } from "react-native";
import { useCSSVariable } from "uniwind";
import { type MenuAction, MenuView } from "@/shared/components/menu-view";
import { haptics } from "@/shared/lib/haptics";

/** The id of the extra item after the levels. A level id never starts with "__". */
const EXTRA_ID = "__extra";

export interface AccessLevelOption<T extends string> {
  value: T;
  label: string;
  /** True: the item shows, but it is off. */
  disabled?: boolean;
}

/**
 * A level menu at the end of a row, such as the access of a role to an agent. Unlike
 * `SettingsPicker`, a choice of the shown level also calls `onChange`: the shown level can come from
 * Everyone, and a choice of it clears the level that the role stores. `source` follows the level, as
 * in "Can manage · Everyone". `extra` is an action after the levels, such as "Change in Everyone".
 */
export function AccessLevelMenu<T extends string>({
  value,
  options,
  source,
  enabled,
  dark,
  label,
  placeholder,
  extra,
  onChange,
}: {
  /** The shown level, or undefined for a mixed set. */
  value: T | undefined;
  options: AccessLevelOption<T>[];
  source?: string | undefined;
  enabled: boolean;
  dark: boolean;
  label: string;
  /** Shown when `value` is undefined. */
  placeholder?: string;
  extra?: { label: string; onPress: () => void } | undefined;
  onChange: (value: T) => void;
}) {
  const muted = String(useCSSVariable("--openbot-text-grouped-secondary"));
  const selected = options.find((option) => option.value === value);
  const text = selected ? (source ? `${selected.label} · ${source}` : selected.label) : (placeholder ?? "");
  const levels: MenuAction[] = options.map((option) => ({
    id: option.value,
    title: option.label,
    state: option.value === value ? "on" : "off",
    attributes: { disabled: !enabled || option.disabled === true },
  }));
  const actions: MenuAction[] = extra
    ? [
        { id: "__levels", title: "", displayInline: true, subactions: levels },
        {
          id: "__extraSection",
          title: "",
          displayInline: true,
          subactions: [{ id: EXTRA_ID, title: extra.label, attributes: { disabled: !enabled } }],
        },
      ]
    : levels;
  return (
    <MenuView
      colorScheme={dark ? "dark" : "light"}
      actions={actions}
      onPressAction={({ nativeEvent }) => {
        if (!enabled) return;
        if (nativeEvent.event === EXTRA_ID) {
          extra?.onPress();
          return;
        }
        const next = options.find((option) => option.value === nativeEvent.event);
        if (!next || next.disabled) return;
        void haptics.selection();
        onChange(next.value);
      }}
    >
      <View
        accessible
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityValue={{ text }}
        accessibilityState={{ disabled: !enabled }}
        className="min-h-11 max-w-56 flex-row items-center gap-1"
        style={{ opacity: enabled ? 1 : 0.45 }}
      >
        <Typography.Paragraph className="min-w-0 shrink text-grouped-secondary" numberOfLines={1}>
          {text}
        </Typography.Paragraph>
        <ChevronsUpDown color={muted} size={16} strokeWidth={1.75} />
      </View>
    </MenuView>
  );
}
