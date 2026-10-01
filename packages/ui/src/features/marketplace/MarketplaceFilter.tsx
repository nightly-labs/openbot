import { buttonVariants, DropdownMenu, SlidersHorizontal } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { For, Show } from "solid-js";
import { MenuCheck } from "./MarketplaceParts";

export interface FilterGroup {
  /** Heads the group, and names it for a screen reader. */
  legend: string;
  options: readonly { value: string; label: string }[];
  value: string | null;
  set: (value: string | null) => void;
}

/**
 * The filter menu in the toolbar. Each group is one choice; "All" turns it off. The button names the
 * filters that are on. The menu stays open, so the user can set two filters at once.
 */
export function MarketplaceFilter(props: { groups: readonly FilterGroup[] }) {
  const { t } = useText();
  const on = () =>
    props.groups.flatMap((group) =>
      group.options.filter((option) => option.value === group.value).map((option) => option.label),
    );
  const item = (label: () => string, value: string, selected: () => boolean) => (
    <DropdownMenu.RadioItem value={value} closeOnSelect={false}>
      <MenuCheck on={selected()} />
      {label()}
    </DropdownMenu.RadioItem>
  );
  return (
    <DropdownMenu.Root placement="bottom-end" gutter={4}>
      <DropdownMenu.Trigger
        class={buttonVariants({ variant: on().length > 0 ? "secondary" : "ghost", size: "sm" })}
        aria-label={
          on().length > 0 ? t("marketplace.filter.on", { filters: on().join(", ") }) : t("marketplace.filter")
        }
      >
        <SlidersHorizontal aria-hidden="true" />
        {on().length > 0 ? on().join(" · ") : t("marketplace.filter")}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content class="marketplace-menu">
          {/* Keyed rows: a choice gives new group objects, and a new row would lose the focus. */}
          <For each={props.groups} keyed={(group) => group.legend}>
            {(group, index) => (
              <>
                <Show when={index() > 0}>
                  <DropdownMenu.Separator />
                </Show>
                <span class="ui-menu-label" aria-hidden="true">
                  {group().legend}
                </span>
                <DropdownMenu.RadioGroup
                  aria-label={group().legend}
                  value={group().value ?? ""}
                  onChange={(value: string) => group().set(value === "" ? null : value)}
                >
                  {item(
                    () => t("marketplace.filter.all"),
                    "",
                    () => group().value === null,
                  )}
                  <For each={group().options} keyed={(option) => option.value}>
                    {(option) =>
                      item(
                        () => option().label,
                        option().value,
                        () => group().value === option().value,
                      )
                    }
                  </For>
                </DropdownMenu.RadioGroup>
              </>
            )}
          </For>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
