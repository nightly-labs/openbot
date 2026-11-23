import {
  AGENT_FOLDER_LIMIT,
  type AgentExclusionChange,
  type AgentFolderChange,
  type AgentFolderCoverageReason,
  type AgentFolderList,
  agentExclusionPlace,
  agentFolderName,
  agentFolderParent,
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

export interface AgentFolderCalls {
  list: (agentId: string) => Promise<AgentFolderList>;
  choose: (agentId: string, replace?: string) => Promise<AgentFolderChange>;
  add: (agentId: string, path: string) => Promise<AgentFolderChange>;
  remove: (agentId: string, path: string) => Promise<AgentFolderChange>;
  drop?: ((agentId: string, folder: File) => Promise<AgentFolderChange>) | undefined;
  exclude: (agentId: string) => Promise<AgentExclusionChange>;
  addExclusion: (agentId: string, path: string) => Promise<AgentExclusionChange>;
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

export function createAgentFolders(source: () => AgentFolderSource | undefined) {
  const { t, errorMessage } = useText();
  const [state, setState] = createStore<{ list: AgentFolderList | null; flash: string | null }>({
    list: null,
    flash: null,
  });
  let request = 0;
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
      case "replaced":
        toast.success(t("agentSettings.folders.toastAdded", { agent, folder }));
        return;
      case "added": {
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
    canDrop: (): boolean => source()?.calls.drop !== undefined,
    async drop(folders: readonly File[]): Promise<void> {
      for (const folder of folders)
        await act(async ({ agentId, calls }) =>
          calls.drop ? calls.drop(agentId, folder) : { outcome: "cancelled", list: await calls.list(agentId) },
        );
    },
    clearFlash(): void {
      setState((current) => {
        current.flash = null;
      });
    },
  };
}

export type AgentFolders = ReturnType<typeof createAgentFolders>;

function createFolderDropTarget(onDrop: (folders: readonly File[]) => void, enabled: () => boolean = () => true) {
  const [over, setOver] = createSignal(false);
  const takes = (event: DragEvent) => enabled() && carriesFiles(event);
  return {
    over,
    handlers: {
      onDragEnter: (event: DragEvent) => {
        if (takes(event)) setOver(true);
      },
      onDragOver: (event: DragEvent) => {
        if (!takes(event)) return;
        event.preventDefault();
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
        if (!enabled()) return;
        const folders = droppedFolders(event.dataTransfer);
        if (!folders) return;
        event.preventDefault();
        event.stopPropagation();
        onDrop(folders);
      },
    },
  };
}

export function AgentFoldersRow(props: {
  folders: AgentFolders;
  wideAccess: string | null;
  onOpen: () => void;
  ref?: (element: HTMLButtonElement) => void;
}) {
  const { t } = useText();
  const drop = createFolderDropTarget((folders) => void props.folders.drop(folders), props.folders.canDrop);
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

export function FolderRow(props: {
  name?: string;
  path: string;
  fresh?: boolean;
  missing?: boolean;
  flash?: boolean;
  onFlashEnd?: () => void;
  onLocate?: () => void;
  onRemove?: () => void;
}) {
  const { t } = useText();
  const name = () => props.name ?? agentFolderName(props.path);
  const where = () => (props.name ? props.path : agentFolderParent(props.path));
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
    return place ? t("agentSettings.folders.excludedIn", { folder: place }) : agentFolderParent(props.path);
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

export function AgentFoldersPage(props: {
  folders: AgentFolders;
  agentName: string;
  wideAccess: string | null;
  workspaceAccess: string;
  showExclusions: boolean;
  onChangeAccess: () => void;
}) {
  const { t } = useText();
  const drop = createFolderDropTarget((folders) => void props.folders.drop(folders), props.folders.canDrop);
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
                        place={agentExclusionPlace(path(), list(), {
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

export function AgentFolderDropOverlay(props: {
  agentName: string;
  onDropFolders: (folders: readonly File[]) => void;
}) {
  const { t } = useText();
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
