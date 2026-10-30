import type { AppTextKey } from "@openbot/i18n";
import { AlarmClock, buttonVariants, Check, ChevronsUpDown, DropdownMenu } from "@openbot/ui";
import { For, Show } from "solid-js";
import { useText } from "../../text";
import type { RoutineDraftKind, RoutineDraftKindOption } from "./routine-schedule-draft";

const KIND_DESCRIPTIONS = {
  once: "routine.trigger.onceDescription",
  hourly: "routine.trigger.hourlyDescription",
  daily: "routine.trigger.dailyDescription",
  weekly: "routine.trigger.weeklyDescription",
  monthly: "routine.trigger.monthlyDescription",
  yearly: "routine.trigger.yearlyDescription",
  custom: "routine.trigger.customDescription",
} as const satisfies Record<RoutineDraftKind, AppTextKey>;

interface RoutineTriggerMenuProps {
  value: RoutineDraftKind;
  /** The schedule frequencies the menu offers. */
  kinds: RoutineDraftKindOption[];
  onSelect: (choice: RoutineDraftKind) => void;
}

/**
 * The menu that changes the schedule frequency. Each choice has an icon, a name and one line that
 * tells when the routine runs. The switch above the schedule chooses between a schedule and a webhook.
 */
export function RoutineTriggerMenu(props: RoutineTriggerMenuProps) {
  const { t } = useText();
  return (
    <DropdownMenu.Root placement="bottom-end" gutter={6}>
      <DropdownMenu.Trigger
        class={`${buttonVariants({ variant: "ghost", size: "icon-sm" })} ui-icon-button`}
        aria-label={t("routine.trigger.change")}
        title={t("routine.trigger.change")}
      >
        <ChevronsUpDown aria-hidden="true" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content class="routine-trigger-menu">
          <span class="ui-menu-label" aria-hidden="true">
            {t("routine.trigger.groupSchedule")}
          </span>
          <DropdownMenu.RadioGroup
            aria-label={t("routine.trigger.groupSchedule")}
            value={props.value}
            onChange={(value: string) => {
              const kind = props.kinds.find((option) => option.value === value);
              if (kind) props.onSelect(kind.value);
            }}
          >
            <For each={props.kinds} keyed={(kind) => kind.value}>
              {(kind) => (
                <TriggerItem
                  value={kind().value}
                  selected={props.value === kind().value}
                  title={t(kind().label)}
                  description={t(KIND_DESCRIPTIONS[kind().value])}
                />
              )}
            </For>
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function TriggerItem(props: { value: RoutineDraftKind; selected: boolean; title: string; description: string }) {
  return (
    <DropdownMenu.RadioItem value={props.value} class="routine-trigger-menu-item">
      <span class="routine-trigger-icon" aria-hidden="true">
        <AlarmClock />
      </span>
      <span class="routine-trigger-menu-text">
        <span>{props.title}</span>
        <span class="routine-trigger-menu-description">{props.description}</span>
      </span>
      <Show when={props.selected}>
        <Check aria-hidden="true" class="routine-trigger-menu-check" />
      </Show>
    </DropdownMenu.RadioItem>
  );
}
