import type { RoutineFields } from "@openbot/contracts/ipc";
import { HostedServerUpsellDialog } from "@openbot/ui/features/servers/HostedServerUpsellDialog";
import { HostedServerUpsellNotice } from "@openbot/ui/features/servers/HostedServerUpsellNotice";
import type { HostedUpsellHost } from "@openbot/ui/features/servers/hosted-server-upsell-host";
import { createEffect, createMemo, createSignal, onSettled, Show, untrack } from "solid-js";
import { usePlatform } from "../../platform";
import {
  type HostedUpsellState,
  modalAllowed,
  noticeAllowed,
  readHostedUpsellState,
  withModalShown,
  withNoticeDismissed,
  withNoticePlansSeen,
  writeHostedUpsellState,
} from "./hosted-server-upsell";

type HostedUpsellEntryPoint = "routine_created" | "routines_list" | "server_offline";
type HostedUpsellAction = "shown" | "see_plans" | "dismissed";

interface HostedUpsellRoutine {
  id: string;
  name: string;
  agentId: string | null;
}

interface HostedServerUpsellProps {
  accountId: string | null;
  canOffer: boolean;
  serverId: string;
  activeHostRoutineIds?: (() => Promise<readonly string[] | null>) | undefined;
  host: HostedUpsellHost;
  busy: (agentId: string) => boolean;
  openPlans: () => void;
  track?: ((action: HostedUpsellAction, entryPoint: HostedUpsellEntryPoint) => void) | undefined;
}

interface HostedUpsellController {
  routineCreated: (routine: HostedUpsellRoutine) => void;
  canOffer: () => boolean;
  host: () => HostedUpsellHost;
  noticeVisible: () => boolean;
  dismissNotice: () => void;
  seePlans: (entryPoint: HostedUpsellEntryPoint) => void;
  track: (action: HostedUpsellAction, entryPoint: HostedUpsellEntryPoint) => void;
}

const [controller, setController] = createSignal<HostedUpsellController | null>(null);
const reported = new Set<string>();
const [modalThisSession, setModalThisSession] = createSignal(false);

export function hostedUpsellRoutineCreated(routine: HostedUpsellRoutine): void {
  untrack(controller)?.routineCreated(routine);
}

export function createHostedUpsellOffline(offline: () => boolean): () => { onSeePlans: () => void } | null {
  const offer = createMemo(() => {
    const current = offline() ? controller() : null;
    return current?.canOffer() ? current : null;
  });
  createEffect(offer, (current) => {
    current?.track("shown", "server_offline");
  });
  return () => {
    const current = offer();
    return current ? { onSeePlans: () => current.seePlans("server_offline") } : null;
  };
}

const WINDOW_OPENED_AT = Date.now();
const HOST_CLOCK_SLACK_MS = 2 * 60 * 1000;

function routineMadeThisSession(createdAt: string): boolean {
  return Date.parse(createdAt) >= WINDOW_OPENED_AT - HOST_CLOCK_SLACK_MS;
}

export function createdRoutines(
  previous: readonly RoutineFields[] | undefined,
  next: readonly RoutineFields[],
): RoutineFields[] {
  const known = previous ? new Set(previous.map((routine) => routine.id)) : null;
  return next.filter(
    (routine) => routine.active && (known ? !known.has(routine.id) : routineMadeThisSession(routine.createdAt)),
  );
}

export function HostedServerUpsell(props: HostedServerUpsellProps) {
  const platform = usePlatform();
  const [pending, setPending] = createSignal<{ routine: HostedUpsellRoutine; serverId: string } | null>(null);
  const [openRoutine, setOpenRoutine] = createSignal<HostedUpsellRoutine | null>(null);
  const [state, setState] = createSignal<HostedUpsellState | null>(null);

  createEffect(
    () => props.accountId,
    (accountId) => {
      setState(accountId ? readHostedUpsellState(window.localStorage, accountId) : null);
    },
  );
  createEffect(
    () => props.serverId,
    (serverId) => {
      setPending((current) => (current?.serverId === serverId ? current : null));
    },
  );

  function track(action: HostedUpsellAction, entryPoint: HostedUpsellEntryPoint): void {
    untrack(() => props.track)?.(action, entryPoint);
  }

  function showModal(routine: HostedUpsellRoutine): void {
    setPending(null);
    const accountId = untrack(() => props.accountId);
    if (!accountId) return;
    const now = Date.now();
    const saved = readHostedUpsellState(window.localStorage, accountId);
    if (!saved || !modalAllowed(saved)) return;
    const next = withModalShown(saved, now);
    if (!writeHostedUpsellState(window.localStorage, accountId, next)) return;
    setState(next);
    setModalThisSession(true);
    setOpenRoutine(routine);
    track("shown", "routine_created");
  }

  createEffect(
    () => {
      const waiting = pending();
      if (!waiting || !props.canOffer || !platform.appFocused() || modalThisSession()) return null;
      if (waiting.routine.agentId && props.busy(waiting.routine.agentId)) return null;
      return waiting.routine;
    },
    (routine) => {
      if (routine) showModal(routine);
    },
  );

  function updateState(change: (current: HostedUpsellState, now: number) => HostedUpsellState): void {
    const accountId = untrack(() => props.accountId);
    if (!accountId) return;
    const saved = readHostedUpsellState(window.localStorage, accountId);
    if (!saved) return;
    const next = change(saved, Date.now());
    writeHostedUpsellState(window.localStorage, accountId, next);
    setState(next);
  }

  function seePlans(entryPoint: HostedUpsellEntryPoint): void {
    if (entryPoint === "routines_list") updateState(withNoticePlansSeen);
    track("see_plans", entryPoint);
    untrack(() => props.openPlans)();
  }

  function waitIfFirst(routine: HostedUpsellRoutine): void {
    const activeHostRoutineIds = untrack(() => props.activeHostRoutineIds);
    const saved = untrack(state);
    if (!activeHostRoutineIds || !untrack(() => props.canOffer) || !saved || !modalAllowed(saved)) return;
    const serverId = untrack(() => props.serverId);
    activeHostRoutineIds().then(
      (ids) => {
        if (!ids?.includes(routine.id) || !ids.every((id) => reported.has(id))) return;
        if (untrack(() => props.serverId) !== serverId || untrack(modalThisSession) || untrack(pending)) return;
        setPending({ routine, serverId });
      },
      () => undefined,
    );
  }

  const api: HostedUpsellController = {
    routineCreated(routine) {
      if (reported.has(routine.id)) return;
      reported.add(routine.id);
      if (untrack(modalThisSession) || untrack(pending)) return;
      waitIfFirst(routine);
    },
    canOffer: () => props.canOffer,
    host: () => props.host,
    noticeVisible: () => {
      const saved = state();
      return props.canOffer && !modalThisSession() && saved !== null && noticeAllowed(saved, Date.now());
    },
    dismissNotice() {
      updateState(withNoticeDismissed);
      track("dismissed", "routines_list");
    },
    seePlans,
    track,
  };
  onSettled(() => {
    setController(api);
    return () => setController((current) => (current === api ? null : current));
  });

  return (
    <Show when={openRoutine()}>
      {(routine) => (
        <HostedServerUpsellDialog
          routine={{ name: routine().name }}
          onSeePlans={() => {
            setOpenRoutine(null);
            seePlans("routine_created");
          }}
          onClose={() => {
            setOpenRoutine(null);
            track("dismissed", "routine_created");
          }}
        />
      )}
    </Show>
  );
}

export function HostedUpsellRoutinesNotice(props: { count: number }) {
  return (
    <Show when={props.count > 0 && controller()?.noticeVisible() ? controller() : null}>
      {(upsell) => <ShownNotice upsell={upsell()} count={props.count} />}
    </Show>
  );
}

function ShownNotice(props: { upsell: HostedUpsellController; count: number }) {
  onSettled(() => props.upsell.track("shown", "routines_list"));
  return (
    <HostedServerUpsellNotice
      count={props.count}
      host={props.upsell.host()}
      onSeePlans={() => props.upsell.seePlans("routines_list")}
      onDismiss={() => props.upsell.dismissNotice()}
    />
  );
}
