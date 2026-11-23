import type { DynamicIslandAction } from "@openbot/contracts/ipc";
import { createSignal } from "solid-js";
import { createSimpleContext } from "../../simple-context";

type ServerScopedIslandAction = Extract<DynamicIslandAction, { serverId: string }>;

const ServerSwitch = createSimpleContext({
  name: "Server switch",
  init: () => {
    const [browserVisibilitySuspended, setBrowserVisibilitySuspended] = createSignal(false);
    const [pendingAgentSelection, setPendingAgentSelection] = createSignal<string | null>(null);
    const [pendingChannelSelection, setPendingChannelSelection] = createSignal<string | null>(null);
    const [pendingThreadSelection, setPendingThreadSelection] = createSignal<{
      agentId: string;
      threadId: string;
    } | null>(null);
    const [pendingIslandAction, setPendingIslandAction] = createSignal<ServerScopedIslandAction | null>(null);
    const [previousServerId, setPreviousServerId] = createSignal<string | null>(null);
    return {
      browserVisibilitySuspended,
      setBrowserVisibilitySuspended,
      pendingAgentSelection,
      setPendingAgentSelection,
      pendingChannelSelection,
      setPendingChannelSelection,
      pendingThreadSelection,
      setPendingThreadSelection,
      pendingIslandAction,
      setPendingIslandAction,
      previousServerId,
      setPreviousServerId,
    };
  },
});

export const ServerSwitchProvider = ServerSwitch.provider;
export const useServerSwitch = ServerSwitch.use;
