import type {
  RoutineCalendar as HostCalendar,
  RoutineCalendarInput,
  RoutineCalendarRunStatus,
} from "@openbot/contracts/ipc";
import {
  RoutineCalendar,
  type RoutineCalendarAgent,
  type RoutineCalendarRoutine,
  type RoutineCalendarStatus,
} from "@openbot/ui/features/conversation/RoutineCalendar";
import { createEffect, createMemo, createSignal, createStore, onSettled } from "solid-js";
import { useNavigation } from "../../navigation";
import { useAgents } from "../agents/agents-context";
import { useChannels } from "../channels/channels-context";
import { useWindowPage } from "../window/window-page-context";
import { desktopScheduleSource, type ScheduleSource } from "./schedule-port";

const DAY = 86_400_000;

interface SchedulePanelProps {
  serverId: string;
  hostName: string;
  onBack: () => void;
}

export type ScheduleRoutine = HostCalendar["routines"][number];

interface ScheduleViewProps extends SchedulePanelProps {
  source: ScheduleSource;
  agents: RoutineCalendarAgent[];
  /** The channels of the server. A channel routine shows on the agents of its channel. */
  channels: readonly { id: string; members: readonly { agentId: string }[] }[];
  /** False when this server cannot open channels; the calendar then leaves out channel routines. */
  channelsSupported: boolean;
  onOpenAgent: (agentId: string) => void;
  onOpenRoutine: (routine: ScheduleRoutine) => void;
  /** Opens the routine settings of the agent on a new routine. */
  onCreateRoutine: (agentId: string) => void;
}

/**
 * The calendar range in instants. A calendar day in the viewer's zone can start up to 14 hours
 * either side of UTC midnight, so each end takes one more day; the calendar drops what it does not show.
 */
function rangeAround(first: number, last: number): RoutineCalendarInput {
  return { from: new Date(first - DAY).toISOString(), to: new Date(last + 2 * DAY).toISOString() };
}

/** Before a run, the routine state says what happens; after it, the outcome does. */
function calendarStatus(status: RoutineCalendarRunStatus, routineActive: boolean): RoutineCalendarStatus {
  switch (status) {
    case "scheduled":
      return routineActive ? "active" : "paused";
    case "queued":
    case "running":
      return "active";
    case "succeeded":
    case "cancelled":
      return "completed";
    case "failed":
    case "interrupted":
    case "needs-attention":
      return "failed";
  }
}

/** The schedule page on desktop: the calendar of a server, read through main. */
export function SchedulePanel(props: SchedulePanelProps) {
  const { agentList, agentSetupOpen, creatingAgent, setSettingsRequest } = useAgents();
  const { selectAgent } = useNavigation();
  const channels = useChannels();
  const windowPage = useWindowPage();

  function openRoutine(routine: ScheduleRoutine): void {
    if (routine.owner.kind === "channel") {
      // An open channel does not open again, so its settings would stay under the pane.
      windowPage.showAgents();
      // The channel settings hold its routines one step down.
      void channels.editChannel(routine.owner.channelId);
      return;
    }
    const agentId = routine.owner.agentId;
    // As in the global search: the agent cannot change while a new agent is being created.
    if (agentSetupOpen() && creatingAgent()) return;
    selectAgent(agentId);
    setSettingsRequest({ agentId, nonce: Date.now(), routine: { routineId: routine.id, name: routine.name } });
  }

  function createRoutine(agentId: string): void {
    if (agentSetupOpen() && creatingAgent()) return;
    selectAgent(agentId);
    setSettingsRequest({ agentId, nonce: Date.now(), routine: "new" });
  }

  return (
    <ScheduleView
      {...props}
      source={desktopScheduleSource()}
      agents={agentList()}
      channels={channels.state.channels}
      channelsSupported={channels.supported()}
      onOpenAgent={selectAgent}
      onOpenRoutine={openRoutine}
      onCreateRoutine={createRoutine}
    />
  );
}

/** The calendar of the routines of a server. The desktop and the web client give its source and actions. */
export function ScheduleView(props: ScheduleViewProps) {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [now, setNow] = createSignal(new Date());
  const [state, setState] = createStore<{ phase: "loading" | "ready" | "error"; calendar: HostCalendar | null }>({
    phase: "loading",
    calendar: null,
  });
  // Today's week, wherever today falls in it, until the calendar reports the days it shows.
  let range = rangeAround(Date.now() - 7 * DAY, Date.now() + 7 * DAY);
  let generation = 0;

  /** A refresh that an event starts keeps the calendar on screen; only the first load and Retry blank it. */
  async function load(background = false): Promise<void> {
    const request = ++generation;
    const serverId = props.serverId;
    if (!background)
      setState((draft) => {
        draft.phase = "loading";
      });
    try {
      const calendar = await props.source.calendar({ ...range }, serverId);
      if (request !== generation || props.serverId !== serverId) return;
      setNow(new Date());
      setState((draft) => {
        draft.calendar = calendar;
        draft.phase = "ready";
      });
    } catch {
      // A failed refresh keeps the calendar on screen, unless a range change already blanked it.
      if (request !== generation || (background && state.calendar && state.phase !== "loading")) return;
      setState((draft) => {
        draft.phase = "error";
      });
    }
  }

  /** A channel routine that cannot open would leave its pane loading, so it does not show. */
  const visibleRoutines = createMemo(() =>
    (state.calendar?.routines ?? []).filter((routine) => props.channelsSupported || routine.owner.kind !== "channel"),
  );

  const routines = createMemo<RoutineCalendarRoutine[]>(() => {
    const members = new Map(
      props.channels.map((channel) => [channel.id, channel.members.map((member) => member.agentId)]),
    );
    return visibleRoutines().map((routine) => ({
      id: routine.id,
      name: routine.name,
      agentIds: routine.owner.kind === "agent" ? [routine.owner.agentId] : (members.get(routine.owner.channelId) ?? []),
      schedule: routine.schedule,
    }));
  });

  const runs = createMemo(() => {
    const active = new Map(visibleRoutines().map((routine) => [routine.id, routine.active]));
    return (state.calendar?.runs ?? [])
      .filter((run) => active.has(run.routineId))
      .map((run) => ({
        id: run.id,
        routineId: run.routineId,
        at: run.at,
        status: calendarStatus(run.status, active.get(run.routineId) ?? false),
      }));
  });

  function openRoutine(routineId: string): void {
    const routine = state.calendar?.routines.find((candidate) => candidate.id === routineId);
    if (routine) props.onOpenRoutine(routine);
  }

  // The page stays open when the user switches the server, so the calendar clears, loads and listens again.
  createEffect(
    () => props.serverId,
    (serverId) => {
      setState((draft) => {
        draft.calendar = null;
      });
      void load();
      const unsubscribe = props.source.onStale(serverId, () => void load(true));
      return () => {
        generation++;
        unsubscribe();
      };
    },
  );
  onSettled(() => {
    // A planned run that passes without a result keeps its place; the clock only moves "now".
    const clock = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(clock);
  });

  return (
    <div class="schedule-pane">
      <RoutineCalendar
        routines={routines()}
        runs={runs()}
        agents={props.agents}
        now={now()}
        timeZone={timeZone}
        hostName={props.hostName}
        state={state.phase}
        onRangeChange={(first, last) => {
          range = rangeAround(Date.parse(first), Date.parse(last));
          void load();
        }}
        onOpenRoutine={openRoutine}
        onOpenAgent={props.onOpenAgent}
        onRetry={() => void load()}
        onCreateRoutine={props.onCreateRoutine}
        onBack={props.onBack}
      />
    </div>
  );
}
