/**
 * The folders a local agent can change besides its workspace and the shared folder, and the folders in
 * them that it must not change: the Folders row of the settings panel, its page, and the folder half
 * of the chat's drop overlay. With Ask first or Full access the agent can change all files, so the
 * folders apply only in Workspace only.
 */

import {
  AGENT_FOLDER_LIMIT,
  type AgentExclusionChange,
  type AgentFolderChange,
  type AgentFolderCoverageReason,
  type AgentFolderList,
  agentFolderName,
  folderInside,
} from "@openbot/contracts/ipc";
import {
  Button,
  Folder,
  FolderInput,
  FolderPlus,
  IconButton,
  Lock,
  Plus,
  ShieldCheck,
  TriangleAlert,
  toast,
  Upload,
  X,
} from "@openbot/ui";
import { SettingsLinkGroup, SettingsLinkRow } from "@openbot/ui/components/SettingsPanel";
import { createSignal, createStore, For, onSettled, Show } from "solid-js";
import { useText } from "../../text";

/** The calls of the computer that runs the agent. Each change returns the list as it is after it. */
export interface AgentFolderCalls {
  list: (agentId: string) => Promise<AgentFolderList>;
  /** Opens the folder picker. With `replace`, the picked folder takes that folder's place. */
  choose: (agentId: string, replace?: string) => Promise<AgentFolderChange>;
  add: (agentId: string, path: string) => Promise<AgentFolderChange>;
  remove: (agentId: string, path: string) => Promise<AgentFolderChange>;
  /** Adds a folder dragged from the computer's file manager. */
  drop: (agentId: string, folder: File) => Promise<AgentFolderChange>;
  /** Opens the folder picker for a folder the agent must not change. */
  exclude: (agentId: string) => Promise<AgentExclusionChange>;
  addExclusion: (agentId: string, path: string) => Promise<AgentExclusionChange>;
  /** The agent can change the excluded folder again. */
  include: (agentId: string, path: string) => Promise<AgentExclusionChange>;
}

interface AgentFolderSource {
  agentId: string;
  agentName: string;
  calls: AgentFolderCalls;
}

const COVERED_TEXT = {
  "already-added": "agentSettings.folders.alreadyAdded",
  "in-workspace": "agentSettings.folders.inWorkspace",
  "in-shared": "agentSettings.folders.inShared",
  "in-folder": "agentSettings.folders.inFolder",
} as const satisfies Record<AgentFolderCoverageReason, string>;

/**
 * The folders of the dropped items, or null when one of them is a file: the user then attaches the
 * files.
 */
export function droppedFolders(transfer: DataTransfer | null): File[] | null {
  if (!transfer) return null;
  const folders: File[] = [];
  for (const item of transfer.items) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (!file || item.webkitGetAsEntry()?.isDirectory !== true) return null;
    folders.push(file);
  }
  return folders.length > 0 ? folders : null;
}

export function carriesFiles(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes("Files") === true;
}

/**
 * The folders of one agent and the changes the user makes to them. Each change says its result in a
 * toast; adding and removing can be undone there. A folder the agent can already change makes the row
 * that gives it flash.
 */
export function createAgentFolders(source: () => AgentFolderSource | undefined) {
  const { t, errorMessage } = useText();
  const [state, setState] = createStore<{ list: AgentFolderList | null; flash: string | null }>({
    list: null,
    flash: null,
  });
  let request = 0;
  /** The agent the list belongs to. A late answer for the agent shown before is dropped. */
  let shown: string | undefined;

  function setList(agentId: string, list: AgentFolderList): void {
    if (shown !== agentId) return;
    setState((current) => {
      current.list = list;
    });
  }

  function flash(path: string): void {
    setState((current) => {
      current.flash = null;
    });
    // The next frame sets it again, so the row flashes on each try.
    requestAnimationFrame(() =>
      setState((current) => {
        current.flash = path;
      }),
    );
  }

  function failed(error: unknown): void {
    toast.error(errorMessage(error, t("agentSettings.folders.failed")));
  }

  async function run(change: () => Promise<AgentFolderChange>, current: AgentFolderSource): Promise<void> {
    try {
      report(await change(), current);
    } catch (error) {
      failed(error);
    }
  }

  async function runExclusion(change: () => Promise<AgentExclusionChange>, current: AgentFolderSource): Promise<void> {
    try {
      reportExclusion(await change(), current);
    } catch (error) {
      failed(error);
    }
  }

  function reportExclusion(change: AgentExclusionChange, current: AgentFolderSource): void {
    const { agentId, agentName: agent, calls } = current;
    setList(agentId, change.list);
    if (change.outcome === "cancelled") return;
    const folder = agentFolderName(change.path);
    switch (change.outcome) {
      case "excluded": {
        // A folder that holds folders already excluded took their place: Undo gives them back.
        const { replaced } = change;
        const undo = async (): Promise<AgentExclusionChange> => {
          const included = await calls.include(agentId, change.path);
          let list = included.list;
          for (const path of replaced) list = (await calls.addExclusion(agentId, path)).list;
          return { ...included, list };
        };
        toast.success(t("agentSettings.folders.toastExcluded", { agent, folder }), {
          action: { label: t("agentSettings.folders.undo"), onClick: () => void runExclusion(undo, current) },
        });
        return;
      }
      case "included":
        toast(t("agentSettings.folders.toastIncluded", { agent, folder }), {
          action: {
            label: t("agentSettings.folders.undo"),
            onClick: () => void runExclusion(() => calls.addExclusion(agentId, change.path), current),
          },
        });
        return;
      case "covered":
        toast(
          change.folder === change.path
            ? t("agentSettings.folders.alreadyExcluded", { folder })
            : t("agentSettings.folders.inExcluded", { folder, parent: agentFolderName(change.folder) }),
        );
        flash(change.folder);
        return;
      case "refused":
        if (change.refusal === "limit")
          toast.error(t("agentSettings.folders.excludeLimit", { count: AGENT_FOLDER_LIMIT }));
        else if (change.refusal === "outside")
          toast.error(t("agentSettings.folders.excludeOutside", { agent, folder }));
        else if (change.refusal === "root") toast.error(t("agentSettings.folders.excludeRoot", { folder }));
        else toast.error(t("agentSettings.folders.missing", { folder }));
        return;
    }
  }

  function report(change: AgentFolderChange, current: AgentFolderSource): void {
    const { agentId, agentName: agent, calls } = current;
    setList(agentId, change.list);
    if (change.outcome === "cancelled") return;
    const folder = agentFolderName(change.path);
    switch (change.outcome) {
      // Undo cannot give back the folder that Locate replaced: it is no longer on the disk.
      case "replaced":
        toast.success(t("agentSettings.folders.toastAdded", { agent, folder }));
        return;
      case "added": {
        // A folder that holds folders already added took their place: Undo gives them back.
        const { replaced } = change;
        const undo = async (): Promise<AgentFolderChange> => {
          const removed = await calls.remove(agentId, change.path);
          let list = removed.list;
          for (const path of replaced) list = (await calls.add(agentId, path)).list;
          return { ...removed, list };
        };
        toast.success(t("agentSettings.folders.toastAdded", { agent, folder }), {
          action: { label: t("agentSettings.folders.undo"), onClick: () => void run(undo, current) },
        });
        return;
      }
      case "removed":
        toast(t("agentSettings.folders.toastRemoved", { agent, folder }), {
          action: {
            label: t("agentSettings.folders.undo"),
            onClick: () => void run(() => calls.add(agentId, change.path), current),
          },
        });
        return;
      case "covered":
        toast(
          t(COVERED_TEXT[change.coverage.reason], {
            agent,
            folder,
            parent: agentFolderName(change.coverage.folder),
          }),
        );
        flash(change.coverage.folder);
        return;
      case "refused":
        if (change.refusal === "limit") toast.error(t("agentSettings.folders.limit", { count: AGENT_FOLDER_LIMIT }));
        else
          toast.error(
            t(change.refusal === "protected" ? "agentSettings.folders.protected" : "agentSettings.folders.missing", {
              folder,
            }),
          );
        return;
    }
  }

  function act(change: (current: AgentFolderSource) => Promise<AgentFolderChange>): Promise<void> {
    const current = source();
    return current ? run(() => change(current), current) : Promise.resolve();
  }

  function actExclusion(change: (current: AgentFolderSource) => Promise<AgentExclusionChange>): Promise<void> {
    const current = source();
    return current ? runExclusion(() => change(current), current) : Promise.resolve();
  }

  return {
    state,
    /**
     * Reads the list of `current`, also to see which folders are no longer on the disk. The caller
     * reads `current` in an effect's compute function, where props are tracked.
     */
    load(current: AgentFolderSource | undefined): void {
      const id = ++request;
      if (shown !== current?.agentId) {
        shown = current?.agentId;
        setState((next) => {
          next.list = null;
        });
      }
      if (!current) return;
      current.calls
        .list(current.agentId)
        .then((list) => {
          if (id === request) setList(current.agentId, list);
        })
        .catch(failed);
    },
    choose: (replace?: string) => act(({ agentId, calls }) => calls.choose(agentId, replace)),
    remove: (path: string) => act(({ agentId, calls }) => calls.remove(agentId, path)),
    exclude: () => actExclusion(({ agentId, calls }) => calls.exclude(agentId)),
    include: (path: string) => actExclusion(({ agentId, calls }) => calls.include(agentId, path)),
    /** One folder at a time, so each toast names its folder and the list ends with all of them. */
    async drop(folders: readonly File[]): Promise<void> {
      for (const folder of folders) await act(({ agentId, calls }) => calls.drop(agentId, folder));
    },
    clearFlash(): void {
      setState((current) => {
        current.flash = null;
      });
    },
  };
}

export type AgentFolders = ReturnType<typeof createAgentFolders>;

/** Where the folder is. The name is on the line above, so the path stops at its parent. */
function folderParent(path: string): string {
  const end = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return end > 0 ? path.slice(0, end) : path;
}

/**
 * The folder that holds an excluded folder, as the page names it, with the path below it. A folder
 * the user removed from the list no longer holds it, so the path is shown in full.
 */
function exclusionPlace(
  path: string,
  list: AgentFolderList,
  names: { workspace: string; shared: string },
): string | null {
  const holders: [string, string][] = [
    [list.workspace, names.workspace],
    [list.shared, names.shared],
    ...list.folders.map((folder): [string, string] => [folder.path, agentFolderName(folder.path)]),
  ];
  const holder = holders.find(([root]) => folderInside(root, path));
  if (!holder) return null;
  const below = folderParent(path)
    .slice(holder[0].length)
    .replace(/^[/\\]+/, "");
  return below ? `${holder[1]}/${below}` : holder[1];
}

/** Drag handlers for a place that takes a dropped folder, with the state that shows it. */
function createFolderDropTarget(onDrop: (folders: readonly File[]) => void) {
  const [over, setOver] = createSignal(false);
  return {
    over,
    handlers: {
      onDragEnter: (event: DragEvent) => {
        if (carriesFiles(event)) setOver(true);
      },
      onDragOver: (event: DragEvent) => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        // The chat under the panel does not attach what the user drops here.
        event.stopPropagation();
      },
      onDragLeave: (event: DragEvent) => {
        const target = event.currentTarget;
        if (target instanceof Node && event.relatedTarget instanceof Node && target.contains(event.relatedTarget))
          return;
        setOver(false);
      },
      onDrop: (event: DragEvent) => {
        setOver(false);
        const folders = droppedFolders(event.dataTransfer);
        if (!folders) return;
        event.preventDefault();
        event.stopPropagation();
        onDrop(folders);
      },
    },
  };
}

/**
 * The Folders row of the panel's first page. The + opens the folder picker; the rest of the row opens
 * the Folders page. A button cannot hold a button, so the + sits over an empty slot in the row.
 */
export function AgentFoldersRow(props: {
  folders: AgentFolders;
  /** The access label when the agent can change all files, such as "Full access". */
  wideAccess: string | null;
  onOpen: () => void;
  ref?: (element: HTMLButtonElement) => void;
}) {
  const { t } = useText();
  const drop = createFolderDropTarget((folders) => void props.folders.drop(folders));
  const list = () => props.folders.state.list;
  const added = () => list()?.folders.length ?? 0;
  const lost = () => list()?.folders.filter((folder) => !folder.found).length ?? 0;
  return (
    <div
      class="agent-folders-entry"
      data-dragging={drop.over() ? "" : undefined}
      data-flash={props.folders.state.flash ? "" : undefined}
      onAnimationEnd={(event) => {
        if (event.animationName === "agent-folders-row-flash") props.folders.clearFlash();
      }}
      {...drop.handlers}
    >
      <SettingsLinkRow
        ref={(element) => props.ref?.(element)}
        icon={<Folder aria-hidden="true" />}
        label={t("agentSettings.folders.title")}
        value={
          <Show
            when={!props.wideAccess}
            fallback={<span class="agent-folders-count">{t("agentSettings.folders.valueAll")}</span>}
          >
            <span class="agent-folders-count">
              <Show when={!drop.over()} fallback={t("agentSettings.folders.valueDrop")}>
                <Show when={added() > 0} fallback={t("agentSettings.folders.valueNone")}>
                  {t("agentSettings.folders.valueCount", { count: added() })}
                </Show>
              </Show>
            </span>
            <Show when={!drop.over() && lost() > 0}>
              <span class="agent-folders-dot" aria-hidden="true">
                ·
              </span>
              <span class="agent-folders-lost">{t("agentSettings.folders.valueMissing", { count: lost() })}</span>
            </Show>
            <span class="agent-folders-entry-add-slot" />
          </Show>
        }
        onClick={props.onOpen}
      />
      <Show when={!props.wideAccess}>
        <IconButton
          variant="ghost"
          size="icon-xs"
          class="agent-folders-entry-add"
          label={t("agentSettings.folders.addLabel")}
          onClick={() => void props.folders.choose()}
        >
          <Plus />
        </IconButton>
      </Show>
    </div>
  );
}

/**
 * One folder: name, where it is under it, and its actions. A named row (Workspace, Shared folder)
 * shows its full path. `fresh` marks a row the user just added.
 */
function FolderRow(props: {
  name?: string;
  path: string;
  fresh?: boolean;
  /** The folder is no longer at its path. */
  missing?: boolean;
  /** The user tried to add this folder, or a folder in it, again. */
  flash?: boolean;
  onFlashEnd?: () => void;
  onLocate?: () => void;
  onRemove?: () => void;
}) {
  const { t } = useText();
  const name = () => props.name ?? agentFolderName(props.path);
  const where = () => (props.name ? props.path : folderParent(props.path));
  return (
    <div
      class="agent-folders-row"
      data-fresh={props.fresh ? "" : undefined}
      data-missing={props.missing ? "" : undefined}
      data-flash={props.flash ? "" : undefined}
      onAnimationEnd={(event) => {
        if (event.animationName === "agent-folders-row-flash") props.onFlashEnd?.();
      }}
    >
      <span class="settings-link-icon">
        <Show when={props.missing} fallback={<Folder aria-hidden="true" />}>
          <TriangleAlert aria-hidden="true" />
        </Show>
      </span>
      <span class="agent-folders-text">
        <span class="agent-folders-name">{name()}</span>
        <span class="agent-folders-path" title={props.path}>
          <Show when={props.missing} fallback={where()}>
            {t("agentSettings.folders.notFound", { path: where() })}
          </Show>
        </span>
      </span>
      <Show when={props.missing && props.onLocate}>
        {(locate) => (
          <Button variant="outline" size="sm" onClick={() => locate()()}>
            {t("agentSettings.folders.locate")}
          </Button>
        )}
      </Show>
      <Show when={props.onRemove}>
        {(remove) => (
          <IconButton
            label={t("agentSettings.folders.remove", { folder: name() })}
            variant="ghost"
            size="icon-sm"
            class="agent-folders-remove"
            onClick={() => remove()()}
          >
            <X />
          </IconButton>
        )}
      </Show>
    </div>
  );
}

/** One folder the agent must not change, and where it is. */
function ExclusionRow(props: {
  path: string;
  place: string | null;
  fresh?: boolean;
  flash?: boolean;
  onFlashEnd?: () => void;
  onInclude: () => void;
}) {
  const { t } = useText();
  const name = () => agentFolderName(props.path);
  const where = () => {
    const place = props.place;
    return place ? t("agentSettings.folders.excludedIn", { folder: place }) : folderParent(props.path);
  };
  return (
    <div
      class="agent-folders-row"
      data-fresh={props.fresh ? "" : undefined}
      data-flash={props.flash ? "" : undefined}
      onAnimationEnd={(event) => {
        if (event.animationName === "agent-folders-row-flash") props.onFlashEnd?.();
      }}
    >
      <span class="settings-link-icon">
        <Lock aria-hidden="true" />
      </span>
      <span class="agent-folders-text">
        <span class="agent-folders-name">{name()}</span>
        <span class="agent-folders-path" title={props.path}>
          {where()}
        </span>
      </span>
      <IconButton
        label={t("agentSettings.folders.include", { folder: name() })}
        variant="ghost"
        size="icon-sm"
        class="agent-folders-remove"
        onClick={() => props.onInclude()}
      >
        <X />
      </IconButton>
    </div>
  );
}

/** The Folders page of the settings panel. */
export function AgentFoldersPage(props: {
  folders: AgentFolders;
  agentName: string;
  /** The access label when the agent can change all files, such as "Full access". */
  wideAccess: string | null;
  /** The label of the level the folders apply in. */
  workspaceAccess: string;
  /**
   * Whether to show the excluded folders. Only Workspace only blocks them, so they show there or
   * under the wide-access note that says so.
   */
  showExclusions: boolean;
  onChangeAccess: () => void;
}) {
  const { t } = useText();
  const drop = createFolderDropTarget((folders) => void props.folders.drop(folders));
  // The rows that are there when the page opens do not animate in; a folder added later does.
  let opened = false;
  onSettled(() => {
    opened = true;
  });
  const flash = () => props.folders.state.flash;
  const clearFlash = () => props.folders.clearFlash();
  return (
    <div class="agent-folders-page">
      <Show when={props.wideAccess}>
        {(access) => (
          <SettingsLinkGroup inset>
            <div class="agent-folders-access" role="status">
              <span class="settings-link-icon">
                <ShieldCheck aria-hidden="true" />
              </span>
              <span class="agent-folders-access-text">
                {t("agentSettings.folders.wideAccess", {
                  access: access(),
                  agent: props.agentName,
                  workspace: props.workspaceAccess,
                })}
              </span>
              <Button variant="outline" size="sm" onClick={props.onChangeAccess}>
                {t("agentSettings.folders.changeAccess")}
              </Button>
            </div>
          </SettingsLinkGroup>
        )}
      </Show>
      <Show when={props.folders.state.list}>
        {(list) => (
          <>
            <SettingsLinkGroup inset title={t("agentSettings.folders.always")}>
              <FolderRow
                name={t("agentSettings.folders.workspace")}
                path={list().workspace}
                flash={flash() === list().workspace}
                onFlashEnd={clearFlash}
              />
              <FolderRow
                name={t("agentSettings.folders.shared")}
                path={list().shared}
                flash={flash() === list().shared}
                onFlashEnd={clearFlash}
              />
            </SettingsLinkGroup>
            <div class="agent-folders-drop-target" data-dragging={drop.over() ? "" : undefined} {...drop.handlers}>
              <SettingsLinkGroup inset title={t("agentSettings.folders.added")}>
                <For each={list().folders} keyed={(folder) => folder.path}>
                  {(folder) => {
                    const fresh = opened;
                    return (
                      <FolderRow
                        path={folder().path}
                        fresh={fresh}
                        missing={!folder().found}
                        flash={flash() === folder().path}
                        onFlashEnd={clearFlash}
                        onLocate={() => void props.folders.choose(folder().path)}
                        onRemove={() => void props.folders.remove(folder().path)}
                      />
                    );
                  }}
                </For>
                <Button
                  variant="ghost"
                  type="button"
                  class="settings-link agent-folders-add"
                  onClick={() => void props.folders.choose()}
                >
                  <span class="settings-link-label">
                    <span class="settings-link-icon">
                      <Show when={drop.over()} fallback={<Plus aria-hidden="true" />}>
                        <FolderPlus aria-hidden="true" />
                      </Show>
                    </span>
                    {drop.over() ? t("agentSettings.folders.drop") : t("agentSettings.folders.add")}
                  </span>
                </Button>
              </SettingsLinkGroup>
            </div>
            <Show when={props.showExclusions}>
              <SettingsLinkGroup inset title={t("agentSettings.folders.excluded")}>
                <For each={list().excluded} keyed={(path) => path}>
                  {(path) => {
                    const fresh = opened;
                    return (
                      <ExclusionRow
                        path={path()}
                        place={exclusionPlace(path(), list(), {
                          workspace: t("agentSettings.folders.workspace"),
                          shared: t("agentSettings.folders.shared"),
                        })}
                        fresh={fresh}
                        flash={flash() === path()}
                        onFlashEnd={clearFlash}
                        onInclude={() => void props.folders.include(path())}
                      />
                    );
                  }}
                </For>
                <Button
                  variant="ghost"
                  type="button"
                  class="settings-link agent-folders-add"
                  onClick={() => void props.folders.exclude()}
                >
                  <span class="settings-link-label">
                    <span class="settings-link-icon">
                      <Plus aria-hidden="true" />
                    </span>
                    {t("agentSettings.folders.exclude")}
                  </span>
                </Button>
              </SettingsLinkGroup>
            </Show>
          </>
        )}
      </Show>
    </div>
  );
}

/**
 * The chat's drop overlay in two halves: the files half attaches what is dropped, as the chat's own
 * overlay does; the folder half adds the dropped folders. A file dropped on the folder half attaches.
 */
export function AgentFolderDropOverlay(props: {
  agentName: string;
  onDropFolders: (folders: readonly File[]) => void;
}) {
  const { t } = useText();
  // The chat and the desktop's file import do not see a folder dropped here.
  const drop = createFolderDropTarget((folders) => props.onDropFolders(folders));
  return (
    <div class="agent-folders-chat-drop">
      <div class="agent-folders-chat-zone">
        <Upload aria-hidden="true" />
        <span>{t("conversation.view.drop")}</span>
      </div>
      <div
        class="agent-folders-chat-zone agent-folders-chat-zone-folder"
        data-dragging={drop.over() ? "" : undefined}
        {...drop.handlers}
      >
        <FolderInput aria-hidden="true" />
        <span>{t("conversation.view.dropFolder", { agent: props.agentName })}</span>
      </div>
    </div>
  );
}
