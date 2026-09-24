/** The sidebar's agent, channel and section confirmations share one pending delete state. */

import { ConfirmDialog } from "@openbot/ui";
import { Show } from "solid-js";
import { AgentAvatar } from "../agents/AgentAvatar";
import { ChannelAvatar } from "../channels/ChannelAvatar";
import { useSidebarScope } from "./sidebar-scope";

export function SidebarDialogs() {
  const {
    closeDelete,
    confirmDelete,
    confirmSectionDelete,
    deleteError,
    deleteTarget,
    channelDeleteTarget,
    deleting,
    props,
    sectionDeleteTarget,
  } = useSidebarScope();
  const shared = {
    confirmLabel: "Delete",
    pendingLabel: "Deleting…",
    onCancel: closeDelete,
  };
  // Each dialog unmounts with its target, so its text never shows an empty name while it closes.
  return (
    <>
      <Show when={deleteTarget()}>
        {(agent) => (
          <ConfirmDialog
            {...shared}
            open
            pending={deleting()}
            error={deleteError()}
            media={<AgentAvatar agent={agent()} style={{ width: "44px", height: "44px" }} />}
            title={`Delete ${agent().name}?`}
            description="This removes the agent and its OpenBot conversation from the app. Its queue, memories, routines, and workspace are deleted. History stored separately by the connected CLI provider is not deleted."
            onConfirm={confirmDelete}
          />
        )}
      </Show>

      <Show when={channelDeleteTarget()}>
        {(channel) => (
          <ConfirmDialog
            {...shared}
            open
            pending={deleting()}
            error={deleteError()}
            media={<ChannelAvatar members={channel().members} agents={props.agents} layout="cluster" />}
            title={`Delete ${channel().name}?`}
            description="This stops the channel. Its history stays in Deleted channels for preview only. You cannot restore it. Member agents are kept."
            onConfirm={confirmDelete}
          />
        )}
      </Show>

      <Show when={sectionDeleteTarget()}>
        {(section) => (
          <ConfirmDialog
            {...shared}
            open
            pending={deleting()}
            error={deleteError()}
            title={`Delete ${section().name}?`}
            description="Agents in this section will move to Unassigned. No agents will be deleted."
            onConfirm={confirmSectionDelete}
          />
        )}
      </Show>
    </>
  );
}
