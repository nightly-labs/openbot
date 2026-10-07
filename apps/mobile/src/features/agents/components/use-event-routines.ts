import type { EventRoutineOwner } from "@openbot/contracts/ipc-events";
import { useQuery } from "@tanstack/react-query";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";

/**
 * The routines with an event trigger of one agent or channel. The query runs only when the host
 * lets the reader manage events, so a member who cannot does not see a load error.
 */
export function useEventRoutines(
  owner: EventRoutineOwner,
  serverId: string,
  enabled: boolean,
  key: readonly unknown[],
) {
  const workspace = useMobileWorkspace();
  const eventsEnabled = enabled && workspace.canManageEvents(serverId);
  const eventRoutines = useQuery({
    enabled: eventsEnabled,
    retry: false,
    staleTime: 0,
    gcTime: 0,
    // Under "routines", so the routine change events that invalidate that key also reload this list.
    queryKey: [...key, "routines", "events"],
    queryFn: () => workspace.listEventRoutines(owner, serverId),
  });
  const webhookRoutines = (eventRoutines.data ?? []).filter((routine) => routine.trigger.kind === "webhook");
  return { eventsEnabled, eventRoutines, webhookRoutines };
}
