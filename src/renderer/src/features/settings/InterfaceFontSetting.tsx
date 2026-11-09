import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createMemo, createSignal, onSettled } from "solid-js";
import { appPort } from "../../app-port";
import { setInterfaceFont, useInterfaceFont } from "../../interface-font-preference";

/** The value of the Default row. A family name cannot hold `$`, so it cannot collide with one. */
const DEFAULT_FONT = "$default";

function sameOptions(before: readonly string[], after: readonly string[]): boolean {
  return before.length === after.length && before.every((value, index) => value === after[index]);
}

export interface InterfaceFontSettingProps {
  /** The dialog element that the select portals into, as the other Settings selects receive it. */
  mount?: HTMLElement | undefined;
}

/**
 * The interface font row in Settings › General. The select lists the fonts installed on this
 * computer, and a choice applies to every window at once.
 */
export function InterfaceFontSetting(props: InterfaceFontSettingProps) {
  const { t } = useText();
  const saved = useInterfaceFont();
  const [families, setFamilies] = createSignal<string[]>([]);

  onSettled(() => {
    void appPort()
      .getInstalledFontFamilies()
      .then((names) => setFamilies(names))
      .catch(() => undefined);
  });

  // Kobalte takes a mutable array, and a new array makes it choose again, so the list changes only
  // when its values change. A saved family stays in the list while the folders are still read.
  const options = createMemo(
    (): string[] => {
      const family = saved();
      const names = families();
      return family !== null && !names.includes(family) ? [DEFAULT_FONT, family, ...names] : [DEFAULT_FONT, ...names];
    },
    { equals: sameOptions },
  );
  const label = (value: string | undefined) => {
    if (value === undefined) return "";
    return value === DEFAULT_FONT ? t("settings.interfaceFont.default") : value;
  };

  return (
    <Item data-settings-row="settings.interfaceFont.title" class="settings-modal-row">
      <ItemContent>
        <ItemTitle>{t("settings.interfaceFont.title")}</ItemTitle>
        <ItemDescription>{t("settings.interfaceFont.description")}</ItemDescription>
      </ItemContent>
      <ItemActions>
        <Select<string>
          class="settings-modal-select"
          options={options()}
          value={saved() ?? DEFAULT_FONT}
          // Kobalte reports the selected value again when the options change. Only a new choice is sent.
          onChange={(value) =>
            value !== undefined &&
            value !== (saved() ?? DEFAULT_FONT) &&
            setInterfaceFont(value === DEFAULT_FONT ? null : value)
          }
          placement="bottom-end"
          itemComponent={(itemProps) => <SelectItem item={itemProps.item}>{label(itemProps.item.rawValue)}</SelectItem>}
        >
          <SelectTrigger size="sm" aria-label={t("settings.interfaceFont.title")}>
            <SelectValue<string>>{(state) => label(state.selectedOption())}</SelectValue>
          </SelectTrigger>
          <SelectContent mount={props.mount} />
        </Select>
      </ItemActions>
    </Item>
  );
}
