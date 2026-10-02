import type {
  RoutineCalendar as HostCalendar,
  RoutineCalendarInput,
  RoutineCalendarRunStatus,
} from "@openbot/contracts/ipc";
import {
  RoutineCalendar,
  type RoutineCalendarRoutine,
  type RoutineCalendarStatus,
} from "@openbot/ui/features/conversation/RoutineCalendar";
import { createMemo, createSignal, createStore, onSettled } from "solid-js";
import { useNavigation } from "../../navigation";
import { useAgents } from "../agents/agents-context";
import { useChannels } from "../channels/channels-context";
import { useUsage } from "../usage/usage-context";
import { type SchedulePort, schedulePort } from "./schedule-port";

const DAY = 86_400_000;

interface SchedulePanelProps {
  serverId: string;
  hostName: string;
  onBack: () => void;
  port?: SchedulePort;
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

export function SchedulePanel(props: SchedulePanelProps) {
  const port = () => props.port ?? schedulePort();
  const { agentList, agentSetupOpen, creatingAgent, setSettingsRequest } = useAgents();
  const { selectAgent } = useNavigation();
  const channels = useChannels();
  const { dismissUsage } = useUsage();
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
      const calendar = await port().agent.routineCalendar({ ...range }, serverId);
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

  const routines = createMemo<RoutineCalendarRoutine[]>(() => {
    const members = new Map(
      channels.state.channels.map((channel) => [channel.id, channel.members.map((member) => member.agentId)]),
    );
    return (state.calendar?.routines ?? []).map((routine) => ({
      id: routine.id,
      name: routine.name,
      agentIds: routine.owner.kind === "agent" ? [routine.owner.agentId] : (members.get(routine.owner.channelId) ?? []),
      schedule: routine.schedule,
    }));
  });

  const runs = createMemo(() => {
    const active = new Map((state.calendar?.routines ?? []).map((routine) => [routine.id, routine.active]));
    return (state.calendar?.runs ?? []).map((run) => ({
      id: run.id,
      routineId: run.routineId,
      at: run.at,
      status: calendarStatus(run.status, active.get(run.routineId) ?? false),
    }));
  });

  function openRoutine(routineId: string): void {
    const routine = state.calendar?.routines.find((candidate) => candidate.id === routineId);
    if (!routine) return;
    if (routine.owner.kind === "channel") {
      // An open channel does not open again, so its settings would stay under the pane.
      dismissUsage();
      // The channel settings hold its routines one step down.
      void channels.editChannel(routine.owner.channelId);
      return;
    }
    const agentId = routine.owner.agentId;
    // As in the global search: the agent cannot change while a new agent is being created.
    if (agentSetupOpen() && creatingAgent()) return;
    selectAgent(agentId);
    setSettingsRequest({ agentId, nonce: Date.now(), routine: { routineId, name: routine.name } });
  }

  onSettled(() => {
    void load();
    const unsubscribe = port().agent.onScopedEvent(({ serverId, event }) => {
      if (serverId !== props.serverId) return;
      if (
        event.type === "routines-changed" ||
        event.type === "channel-routines-changed" ||
        event.type === "agents-changed" ||
        // A routine run ends as a turn: its slot changes from planned to its outcome.
        (event.type === "turn-completed" && event.origin === "routine")
      )
        void load(true);
    });
    const reconnect = port().servers.onEvent((servers) => {
      if (servers.some((server) => server.id === props.serverId && server.state === "online")) void load(true);
    });
    // A planned run that passes without a result keeps its place; the clock only moves "now".
    const clock = window.setInterval(() => setNow(new Date()), 60_000);
    return () => {
      generation++;
      unsubscribe();
      reconnect();
      window.clearInterval(clock);
    };
  });

  return (
    <div class="schedule-pane">
      <RoutineCalendar
        routines={routines()}
        runs={runs()}
        agents={agentList()}
        now={now()}
        timeZone={timeZone}
        hostName={props.hostName}
        state={state.phase}
        onRangeChange={(first, last) => {
          range = rangeAround(Date.parse(first), Date.parse(last));
          void load();
        }}
        onOpenRoutine={openRoutine}
        onOpenAgent={selectAgent}
        onRetry={() => void load()}
        onBack={props.onBack}
      />
    </div>
  );
}
