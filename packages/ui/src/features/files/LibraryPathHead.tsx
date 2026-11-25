import type { LibraryFolder, StoredFileWorkflowFolder } from "@openbot/contracts/ipc";
import { Button, ChevronRight, Folder, Waypoints } from "@openbot/ui";
import type { AgentProfile } from "@openbot/ui/data";
import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";
import { AgentAvatar } from "../agents/AgentAvatar";
import type { LibraryDropMark } from "./library-folder-drag";
import type { LibraryLocation } from "./library-folders-view";

interface LibraryPathHeadProps {
  place: LibraryLocation;
  title: string;
  agent: AgentProfile | undefined;
  parents: readonly LibraryFolder[];
  workflowFolder?: StoredFileWorkflowFolder | null | undefined;
  onGo: (place: LibraryLocation) => void;
  dropMark: (agentId: string, folderId: string | null) => LibraryDropMark | undefined;
  children: JSX.Element;
}

export function LibraryPathHead(props: LibraryPathHeadProps) {
  const parentAgent = () => (props.place.kind === "folder" ? props.agent : undefined);
  const headAgent = () => (props.place.kind === "agent" ? props.agent : undefined);
  return (
    <header class="library-path-head">
      <div class="library-path">
        <Show when={parentAgent()} keyed>
          {(agent) => (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                class="library-crumb"
                data-library-agent={agent.id}
                data-library-drop="go"
                data-drop={props.dropMark(agent.id, null) === "into" ? "into" : undefined}
                onClick={() => props.onGo({ kind: "agent", agentId: agent.id })}
              >
                <AgentAvatar agent={agent} class="library-path-avatar" />
                <span class="library-truncate" dir="auto">
                  {agent.name}
                </span>
              </Button>
              <ChevronRight class="library-path-rule" aria-hidden="true" />
            </>
          )}
        </Show>
        <For each={props.parents} keyed={(folder) => folder.id}>
          {(folder) => (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                class="library-crumb"
                data-library-agent={folder().agentId}
                data-library-folder={folder().id}
                data-library-drop="go"
                data-drop={props.dropMark(folder().agentId, folder().id) === "into" ? "into" : undefined}
                onClick={() => props.onGo({ kind: "folder", agentId: folder().agentId, folderId: folder().id })}
              >
                <span class="library-truncate" dir="auto">
                  {folder().name}
                </span>
              </Button>
              <ChevronRight class="library-path-rule" aria-hidden="true" />
            </>
          )}
        </For>
        <Show when={props.place.kind === "workflow" ? props.workflowFolder : undefined} keyed>
          {(folder) => (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                class="library-crumb"
                onClick={() => props.onGo({ kind: "workflowFolder", folderId: folder.id })}
              >
                <span class="library-truncate" dir="auto">
                  {folder.name}
                </span>
              </Button>
              <ChevronRight class="library-path-rule" aria-hidden="true" />
            </>
          )}
        </Show>
        <h2 class="library-path-current">
          <Show when={headAgent()} keyed>
            {(agent) => <AgentAvatar agent={agent} class="library-path-avatar" />}
          </Show>
          <Show when={props.place.kind === "folder" || props.place.kind === "workflowFolder"}>
            <Folder aria-hidden="true" />
          </Show>
          <Show when={props.place.kind === "workflow"}>
            <Waypoints aria-hidden="true" />
          </Show>
          <span class="library-truncate" dir="auto">
            {props.title}
          </span>
        </h2>
      </div>
      <div class="library-path-tools">{props.children}</div>
    </header>
  );
}
