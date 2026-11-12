import type { LibraryFolder } from "@openbot/contracts/ipc";
import { Button, ChevronRight, Folder } from "@openbot/ui";
import type { AgentProfile } from "@openbot/ui/data";
import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";
import { AgentAvatar } from "../agents/AgentAvatar";
import type { LibraryLocation } from "./library-folders-view";

interface LibraryPathHeadProps {
  place: LibraryLocation;
  /** The name of the place: "All files", the agent, or the folder. */
  title: string;
  /** The agent of the place, when the place is an agent or a folder. */
  agent: AgentProfile | undefined;
  /** The folders above the folder of the place, from the top level down. */
  parents: readonly LibraryFolder[];
  onGo: (place: LibraryLocation) => void;
  /** The controls at the end of the row. */
  children: JSX.Element;
}

/** The top row of the Library with folders: the path of the place, then the controls of the page. */
export function LibraryPathHead(props: LibraryPathHeadProps) {
  /** The agent of the current folder. It is the first step of the path. */
  const parentAgent = () => (props.place.kind === "folder" ? props.agent : undefined);
  /** The agent whose files are the place. Its avatar is at the start of the title. */
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
        <h2 class="library-path-current">
          <Show when={headAgent()} keyed>
            {(agent) => <AgentAvatar agent={agent} class="library-path-avatar" />}
          </Show>
          <Show when={props.place.kind === "folder"}>
            <Folder aria-hidden="true" />
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
