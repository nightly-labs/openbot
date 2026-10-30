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
  /** The agent whose turn made the routine. The modal waits until that turn ends. */
  agentId: string | null;
}

interface HostedServerUpsellProps {
  accountId: string | null;
  /**
   * The account can buy a hosted server and has none, and the open host is a computer that the user
   * owns, not a hosted server.
   */
  canOffer: boolean;
  /** A routine that waits for the modal is dropped when the user opens another server. */
  serverId: string;
  /**
   * The id of each active routine on the open host, or null when the open host is not this computer.
   * The modal opens only on this computer, after the first routine there. Without it, the modal never opens.
   */
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

/*
 * The routine editor and the offline notice are not under the workspace overlays, so the mounted
 * offer registers itself here. Desktop and web each mount one.
 */
const [controller, setController] = createSignal<HostedUpsellController | null>(null);
/*
 * A server switch mounts the offer again on desktop, so what one sitting already showed stays here,
 * for the life of this window.
 */
const reported = new Set<string>();
const [modalThisSession, setModalThisSession] = createSignal(false);

/** Called when a routine is new on the open host, from the editor or from an agent. */
export function hostedUpsellRoutineCreated(routine: HostedUpsellRoutine): void {
  untrack(controller)?.routineCreated(routine);
}

/**
 * The offer in the offline notice while `offline()` is true, or null when there is nothing to offer.
 * It counts as shown each time it appears.
 */
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
// A remote host's clock can differ a little from this computer's clock.
const HOST_CLOCK_SLACK_MS = 2 * 60 * 1000;

/** A routine made before this window opened is not new, also when its list loads for the first time. */
function routineMadeThisSession(createdAt: string): boolean {
  return Date.parse(createdAt) >= WINDOW_OPENED_AT - HOST_CLOCK_SLACK_MS;
}

/**
 * The active routines in `next` that are new since `previous`. With no previous list, a routine is
 * new only when it was made after this window opened, so a first load does not count old routines.
 */
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

  /** Saves the new state first. A failed write shows nothing, so the modal cannot repeat. */
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

  // The modal waits until the agent's turn ends and the window has focus, so it does not cover a reply.
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
    // A failed write still hides the notice until a reload.
    setState(next);
  }

  function seePlans(entryPoint: HostedUpsellEntryPoint): void {
    if (entryPoint === "routines_list") updateState(withNoticePlansSeen);
    track("see_plans", entryPoint);
    untrack(() => props.openPlans)();
  }

  /**
   * The modal waits for a routine only when it is the first on this computer: the host has the routine,
   * and every active routine there is new in this window. A failed read shows nothing.
   */
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
      // Each routine counts once, also when the editor and the routine list both report it.
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
  // A component body cannot write a signal, so the offer registers after it mounts.
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

/** The offer at the top of a routine list, while active routines depend on this host. */
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
