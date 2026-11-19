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
import { useText } from "@openbot/ui/text";
import { createEffect, createMemo, createSignal, createStore, onSettled } from "solid-js";
import { actionToast } from "../../action-toast";
import { useNavigation } from "../../navigation";
import { useAgents } from "../agents/agents-context";
import { useChannels } from "../channels/channels-context";
import type { RoutinesPort } from "../conversation/routines-port";
import { useServers } from "../servers/servers-context";
import { createPageHeaderFrame } from "../window/page-header-frame";
import { useWindowPage } from "../window/window-page-context";
import { desktopScheduleSource, type ScheduleSource } from "./schedule-port";
import { scheduleRoutineCreate, scheduleRoutinePorts } from "./schedule-routine-create";

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
  channels: readonly { id: string; members: readonly { agentId: string }[] }[];
  channelsSupported: boolean;
  onOpenAgent: (agentId: string) => void;
  onOpenRoutine: (routine: ScheduleRoutine) => void;
  onCreateRoutine: (agentId: string) => void;
  routinePorts?: ((agentId: string) => RoutinesPort) | undefined;
}

function rangeAround(first: number, last: number): RoutineCalendarInput {
  return { from: new Date(first - DAY).toISOString(), to: new Date(last + 2 * DAY).toISOString() };
}

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
  const { agentList, agentSetupOpen, creatingAgent, setSettingsRequest } = useAgents();
  const { selectAgent } = useNavigation();
  const channels = useChannels();
  const windowPage = useWindowPage();
  const { servers } = useServers();
  const routinePorts = createMemo(() =>
    scheduleRoutinePorts(
      servers().find((server) => server.id === props.serverId),
      undefined,
    ),
  );

  function openRoutine(routine: ScheduleRoutine): void {
    if (routine.owner.kind === "channel") {
      windowPage.showAgents();
      void channels.editChannel(routine.owner.channelId);
      return;
    }
    const agentId = routine.owner.agentId;
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
      routinePorts={routinePorts()}
    />
  );
}

export function ScheduleView(props: ScheduleViewProps) {
  const { t } = useText();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [now, setNow] = createSignal(new Date());
  const [state, setState] = createStore<{ phase: "loading" | "ready" | "error"; calendar: HostCalendar | null }>({
    phase: "loading",
    calendar: null,
  });
  let range = rangeAround(Date.now() - 7 * DAY, Date.now() + 7 * DAY);
  let generation = 0;

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
      if (request !== generation || (background && state.calendar && state.phase !== "loading")) return;
      setState((draft) => {
        draft.phase = "error";
      });
    }
  }

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
    const clock = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(clock);
  });

  const create = createMemo(() => {
    const ports = props.routinePorts;
    return ports
      ? scheduleRoutineCreate(
          ports,
          () => void load(true),
          () => actionToast.warning(t("routine.settings.runInSaveFailed")),
        )
      : undefined;
  });

  const headerFrame = createPageHeaderFrame();
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
        create={create()}
        onBack={props.onBack}
        frame={headerFrame()}
      />
    </div>
  );
}
