import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  ROUTINE_LIMIT_POLICIES,
  ROUTINE_MISSED_POLICIES,
  type RoutineLimitPolicy,
  type RoutineMissedPolicy,
  type RoutineRunPlace,
  type RoutineSchedule,
} from "@openbot/contracts/ipc";
import { type CalendarDay, calendarDayDate } from "@openbot/team-client/routine-calendar-dates";
import {
  Button,
  IconButton,
  Input,
  Popover,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SwitchField,
  Text,
  Textarea,
  X,
} from "@openbot/ui";
import { createEffect, createStore, createUniqueId, onSettled, Show, untrack } from "solid-js";
import { useText } from "../../text";
import { AgentSearchSelect, type AgentSearchSelectAgent, agentOf } from "../agents/AgentSearchSelect";
import { RoutineSchedulePicker } from "./RoutineSchedulePicker";
import type { RoutineScheduleDraft } from "./routine-schedule-draft";
import {
  ROUTINE_LOCAL_DRAFT_KINDS,
  ROUTINE_SAVED_DRAFT_KINDS,
  routineDraftProblem,
  routineScheduleFromDraft,
} from "./routine-schedule-saved";

/** The routine fields that the host keeps. A field the host drops does not show. */
export interface RoutineCreateFields {
  /** The host saves a one-time schedule. */
  onceSchedule: boolean;
  limitPolicy: boolean;
  missedPolicy: boolean;
  /** The host keeps where an agent routine runs: its chat or its own thread. */
  runIn: boolean;
}

export interface RoutineCalendarNewRoutine {
  agentId: string;
  name: string;
  instruction: string;
  schedule: RoutineSchedule;
  limitPolicy?: RoutineLimitPolicy;
  missedPolicy?: RoutineMissedPolicy;
  runIn?: RoutineRunPlace;
}

/** Creates a routine from a day of the calendar. The host gives the fields it keeps and the save. */
export interface RoutineCalendarCreate {
  fields: RoutineCreateFields;
  /** Rejects with the error to show. The card stays open, so the person can try again. */
  save: (routine: RoutineCalendarNewRoutine) => Promise<void>;
}

/** The day and time of a new routine, and the point on the screen that the card opens next to. */
export interface RoutineCalendarSlot {
  day: CalendarDay;
  /** "HH:mm". */
  time: string;
  x: number;
  y: number;
}

interface CardDraft {
  agentId: string;
  name: string;
  instruction: string;
  schedule: RoutineScheduleDraft;
  limitPolicy: RoutineLimitPolicy;
  missedPolicy: RoutineMissedPolicy;
  runInThread: boolean;
  showErrors: boolean;
  saving: boolean;
  error: string | null;
}

const LIMIT_LABELS = {
  wait: "routine.settings.limitPolicy.wait",
  skip: "routine.settings.limitPolicy.skip",
} as const;

const MISSED_LABELS = {
  skip: "routine.settings.missedPolicy.skip",
  "run-once": "routine.settings.missedPolicy.runOnce",
} as const;

/** A one-time run on that day when the host keeps one, else a weekly run on its weekday. */
function slotSchedule(slot: RoutineCalendarSlot, once: boolean): RoutineScheduleDraft {
  return once
    ? { kind: "once", date: slot.day, time: slot.time }
    : { kind: "weekly", weekday: calendarDayDate(slot.day).getUTCDay(), time: slot.time };
}

function draftValid(draft: CardDraft): boolean {
  return Boolean(draft.name.trim() && draft.instruction.trim() && routineDraftProblem(draft.schedule) === null);
}

/**
 * The routine form in a card next to the click on a calendar day. It has the fields and checks of
 * the routine settings. Escape, Cancel or a click outside closes it.
 */
export function RoutineCalendarCreateCard(props: {
  slot: RoutineCalendarSlot | null;
  agents: readonly AgentSearchSelectAgent[];
  create: RoutineCalendarCreate;
  now: Date;
  onClose: () => void;
}) {
  const { t, errorMessage } = useText();
  const id = createUniqueId();
  /** The agent of the last card, so a person who adds several routines for one agent picks it once. */
  let lastAgentId: string | undefined;
  const [draft, setDraft] = createStore<CardDraft>({
    agentId: "",
    name: "",
    instruction: "",
    schedule: { kind: "weekly", weekday: 1, time: "09:00" },
    limitPolicy: "wait",
    missedPolicy: "skip",
    runInThread: false,
    showErrors: false,
    saving: false,
    error: null,
  });
  let card: HTMLElement | undefined;
  let nameInput: HTMLInputElement | undefined;
  /** The control that had the focus when the card opened, such as the "+" of a day. */
  let opener: HTMLElement | null = null;

  // Only a new slot starts a new draft: a refresh of the agents keeps what the person wrote.
  createEffect(
    () => {
      const slot = props.slot;
      return slot
        ? ([slot, untrack(() => props.create.fields.onceSchedule), untrack(() => props.agents)] as const)
        : null;
    },
    (opened) => {
      if (!opened) {
        // The card has no trigger, and a card that is not modal does not give the focus back. The focus
        // goes back to the control that opened the card, unless the person moved it to another control.
        const focused = document.activeElement;
        const lost = !focused || focused === document.body || Boolean(card?.contains(focused));
        if (opener?.isConnected && lost) opener.focus();
        opener = null;
        return;
      }
      const [slot, once, agents] = opened;
      if (!slot) return;
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && focused !== document.body && !card?.contains(focused)) opener = focused;
      const agentId = agentOf(agents, lastAgentId ?? "")?.id ?? agents[0]?.id ?? "";
      const schedule = slotSchedule(slot, once);
      setDraft((value) => {
        value.agentId = agentId;
        value.name = "";
        value.instruction = "";
        value.schedule = schedule;
        value.limitPolicy = "wait";
        // As in the routine settings: a one-time run that came due while OpenBot was closed still runs.
        value.missedPolicy = schedule.kind === "once" ? "run-once" : "skip";
        value.runInThread = false;
        value.showErrors = false;
        value.saving = false;
        value.error = null;
      });
      // The button or the day that opened the card keeps the focus until the card is on screen. A new
      // slot on an open card does not open it again, so the open event alone does not move the focus.
      const frame = requestAnimationFrame(() => nameInput?.focus());
      return () => cancelAnimationFrame(frame);
    },
  );

  // Escape closes the card before the page handler, which would close the Schedule page too. An
  // open menu in the card keeps its own Escape.
  onSettled(() => {
    const key = (event: KeyboardEvent) => {
      // An Escape that ends an IME composition stays with the field.
      if (event.key !== "Escape" || event.isComposing || event.defaultPrevented || !props.slot || !card) return;
      const own = card;
      const popups = [...document.querySelectorAll("[data-popper-positioner]")];
      if (popups.some((popup) => !popup.contains(own) && !popup.querySelector("[role=tooltip]"))) return;
      event.preventDefault();
      event.stopPropagation();
      props.onClose();
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  });

  const changeSchedule = (schedule: RoutineScheduleDraft) =>
    setDraft((value) => {
      if (schedule.kind === "once" && value.schedule.kind !== "once") value.missedPolicy = "run-once";
      value.schedule = schedule;
    });

  async function create(): Promise<void> {
    if (draft.saving) return;
    if (!draftValid(draft)) {
      setDraft((value) => {
        value.showErrors = true;
      });
      return;
    }
    const fields = props.create.fields;
    const once = draft.schedule.kind === "once";
    const routine: RoutineCalendarNewRoutine = {
      agentId: draft.agentId,
      name: draft.name.trim(),
      instruction: draft.instruction.trim(),
      schedule: routineScheduleFromDraft(draft.schedule),
      ...(fields.limitPolicy && !once ? { limitPolicy: draft.limitPolicy } : {}),
      ...(fields.missedPolicy ? { missedPolicy: draft.missedPolicy } : {}),
      ...(fields.runIn && draft.runInThread ? { runIn: "thread" } : {}),
    };
    setDraft((value) => {
      value.saving = true;
      value.error = null;
    });
    // The person can open another day while the host saves. The result is only for this card.
    const slot = props.slot;
    try {
      await props.create.save(routine);
      if (props.slot === slot) props.onClose();
    } catch (caught) {
      if (props.slot === slot)
        setDraft((value) => {
          value.error = errorMessage(caught, t("routine.settings.saveFailed"));
        });
    } finally {
      if (props.slot === slot)
        setDraft((value) => {
          value.saving = false;
        });
    }
  }

  const nameMissing = () => draft.showErrors && !draft.name.trim();
  const instructionMissing = () => draft.showErrors && !draft.instruction.trim();
  const agentName = () => agentOf(props.agents, draft.agentId)?.name ?? draft.agentId;

  return (
    <Popover.Root
      open={props.slot !== null}
      onOpenChange={(next) => {
        if (!next) props.onClose();
      }}
      // The point of the click, in the viewport.
      getAnchorRect={() => ({ x: props.slot?.x ?? 0, y: props.slot?.y ?? 0, width: 0, height: 0 })}
      placement="right-start"
      gutter={8}
      modal={false}
    >
      <Popover.Portal>
        <Popover.Content
          ref={card}
          class="ui-popover-menu-surface routine-planner-create"
          // The name is the first thing to write; the agent is already set.
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            nameInput?.focus();
          }}
        >
          <header class="routine-planner-create-head">
            <Popover.Title class="routine-planner-create-title">{t("routine.calendar.new")}</Popover.Title>
            <IconButton variant="ghost" size="icon-sm" label={t("common.close")} onClick={() => props.onClose()}>
              <X aria-hidden="true" />
            </IconButton>
          </header>
          <div class="settings-field">
            <span id={`${id}-agent`}>{t("routine.calendar.agent")}</span>
            <AgentSearchSelect
              agents={props.agents}
              agentId={draft.agentId}
              label={t("routine.calendar.agentChoice", { name: agentName() })}
              variant="outline"
              class="routine-planner-create-agent"
              onChange={(agentId) => {
                lastAgentId = agentId;
                setDraft((value) => {
                  value.agentId = agentId;
                });
              }}
            />
          </div>
          <label class="settings-field">
            <span>{t("routine.settings.name")}</span>
            <Input
              ref={nameInput}
              value={draft.name}
              placeholder={t("routine.settings.namePlaceholder")}
              maxlength={INPUT_LIMITS.routineName}
              invalid={nameMissing()}
              aria-describedby={nameMissing() ? `${id}-name-error` : undefined}
              onValueChange={(name) =>
                setDraft((value) => {
                  value.name = name;
                })
              }
            />
            <Show when={nameMissing()}>
              <Text id={`${id}-name-error`} variant="caption" tone="danger">
                {t("routine.settings.nameRequired")}
              </Text>
            </Show>
          </label>
          <section class="routine-planner-create-when" aria-labelledby={`${id}-when`}>
            <h3 id={`${id}-when`}>{t("routine.settings.whenToRun")}</h3>
            <RoutineSchedulePicker
              schedule={draft.schedule}
              today={props.now}
              kinds={props.create.fields.onceSchedule ? ROUTINE_LOCAL_DRAFT_KINDS : ROUTINE_SAVED_DRAFT_KINDS}
              onChange={changeSchedule}
            />
          </section>
          <div class="settings-field">
            <span id={`${id}-instruction`}>{t("routine.settings.instruction")}</span>
            <Textarea
              aria-labelledby={`${id}-instruction`}
              value={draft.instruction}
              placeholder={t("routine.settings.instructionPlaceholderAgent")}
              maxlength={INPUT_LIMITS.routineInstruction}
              invalid={instructionMissing()}
              aria-describedby={instructionMissing() ? `${id}-instruction-error` : undefined}
              onValueChange={(instruction) =>
                setDraft((value) => {
                  value.instruction = instruction;
                })
              }
            />
            <Show when={instructionMissing()}>
              <Text id={`${id}-instruction-error`} variant="caption" tone="danger">
                {t("routine.settings.instructionRequired")}
              </Text>
            </Show>
          </div>
          {/* The host does not skip a one-time run at a spent plan: it waits, so the reminder is not lost. */}
          <Show when={props.create.fields.limitPolicy && draft.schedule.kind !== "once"}>
            <div class="settings-field">
              <span id={`${id}-limit`}>{t("routine.settings.limitPolicy")}</span>
              <Select<RoutineLimitPolicy>
                options={[...ROUTINE_LIMIT_POLICIES]}
                value={draft.limitPolicy}
                onChange={(limitPolicy) => {
                  if (limitPolicy)
                    setDraft((value) => {
                      value.limitPolicy = limitPolicy;
                    });
                }}
                itemComponent={(item) => (
                  <SelectItem item={item.item}>{t(LIMIT_LABELS[item.item.rawValue])}</SelectItem>
                )}
              >
                <SelectTrigger aria-labelledby={`${id}-limit`}>
                  <SelectValue<RoutineLimitPolicy>>{(state) => t(LIMIT_LABELS[state.selectedOption()])}</SelectValue>
                </SelectTrigger>
                <SelectContent />
              </Select>
            </div>
          </Show>
          <Show when={props.create.fields.missedPolicy}>
            <div class="settings-field">
              <span id={`${id}-missed`}>{t("routine.settings.missedPolicy")}</span>
              <Select<RoutineMissedPolicy>
                options={[...ROUTINE_MISSED_POLICIES]}
                value={draft.missedPolicy}
                onChange={(missedPolicy) => {
                  if (missedPolicy)
                    setDraft((value) => {
                      value.missedPolicy = missedPolicy;
                    });
                }}
                itemComponent={(item) => (
                  <SelectItem item={item.item}>{t(MISSED_LABELS[item.item.rawValue])}</SelectItem>
                )}
              >
                <SelectTrigger aria-labelledby={`${id}-missed`}>
                  <SelectValue<RoutineMissedPolicy>>{(state) => t(MISSED_LABELS[state.selectedOption()])}</SelectValue>
                </SelectTrigger>
                <SelectContent />
              </Select>
            </div>
          </Show>
          <Show when={props.create.fields.runIn}>
            <div class="settings-field">
              <SwitchField
                label={t("routine.settings.runInThread")}
                checked={draft.runInThread}
                onChange={(thread) =>
                  setDraft((value) => {
                    value.runInThread = thread;
                  })
                }
              />
            </div>
          </Show>
          <Show when={draft.error}>
            {(error) => (
              <Text variant="caption" tone="danger" role="alert">
                {error()}
              </Text>
            )}
          </Show>
          <div class="routine-planner-create-actions">
            <Button type="button" variant="ghost" size="sm" onClick={() => props.onClose()}>
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              size="sm"
              loading={draft.saving}
              loadingLabel={t("common.saving")}
              onClick={() => void create()}
            >
              {t("routine.settings.create")}
            </Button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
