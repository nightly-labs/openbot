import { CHANNEL_CHATS_CAPABILITY } from "@openbot/contracts/ipc";
import { createContext, type ParentProps, untrack, useContext } from "solid-js";
import { useAuth } from "../account/account-context";
import { useAgents } from "../agents/agents-context";
import { useDirectMessages } from "../conversation/direct-messages-context";
import { useServers } from "../servers/servers-context";
import { useUsage } from "../usage/usage-context";
import { readChannelSelection, writeChannelSelection } from "./channel-selection";
import { type ChannelsController, createChannelsController } from "./channels-controller";
import { channelsPort } from "./channels-port";

const ChannelsContext = createContext<ChannelsController>(undefined, { name: "Channels" });

export function useChannels(): ChannelsController {
  try {
    return useContext(ChannelsContext);
  } catch (cause) {
    throw new Error("Channels is unavailable outside its provider.", { cause });
  }
}

/** Mounts a channels controller that a client built with its own environment. */
export function ChannelsControllerProvider(props: ParentProps<{ controller: ChannelsController }>) {
  return <ChannelsContext value={props.controller}>{props.children}</ChannelsContext>;
}

/** The desktop channels domain: preload is the runtime, and the app's contexts are the environment. */
export function ChannelsProvider(props: ParentProps) {
  const { activeServer, activeServerId, activeServerSupportsCapability } = useServers();
  const { agentList, setAgentSetupOpen } = useAgents();
  const { clearDirectSelection, setDirectTyping } = useDirectMessages();
  const usage = useUsage();
  const { centralAuth } = useAuth();
  const selectionServerId = untrack(activeServerId);
  const accountKey = () => {
    const auth = centralAuth();
    return auth.status === "signed_in" ? auth.user.id : auth.status;
  };
  const controller = createChannelsController({
    port: channelsPort,
    agents: agentList,
    scopeKey: accountKey,
    readSelection: (account) =>
      account === "loading" || account === "error"
        ? null
        : (readChannelSelection()[account]?.[selectionServerId] ?? null),
    writeSelection: (channelId) => {
      const status = centralAuth().status;
      if (status === "signed_in" || status === "signed_out") {
        writeChannelSelection(accountKey(), selectionServerId, channelId);
      }
    },
    supported: () => activeServerSupportsCapability(CHANNEL_CHATS_CAPABILITY),
    deletionSupported: () =>
      activeServer()?.kind !== "remote" || activeServer()?.role === "owner" || activeServer()?.role === "admin",
    beforeOpen: () => {
      setAgentSetupOpen(false);
      // The channel covers the workspace, and a direct conversation left selected under it is read
      // automatically as its messages arrive. Selecting an agent closes the channel in the shared
      // navigation; this is the same exchange the other way round.
      setDirectTyping(false);
      clearDirectSelection();
      usage.dismissUsage();
    },
    // The Usage report covers the workspace content and marks it inert, so a message that
    // arrives behind it was never seen, however focused the window is. The channel stays
    // selected under the report, which is the state this read has to refuse.
    canMarkRead: () => document.hasFocus() && !usage.state.serverId,
  });
  return <ChannelsControllerProvider controller={controller}>{props.children}</ChannelsControllerProvider>;
}
