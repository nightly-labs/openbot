import {
  type EventFilterDraft,
  eventFilterDraft,
  eventFilterDraftsValid,
  eventFiltersFromDrafts,
} from "@openbot/contracts/event-filter-value";
import type {
  EventFilter,
  EventRoutine,
  EventRoutineOwner,
  RoutineWebhookTrigger,
} from "@openbot/contracts/ipc-events";
import {
  RoutineWebhookCard,
  type RoutineWebhookCardProps,
  type RoutineWebhookCardState,
} from "@openbot/ui/features/conversation/RoutineWebhookCard";
import { useText } from "@openbot/ui/text";
import { createEffect, createMemo, createStore } from "solid-js";
import type { EventRoutinesApi } from "./routine-webhooks-api";
import { agentRoutinesPort } from "./routines-port";

export type ChatWebhookRoutine = EventRoutine & { trigger: RoutineWebhookTrigger };

function isWebhookRoutine(routine: EventRoutine): routine is ChatWebhookRoutine {
  return routine.trigger.kind === "webhook";
}

function plainOwner(routine: EventRoutine): EventRoutineOwner {
  return { kind: routine.owner.kind, id: routine.owner.id };
}

function eventsKey(events: { eventType: string | null; filters: readonly EventFilter[] }): string {
  return JSON.stringify({ eventType: events.eventType, filters: events.filters });
}

export function createChatWebhookRoutines(source: () => { api: EventRoutinesApi; agentId: string } | undefined) {
  const [state, setState] = createStore<{
    routines: ChatWebhookRoutine[];
    connected: boolean | null;
    secrets: Record<string, string>;
  }>({ routines: [], connected: null, secrets: {} });
  let request = 0;
  createEffect(source, (current) => {
    request += 1;
    setState((draft) => {
      draft.routines = [];
      draft.connected = null;
      draft.secrets = {};
    });
    if (!current) return;
    const owner = { kind: "agent", id: current.agentId } as const;
    const load = () => {
      const loading = ++request;
      void Promise.all([current.api.listRoutines({ owner }), current.api.getStatus()])
        .then(([routines, status]) => {
          if (loading !== request) return;
          setState((draft) => {
            draft.routines = routines.filter(isWebhookRoutine);
            draft.connected = status.connected;
          });
        })
        .catch(() => undefined);
    };
    load();
    return agentRoutinesPort(current.agentId).subscribe(load);
  });
  return {
    state,
    setSecret(routineId: string, secret: string | null): void {
      setState((draft) => {
        const others = Object.entries(draft.secrets).filter(([id]) => id !== routineId);
        draft.secrets = Object.fromEntries(secret === null ? others : [...others, [routineId, secret]]);
      });
    },
  };
}

export interface RoutineWebhookChatCardProps {
  api: EventRoutinesApi;
  action: "created" | "updated";
  routine: ChatWebhookRoutine;
  connected: boolean | null;
  agentName: string | undefined;
  secret: string | null;
  onSecret: (secret: string | null) => void;
  onOpenRoutine: (routine: { routineId: string; name: string }) => void;
}

type CardSave = { status: "idle" } | { status: "saving" } | { status: "saved" } | { status: "error"; message: string };

export function RoutineWebhookChatCard(props: RoutineWebhookChatCardProps) {
  const text = useText();
  const [card, setCard] = createStore<{
    eventType: string;
    filters: EventFilterDraft[];
    base: string | null;
    save: CardSave;
    saved: ChatWebhookRoutine | null;
  }>({ eventType: "", filters: [], base: null, save: { status: "idle" }, saved: null });
  const routine = createMemo(() => {
    const saved = card.saved;
    return saved && saved.updatedAt > props.routine.updatedAt ? saved : props.routine;
  });
  const draft = () => ({ eventType: card.eventType.trim() || null, filters: eventFiltersFromDrafts(card.filters) });
  createEffect(
    () => (card.base !== null && eventsKey(draft()) !== card.base ? undefined : routine().trigger),
    (trigger) => {
      if (!trigger) return;
      setCard((next) => {
        next.eventType = trigger.eventType ?? "";
        next.filters = trigger.filters.map(eventFilterDraft);
        next.base = null;
      });
    },
  );
  const changed = () => eventsKey(draft()) !== eventsKey(routine().trigger);
  const valid = () => eventFilterDraftsValid(card.filters);
  const retry = () => card.save.status === "error" && card.base !== null && valid() && changed();
  const state = (): RoutineWebhookCardState => {
    if (retry()) return "changed";
    if (card.save.status === "saving" || card.save.status === "error") return card.save.status;
    if (card.base !== null && (!valid() || changed())) return valid() ? "changed" : "error";
    return card.save.status === "saved" ? "saved" : "idle";
  };
  const errorText = () => {
    if (card.save.status === "error") return card.save.message;
    return valid() ? undefined : text.t("routine.card.webhookFiltersInvalid");
  };

  function edit(change: (next: { eventType: string; filters: EventFilterDraft[] }) => void): void {
    const base = card.base ?? eventsKey(routine().trigger);
    setCard((next) => {
      change(next);
      next.base = base;
      if (next.save.status !== "saving") next.save = { status: "idle" };
    });
  }

  async function save(): Promise<void> {
    if (card.save.status === "saving" || !valid()) return;
    const current = routine();
    setCard((next) => {
      next.save = { status: "saving" };
    });
    try {
      const result = await props.api.saveRoutine({
        id: current.id,
        owner: plainOwner(current),
        name: current.name,
        instruction: current.instruction,
        active: current.active,
        timezone: current.timezone,
        trigger: { kind: "webhook", ...draft() },
      });
      setCard((next) => {
        if (isWebhookRoutine(result.routine)) next.saved = result.routine;
        next.base = null;
        next.save = { status: "saved" };
      });
    } catch (caught) {
      setCard((next) => {
        next.save = { status: "error", message: text.errorMessage(caught, text.t("routine.card.webhookSaveFailed")) };
      });
    }
  }

  function senderSecret(): ((secret: string) => Promise<void>) | undefined {
    const set = props.api.setSecret;
    if (!set) return undefined;
    return async (secret) => {
      await set({ owner: plainOwner(routine()), id: routine().id, secret });
      props.onSecret(null);
    };
  }

  function agentSecret(): RoutineWebhookCardProps["agentSecret"] {
    const give = props.api.giveSecretToAgent;
    const agentName = props.agentName;
    if (!give || !agentName || routine().owner.kind !== "agent") return undefined;
    return {
      routineId: routine().id,
      agentName,
      give: async () => {
        await give({ owner: plainOwner(routine()), id: routine().id });
        props.onSecret(null);
      },
    };
  }

  return (
    <RoutineWebhookCard
      action={props.action}
      routineName={routine().name}
      url={routine().trigger.url}
      connected={props.connected}
      secret={props.secret}
      onSecretDismiss={() => props.onSecret(null)}
      onRegenerateSecret={async () => {
        const result = await props.api.rotateSecret({ owner: plainOwner(routine()), id: routine().id });
        props.onSecret(result.secret);
      }}
      onUseSenderSecret={senderSecret()}
      agentSecret={agentSecret()}
      eventType={card.eventType}
      filters={card.filters}
      onEventTypeChange={(eventType) =>
        edit((next) => {
          next.eventType = eventType;
        })
      }
      onFiltersChange={(filters) =>
        edit((next) => {
          next.filters = filters;
        })
      }
      state={state()}
      errorText={errorText()}
      onSave={() => void save()}
      onOpenRoutine={() => props.onOpenRoutine({ routineId: routine().id, name: routine().name })}
    />
  );
}
