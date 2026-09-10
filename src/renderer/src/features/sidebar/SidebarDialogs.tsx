/** The sidebar's agent, channel and section confirmations share one pending delete state. */

import { Show } from "solid-js";
import { AlertDialog, Button, Trash2 } from "../../components/ui";
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
  let agentDeleteButton: HTMLButtonElement | undefined;
  let channelDeleteButton: HTMLButtonElement | undefined;
  let sectionDeleteButton: HTMLButtonElement | undefined;
  return (
    <>
      <AlertDialog.Root
        open={Boolean(deleteTarget())}
        onOpenChange={(open) => {
          if (!open && !deleting()) closeDelete();
        }}
      >
        <Show when={deleteTarget()}>
          {(agent) => (
            <AlertDialog.Portal>
              <AlertDialog.Overlay class="agent-delete-backdrop">
                <AlertDialog.Content
                  class="agent-delete-dialog"
                  onOpenAutoFocus={(event) => {
                    event.preventDefault();
                    agentDeleteButton?.focus({ preventScroll: true });
                  }}
                >
                  <AgentAvatar
                    agent={agent()}
                    style={{
                      width: "44px",
                      height: "44px",
                      "margin-bottom": "15px",
                    }}
                  />
                  <AlertDialog.Title>Delete {agent().name}?</AlertDialog.Title>
                  <AlertDialog.Description>
                    This removes the agent and its OpenBot conversation from the app. Its queue, memories, routines, and
                    workspace are deleted. History stored separately by the connected CLI provider is not deleted.
                  </AlertDialog.Description>
                  <Show when={deleteError()}>{(message) => <p class="agent-delete-error">{message()}</p>}</Show>
                  <div class="agent-delete-actions">
                    <Button variant="outline" type="button" disabled={deleting()} onClick={closeDelete}>
                      Cancel
                    </Button>
                    <Button
                      ref={(element) => {
                        agentDeleteButton = element;
                      }}
                      variant="destructive"
                      type="button"
                      class="agent-delete-confirm"
                      disabled={deleting()}
                      onClick={() => void confirmDelete()}
                    >
                      {deleting() ? "Deleting…" : "Delete"}
                    </Button>
                  </div>
                </AlertDialog.Content>
              </AlertDialog.Overlay>
            </AlertDialog.Portal>
          )}
        </Show>
      </AlertDialog.Root>

      <AlertDialog.Root
        open={Boolean(channelDeleteTarget())}
        onOpenChange={(open) => {
          if (!open && !deleting()) closeDelete();
        }}
      >
        <Show when={channelDeleteTarget()}>
          {(channel) => (
            <AlertDialog.Portal>
              <AlertDialog.Overlay class="agent-delete-backdrop">
                <AlertDialog.Content
                  class="agent-delete-dialog"
                  onOpenAutoFocus={(event) => {
                    event.preventDefault();
                    channelDeleteButton?.focus({ preventScroll: true });
                  }}
                >
                  <ChannelAvatar members={channel().members} agents={props.agents} layout="cluster" />
                  <AlertDialog.Title>Delete {channel().name}?</AlertDialog.Title>
                  <AlertDialog.Description>
                    This removes the channel, its messages, tasks, memories, and routines from the app and stops its
                    work. Member agents are kept. This action cannot be undone.
                  </AlertDialog.Description>
                  <Show when={deleteError()}>{(message) => <p class="agent-delete-error">{message()}</p>}</Show>
                  <div class="agent-delete-actions">
                    <Button variant="outline" type="button" disabled={deleting()} onClick={closeDelete}>
                      Cancel
                    </Button>
                    <Button
                      ref={(element) => {
                        channelDeleteButton = element;
                      }}
                      variant="destructive"
                      type="button"
                      class="agent-delete-confirm"
                      disabled={deleting()}
                      onClick={() => void confirmDelete()}
                    >
                      {deleting() ? "Deleting…" : "Delete"}
                    </Button>
                  </div>
                </AlertDialog.Content>
              </AlertDialog.Overlay>
            </AlertDialog.Portal>
          )}
        </Show>
      </AlertDialog.Root>

      <AlertDialog.Root
        open={Boolean(sectionDeleteTarget())}
        onOpenChange={(open) => {
          if (!open && !deleting()) closeDelete();
        }}
      >
        <Show when={sectionDeleteTarget()}>
          {(section) => (
            <AlertDialog.Portal>
              <AlertDialog.Overlay class="agent-delete-backdrop">
                <AlertDialog.Content
                  class="agent-delete-dialog sidebar-section-delete-dialog"
                  onOpenAutoFocus={(event) => {
                    event.preventDefault();
                    sectionDeleteButton?.focus({ preventScroll: true });
                  }}
                >
                  <span class="sidebar-section-delete-icon" aria-hidden="true">
                    <Trash2 class="size-5" />
                  </span>
                  <AlertDialog.Title>Delete {section().name}?</AlertDialog.Title>
                  <AlertDialog.Description>
                    Agents in this section will move to Unassigned. No agents will be deleted.
                  </AlertDialog.Description>
                  <Show when={deleteError()}>{(message) => <p class="agent-delete-error">{message()}</p>}</Show>
                  <div class="agent-delete-actions">
                    <Button variant="outline" type="button" disabled={deleting()} onClick={closeDelete}>
                      Cancel
                    </Button>
                    <Button
                      ref={(element) => {
                        sectionDeleteButton = element;
                      }}
                      variant="destructive"
                      type="button"
                      class="agent-delete-confirm"
                      disabled={deleting()}
                      onClick={() => void confirmSectionDelete()}
                    >
                      {deleting() ? "Deleting…" : "Delete"}
                    </Button>
                  </div>
                </AlertDialog.Content>
              </AlertDialog.Overlay>
            </AlertDialog.Portal>
          )}
        </Show>
      </AlertDialog.Root>
    </>
  );
}
