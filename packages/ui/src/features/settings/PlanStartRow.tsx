import { MAX_PLAN_START_AFTER_MS, MIN_PLAN_START_AFTER_MS } from "@openbot/contracts/ipc";
import {
  Button,
  Input,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
  Popover,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SlidingTabs,
} from "@openbot/ui";
import { createMemo, createStore } from "solid-js";
import { useText } from "../../text";

const PRESETS = [10_000, 30_000, 60_000, 300_000] as const;

type PlanStartChoice = "wait" | "custom" | `${number}`;

function isPreset(ms: number): boolean {
  return PRESETS.some((preset) => preset === ms);
}

/**
 * The menu items. A saved custom time is an item of its own, so the select never has "custom" as
 * its value, and choosing "Custom…" again is a change that opens the panel.
 */
function choices(value: number | null): PlanStartChoice[] {
  const custom = value !== null && !isPreset(value) ? [`${value}` as const] : [];
  return ["wait", ...PRESETS.map((ms) => `${ms}` as const), ...custom, "custom"];
}

type CustomUnit = "s" | "min";
const UNIT_MS: Record<CustomUnit, number> = { s: 1_000, min: 60_000 };

/** The typed time in ms, or null when it is not a whole number in the allowed range. */
function typedMs(amount: string, unit: CustomUnit): number | null {
  if (!/^\d+$/.test(amount.trim())) return null;
  const ms = Number(amount) * UNIT_MS[unit];
  return ms >= MIN_PLAN_START_AFTER_MS && ms <= MAX_PLAN_START_AFTER_MS ? ms : null;
}

function choiceOf(ms: number | null): PlanStartChoice {
  return ms === null ? "wait" : `${ms}`;
}

interface CustomState {
  open: boolean;
  amount: string;
  unit: CustomUnit;
}

export interface PlanStartRowProps {
  /** `null` waits until a person presses Start. */
  value: number | null;
  /** The dialog element that the menus portal into. */
  menuMount: HTMLElement | undefined;
  onChange: (value: number | null) => void;
}

/**
 * "Start the work", under the default of "Show the plan before long tasks": when the plan card
 * starts the work by itself, for all agents. Custom opens a small panel at the select.
 */
export function PlanStartRow(props: PlanStartRowProps) {
  const { t, format } = useText();
  const [state, setState] = createStore<CustomState>({ open: false, amount: "90", unit: "s" });
  // The same array while the items stay the same: the select builds its list again for a new one.
  const options = createMemo(() => choices(props.value), { equals: (a, b) => a.join() === b.join() });
  let trigger: HTMLButtonElement | undefined;

  const unitText = (value: number, unit: "second" | "minute") =>
    format.number(value, { style: "unit", unit, unitDisplay: "short" });
  const delayText = (ms: number) => {
    const minutes = Math.floor(ms / 60_000);
    const seconds = Math.round((ms % 60_000) / 1_000);
    if (minutes === 0) return unitText(seconds, "second");
    if (seconds === 0) return unitText(minutes, "minute");
    return `${unitText(minutes, "minute")} ${unitText(seconds, "second")}`;
  };
  const choiceText = (choice: PlanStartChoice) => {
    if (choice === "wait") return t("settings.planStart.wait");
    if (choice === "custom") return t("settings.planStart.custom");
    return t("settings.planStart.after", { time: delayText(Number(choice)) });
  };
  const label = () => choiceText(choiceOf(props.value));
  const draftMs = () => typedMs(state.amount, state.unit);

  function openCustom(): void {
    setState((draft) => {
      const current = props.value;
      if (current !== null && !isPreset(current)) {
        const minutes = current % 60_000 === 0;
        draft.unit = minutes ? "min" : "s";
        draft.amount = String(current / UNIT_MS[draft.unit]);
      }
      draft.open = true;
    });
  }

  function closeCustom(): void {
    setState((draft) => {
      draft.open = false;
    });
  }

  return (
    <Item class="settings-modal-row">
      <ItemContent>
        <ItemTitle>{t("settings.planStart.title")}</ItemTitle>
        <ItemDescription>
          {props.value === null
            ? t("settings.planStart.waitNote")
            : t("settings.planStart.afterNote", { time: delayText(props.value) })}
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        <Select<PlanStartChoice>
          options={options()}
          value={choiceOf(props.value)}
          placement="bottom-end"
          onChange={(next) => {
            if (next === "custom") openCustom();
            else if (next) props.onChange(next === "wait" ? null : Number(next));
          }}
          itemComponent={(item) => <SelectItem item={item.item}>{choiceText(item.item.rawValue)}</SelectItem>}
        >
          <SelectTrigger
            size="sm"
            class="server-roles-level"
            aria-label={t("settings.planStart.title")}
            ref={(element: HTMLButtonElement) => {
              trigger = element;
            }}
          >
            <SelectValue<PlanStartChoice>>{() => label()}</SelectValue>
          </SelectTrigger>
          <SelectContent mount={props.menuMount} />
        </Select>
        <Popover.Root
          open={state.open}
          onOpenChange={(open: boolean) =>
            setState((draft) => {
              draft.open = open;
            })
          }
          anchorRef={() => trigger}
          placement="bottom-end"
          gutter={6}
        >
          <Popover.Portal mount={props.menuMount ?? document.body}>
            <Popover.Content class="ui-popover-menu-surface plan-start-popover">
              <Popover.Title class="plan-start-popover-title">{t("settings.planStart.customTitle")}</Popover.Title>
              <div class="plan-start-popover-controls">
                <span>{t("settings.planStart.customPrefix")}</span>
                <Input
                  size="sm"
                  type="text"
                  inputmode="numeric"
                  class="plan-start-amount"
                  aria-label={t("settings.planStart.amountLabel")}
                  invalid={draftMs() === null}
                  value={state.amount}
                  onValueChange={(value) =>
                    setState((draft) => {
                      draft.amount = value;
                    })
                  }
                />
                <SlidingTabs.Root
                  value={state.unit}
                  onChange={(value: string) =>
                    setState((draft) => {
                      draft.unit = value === "min" ? "min" : "s";
                    })
                  }
                >
                  <SlidingTabs.List aria-label={t("settings.planStart.unitLabel")}>
                    <SlidingTabs.Trigger value="s">{t("settings.planStart.seconds")}</SlidingTabs.Trigger>
                    <SlidingTabs.Trigger value="min">{t("settings.planStart.minutes")}</SlidingTabs.Trigger>
                  </SlidingTabs.List>
                </SlidingTabs.Root>
              </div>
              <Popover.Description class="plan-start-popover-note" data-invalid={draftMs() === null ? "" : undefined}>
                {draftMs() === null ? t("settings.planStart.customInvalid") : t("settings.planStart.customHint")}
              </Popover.Description>
              <div class="plan-start-popover-actions">
                <Button type="button" variant="ghost" size="sm" onClick={closeCustom}>
                  {t("common.cancel")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={draftMs() === null}
                  onClick={() => {
                    const ms = draftMs();
                    if (ms === null) return;
                    closeCustom();
                    props.onChange(ms);
                  }}
                >
                  {t("settings.planStart.set")}
                </Button>
              </div>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </ItemActions>
    </Item>
  );
}
