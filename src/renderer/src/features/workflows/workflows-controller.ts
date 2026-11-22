import {
  type AgentAccessLevels,
  applyWorkflowFolderAction,
  graphAgentIds,
  type StoredFileRow,
  type WorkflowDetail,
  type WorkflowFolderAction,
  type WorkflowFoldersSnapshot,
  type WorkflowGitHubCatalog,
  type WorkflowGitHubRepositoryOptions,
  type WorkflowGraph,
  type WorkflowNodeKind,
  type WorkflowSaveResult,
  type WorkflowSummary,
} from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import { toast } from "@openbot/ui";
import type { WorkflowCanvasProps } from "@openbot/ui/features/workflows/WorkflowCanvas";
import type { WorkflowCanvasTabs } from "@openbot/ui/features/workflows/WorkflowTabs";
import type { WorkflowBuild } from "@openbot/ui/features/workflows/workflow-build";
import {
  EMPTY_GITHUB_HISTORY,
  githubItemUrl,
  type WorkflowGitHubCanvas,
} from "@openbot/ui/features/workflows/workflow-github";
import { stableJson } from "@openbot/ui/features/workflows/workflow-history";
import { mergeWorkflowGraphs } from "@openbot/ui/features/workflows/workflow-merge";
import type {
  WorkflowChannel,
  WorkflowDiscordServer,
  WorkflowPlace,
  WorkflowSlackWorkspace,
  WorkflowTelegramChat,
} from "@openbot/ui/features/workflows/workflow-model";
import { EMPTY_WORKFLOW_RUN_VIEW } from "@openbot/ui/features/workflows/workflow-run-view";
import { useText } from "@openbot/ui/text";
import { createEffect, createMemo, createSignal, onSettled, untrack } from "solid-js";
import { agentAskedHere } from "../../agent-requests";
import type { DesktopAnalyticsScope, WorkflowAnalyticsAction } from "../../analytics";
import { webhookFailureCode } from "../../webhook-failure-code";
import { createGitHubConnector } from "../connectors/github-connector";
import { workflowCache as cache, type StoredWorkflow } from "./workflow-cache";
import type { WorkflowHost } from "./workflows-port";

const RUN_PAGE = 20;
const CACHED_WORKFLOWS = 20;
const SAVE_DELAY_MS = 400;

const NO_OPTIONS: WorkflowGitHubRepositoryOptions = { labels: [], people: [] };

const FAILURE_CODES = {
  create: "create_failed",
  rename: "update_failed",
  delete: "delete_failed",
  run: "request_failed",
  run_step: "request_failed",
  stop_step: "cancel_failed",
  stop_run: "cancel_failed",
  retry_step: "request_failed",
  approve: "response_failed",
  reject: "response_failed",
  restore_version: "update_failed",
  rotate_webhook_secret: "update_failed",
} as const satisfies Record<WorkflowAnalyticsAction, string>;

export interface WorkflowRequest {
  workflowId: () => string | undefined;
  taken: () => void;
}

type WorkflowBase = { revision: number; graph: WorkflowGraph };

type WorkflowsControllerProps = Omit<WorkflowCanvasProps, "workflow" | "features" | "frame" | "readOnly" | "catalogs">;

const lastWorkflowKey = (hostKey: string) => `openbot:last-workflow:${hostKey}`;
function readLastWorkflow(hostKey: string): string | undefined {
  try {
    return window.localStorage.getItem(lastWorkflowKey(hostKey)) ?? undefined;
  } catch {
    return undefined;
  }
}
function rememberLastWorkflow(hostKey: string, workflowId: string): void {
  try {
    if (window.localStorage.getItem(lastWorkflowKey(hostKey)) !== workflowId) {
      window.localStorage.setItem(lastWorkflowKey(hostKey), workflowId);
    }
  } catch {}
}

const tabsKey = (hostKey: string) => `openbot:workflow-tabs:${hostKey}`;
function readTabs(hostKey: string | undefined): readonly string[] {
  if (hostKey === undefined) return [];
  try {
    return (window.localStorage.getItem(tabsKey(hostKey)) ?? "").split("\n").filter((id) => id !== "");
  } catch {
    return [];
  }
}
function rememberTabs(hostKey: string | undefined, ids: readonly string[]): void {
  if (hostKey === undefined) return;
  try {
    window.localStorage.setItem(tabsKey(hostKey), ids.join("\n"));
  } catch {}
}

export function createWorkflowsController(
  host: WorkflowHost,
  analytics?: () => DesktopAnalyticsScope,
  requested?: WorkflowRequest,
  hostKey?: string,
) {
  const { t, errorMessage } = useText();
  const tracked = async <T>(
    action: WorkflowAnalyticsAction,
    call: () => Promise<T>,
    nodeKind?: WorkflowNodeKind,
  ): Promise<T> => {
    const scope = analytics?.();
    const startedAt = performance.now();
    const send = (result: "succeeded" | "failed", error?: unknown) =>
      scope?.track("workflow_action", {
        action,
        ...(nodeKind ? { node_kind: nodeKind } : {}),
        duration_ms: Math.max(0, Math.round(performance.now() - startedAt)),
        result,
        ...(result === "failed" ? { failure_code: webhookFailureCode(error, FAILURE_CODES[action]) } : {}),
      });
    try {
      const value = await call();
      send("succeeded");
      return value;
    } catch (error) {
      send("failed", error);
      throw error;
    }
  };
  const report = (error: unknown) => {
    toast.error(errorMessage(error, t("workflow.page.failed")));
  };
  const reported = <T>(call: Promise<T>) =>
    call.catch((error: unknown) => {
      report(error);
      throw error;
    });

  const hostCache = hostKey === undefined ? undefined : cache.get(hostKey);
  const firstId = untrack(() => requested?.workflowId()) ?? hostCache?.last;
  const visited = firstId === undefined ? undefined : hostCache?.workflows.get(firstId);
  const [stored, setStored] = createSignal<StoredWorkflow | undefined>(visited);
  const [summaries, setSummaries] = createSignal<readonly WorkflowSummary[]>(hostCache?.library ?? []);
  const [places, setPlaces] = createSignal<readonly WorkflowPlace[]>([]);
  const [channels, setChannels] = createSignal<readonly WorkflowChannel[]>([]);
  const [discord, setDiscord] = createSignal<readonly WorkflowDiscordServer[]>([]);
  const [telegram, setTelegram] = createSignal<readonly WorkflowTelegramChat[]>([]);
  const [slack, setSlack] = createSignal<readonly WorkflowSlackWorkspace[]>([]);
  const [libraryPictures, setPictures] = createSignal<readonly StoredFileRow[]>([]);
  let picturesWanted = false;
  const [levels, setLevels] = createSignal<AgentAccessLevels | null>(hostCache?.levels ?? null);
  const [preview, setPreview] = createSignal<{ versionId: string; graph: WorkflowGraph }>();
  const [resetKey, setResetKey] = createSignal(0);
  const [tabIds, setTabIds] = createSignal<readonly string[]>(readTabs(hostKey));
  const [folders, setFolders] = createSignal<WorkflowFoldersSnapshot>();
  const [build, setBuild] = createSignal<WorkflowBuild>();
  const [opening, setOpening] = createSignal<string>();
  const [failed, setFailed] = createSignal(false);
  const playBuild = (workflowId: string, agentId: string, before: WorkflowGraph | null) =>
    setBuild((last) => ({ key: (last?.key ?? 0) + 1, workflowId, agentId, before }));

  let current = visited?.detail.summary.id ?? "";
  const bases = new Map<string, WorkflowBase>();
  const setBase = (detail: WorkflowDetail) =>
    bases.set(detail.summary.id, { revision: detail.revision, graph: detail.graph });
  if (visited) setBase(visited.detail);
  let limit = RUN_PAGE;
  let disposed = false;
  let pending: { workflowId: string; graph: WorkflowGraph } | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let edits = 0;
  let writing = 0;
  let previewRequest = 0;

  let writes: Promise<void> = Promise.resolve();
  const queued = <T>(task: () => Promise<T>): Promise<T> => {
    writing += 1;
    const done = writes.then(task);
    writes = done
      .then(() => undefined, report)
      .finally(() => {
        writing -= 1;
        edits += 1;
      });
    return done;
  };
  const write = (task: () => Promise<unknown>) => {
    void queued(task);
  };

  const closePreview = () => {
    previewRequest += 1;
    setPreview(undefined);
  };

  const remember = (value: StoredWorkflow) => {
    if (hostKey === undefined) return;
    let entry = cache.get(hostKey);
    if (!entry) {
      entry = { library: [], workflows: new Map() };
      cache.set(hostKey, entry);
    }
    const workflowId = value.detail.summary.id;
    entry.workflows.delete(workflowId);
    entry.workflows.set(workflowId, value);
    for (const old of entry.workflows.keys()) {
      if (entry.workflows.size <= CACHED_WORKFLOWS) break;
      entry.workflows.delete(old);
    }
  };
  const cached = (workflowId: string) =>
    hostKey === undefined ? undefined : cache.get(hostKey)?.workflows.get(workflowId);
  const putDetail = (workflowId: string, change: (detail: WorkflowDetail) => WorkflowDetail) => {
    const open = stored();
    const value = open?.detail.summary.id === workflowId ? open : cached(workflowId);
    if (!value) return;
    const next = { ...value, detail: change(value.detail) };
    if (value === open) setStored(next);
    remember(next);
  };
  const show = (value: StoredWorkflow) => {
    if (stored()?.detail.summary.id !== value.detail.summary.id) setBase(value.detail);
    setStored(value);
    remember(value);
  };
  const dropPending = (workflowId: string) => {
    if (pending?.workflowId !== workflowId) return;
    pending = undefined;
    clearTimeout(timer);
    timer = undefined;
  };
  const foreign = new Map<string, number>();
  const foreignCount = (workflowId: string) => foreign.get(workflowId) ?? 0;
  const takeForeign = (next: WorkflowDetail) => {
    setBase(next);
    foreign.set(next.summary.id, foreignCount(next.summary.id) + 1);
    dropPending(next.summary.id);
  };
  let saving: { workflowId: string; json: string } | undefined;
  const canvasShows = (workflowId: string) => !disposed && stored()?.detail.summary.id === workflowId;

  const reset = (next: WorkflowDetail) => {
    if (disposed) return;
    takeForeign(next);
    putDetail(next.summary.id, () => next);
    closePreview();
    setResetKey((key) => key + 1);
  };

  const readGitHubHistory = (workflowId: string) =>
    host.githubSupported()
      ? host.workflows.githubHistory(workflowId).catch(() => EMPTY_GITHUB_HISTORY)
      : Promise.resolve(EMPTY_GITHUB_HISTORY);

  const connector = createGitHubConnector(
    () => host.githubConnector,
    () => host.hostName(),
  );
  const [githubCatalog, setGitHubCatalog] = createSignal<WorkflowGitHubCatalog>();
  const [githubOptions, setGitHubOptions] = createSignal<ReadonlyMap<string, WorkflowGitHubRepositoryOptions>>(
    new Map(),
  );
  const askedOptions = new Set<string>();
  let catalogRead = 0;
  const readGitHubCatalog = () => {
    if (!host.githubSupported()) return;
    const request = ++catalogRead;
    host.workflows.githubCatalog().then(
      (next) => {
        if (!disposed && request === catalogRead) setGitHubCatalog(next);
      },
      () => undefined,
    );
  };
  const refreshGitHub = () => {
    askedOptions.clear();
    setGitHubOptions(new Map());
    readGitHubCatalog();
  };
  let connectionState: string | undefined;
  createEffect(
    () => connector.detail.props.status.state,
    (state) => {
      const before = connectionState;
      connectionState = state;
      if (before !== undefined && state !== before) refreshGitHub();
    },
  );
  let awaitingInstall = false;
  const onFocus = () => {
    if (!awaitingInstall) return;
    awaitingInstall = false;
    refreshGitHub();
  };

  let library: readonly WorkflowSummary[] | undefined;
  const read = async (workflowId: string, agentId?: string, listed?: readonly WorkflowSummary[]) => {
    const seen = edits;
    const details = workflowId === current ? readDetail(workflowId) : undefined;
    details?.catch(() => undefined);
    const list = listed ?? (await host.workflows.list());
    if (disposed) return;
    library = list;
    setSummaries(list);
    pruneTabs(list);
    if (hostKey !== undefined) {
      const entry = cache.get(hostKey);
      if (entry) entry.library = list;
      else cache.set(hostKey, { library: list, workflows: new Map() });
    }
    if (workflowId !== current || !list.some((summary) => summary.id === workflowId)) return;
    const [next, page, versions, github] = await (details ?? readDetail(workflowId));
    if (disposed || workflowId !== current) return;
    const open = stored()?.detail;
    const shown = open?.summary.id === workflowId ? open : undefined;
    const known = shown && bases.get(workflowId);
    const detail = shown && known && next.revision < known.revision ? shown : next;
    const newer = known !== undefined && next.revision > known.revision;
    const idle = seen === edits && writing === 0 && pending === undefined;
    if (hostKey !== undefined) {
      rememberLastWorkflow(hostKey, workflowId);
      const entry = cache.get(hostKey);
      if (entry) entry.last = workflowId;
    }
    const value = { detail, runs: page, versions, github };
    if (newer && idle && agentId !== undefined && shown) {
      playBuild(workflowId, agentId, shown.graph);
      show(value);
      reset(next);
      return next;
    }
    if (newer) {
      if (saving?.workflowId === workflowId && saving.json === stableJson(next.graph)) setBase(next);
      else takeForeign(next);
    }
    show(value);
    return next;
  };

  const readDetail = (workflowId: string) =>
    Promise.all([
      host.workflows.get(workflowId),
      host.workflows.runs({ workflowId, limit }),
      host.workflows.versions(workflowId),
      readGitHubHistory(workflowId),
    ]);

  const readOpening = async (workflowId: string, listed?: readonly WorkflowSummary[]) => {
    const shownId = stored()?.detail.summary.id;
    setOpening(shownId !== undefined && shownId !== workflowId ? workflowId : undefined);
    try {
      return await read(workflowId, undefined, listed);
    } finally {
      if (opening() === workflowId) setOpening(undefined);
    }
  };

  const load = async (workflowId: string, listed?: readonly WorkflowSummary[]) => {
    current = workflowId;
    limit = RUN_PAGE;
    const known = cached(workflowId);
    if (known && !disposed) show(known);
    await readOpening(workflowId, listed);
  };

  const save = async (
    edit: { workflowId: string; graph: WorkflowGraph },
    queuedOn: { from: WorkflowBase | undefined; seen: number },
  ): Promise<void> => {
    const { workflowId } = edit;
    if (foreignCount(workflowId) !== queuedOn.seen) {
      if (canvasShows(workflowId)) return;
      const now = bases.get(workflowId);
      if (!now || !queuedOn.from) return;
      const merged = mergeWorkflowGraphs(queuedOn.from.graph, edit.graph, now.graph);
      if (stableJson(merged) === stableJson(now.graph)) return;
      return save({ workflowId, graph: merged }, { from: now, seen: foreignCount(workflowId) });
    }
    const from = bases.get(workflowId);
    if (!from) return;
    saving = { workflowId, json: stableJson(edit.graph) };
    let result: WorkflowSaveResult;
    try {
      result = await host.workflows.saveGraph({ workflowId, baseRevision: from.revision, graph: edit.graph });
    } catch (error) {
      saving = undefined;
      pending ??= edit;
      throw error;
    }
    saving = undefined;
    const known = bases.get(workflowId) ?? from;
    if (result.ok) {
      if (result.revision <= known.revision) return;
      bases.set(workflowId, { revision: result.revision, graph: edit.graph });
      putDetail(workflowId, (detail) => ({ ...detail, revision: result.revision, graph: edit.graph }));
      return;
    }
    const newer = result.conflict;
    if (newer.revision <= known.revision) return;
    takeForeign(newer);
    putDetail(workflowId, () => newer);
    if (canvasShows(workflowId)) return;
    const merged = mergeWorkflowGraphs(from.graph, edit.graph, newer.graph);
    if (stableJson(merged) !== stableJson(newer.graph)) {
      await save({ workflowId, graph: merged }, { from: bases.get(workflowId), seen: foreignCount(workflowId) });
    }
  };

  const flush = () => {
    clearTimeout(timer);
    timer = undefined;
    const edit = pending;
    pending = undefined;
    if (!edit) return;
    const queuedOn = { from: bases.get(edit.workflowId), seen: foreignCount(edit.workflowId) };
    write(() => save(edit, queuedOn));
  };

  const open = (workflowId: string) => {
    flush();
    closePreview();
    write(() => load(workflowId));
  };

  const keepTabs = (next: readonly string[]) => {
    setTabIds(next);
    rememberTabs(hostKey, next);
  };
  const pruneTabs = (list: readonly WorkflowSummary[]) => {
    const known = new Set(list.map((summary) => summary.id));
    const kept = untrack(tabIds).filter((id) => id === current || known.has(id));
    if (kept.length !== untrack(tabIds).length) keepTabs(kept);
  };
  createEffect(
    () => stored()?.detail.summary.id,
    (workflowId) => {
      if (workflowId === undefined) return;
      const ids = untrack(tabIds);
      if (!ids.includes(workflowId)) keepTabs([...ids, workflowId]);
    },
  );
  const shownTabs = () => {
    const open = stored()?.detail.summary.id;
    const known = new Set(summaries().map((summary) => summary.id));
    return tabIds().filter((id) => id === open || known.has(id));
  };
  const closeTabs = (keep: (id: string, index: number) => boolean, fallback: string) => {
    const ids = shownTabs();
    const kept = ids.filter(keep);
    if (kept.length === 0) return;
    keepTabs(kept);
    if (kept.includes(current)) return;
    const index = ids.indexOf(current);
    const next =
      ids.slice(index + 1).find((id) => kept.includes(id)) ?? (kept.includes(fallback) ? fallback : kept.at(-1));
    if (next !== undefined) open(next);
  };
  const tabs: WorkflowCanvasTabs = {
    get ids() {
      return shownTabs();
    },
    onClose: (workflowId) => closeTabs((id) => id !== workflowId, workflowId),
    onCloseOthers: (workflowId) => closeTabs((id) => id === workflowId, workflowId),
    onCloseRight: (workflowId) => {
      const index = shownTabs().indexOf(workflowId);
      closeTabs((_, at) => at <= index, workflowId);
    },
    onMove: (workflowId, index) => {
      const ids = shownTabs().filter((id) => id !== workflowId);
      ids.splice(Math.max(0, Math.min(index, ids.length)), 0, workflowId);
      keepTabs(ids);
    },
  };

  let folderRead = 0;
  const readFolders = () => {
    const request = ++folderRead;
    if (!host.foldersSupported()) {
      setFolders(undefined);
      return;
    }
    host.folders().then((next) => {
      if (!disposed && request === folderRead) setFolders(next);
    }, report);
  };
  const folderFailed = (error: unknown) => {
    toast.error(errorMessage(error, t("workflow.canvas.folder.failed")));
    readFolders();
  };
  const folderAction = (action: WorkflowFolderAction) => {
    const before = folders();
    if (!before) return;
    try {
      const workflowIds = new Set(summaries().map((summary) => summary.id));
      setFolders(applyWorkflowFolderAction(before, action, { workflowIds }));
    } catch (error) {
      folderFailed(error);
      return;
    }
    const request = ++folderRead;
    host.folderAction(action).then((next) => {
      if (!disposed && request === folderRead) setFolders(next);
    }, folderFailed);
  };

  const readLevels = () => {
    host.agentLevels().then((next) => {
      if (hostKey !== undefined) {
        const entry = cache.get(hostKey);
        if (entry) entry.levels = next;
        else cache.set(hostKey, { library: [], workflows: new Map(), levels: next });
      }
      if (!disposed) setLevels(next);
    }, report);
  };
  const readPlaces = () => {
    host.places().then((next) => {
      if (!disposed) setPlaces(next);
    }, report);
    host.channels().then((next) => {
      if (!disposed) setChannels(next);
    }, report);
    host.discordServers().then((next) => {
      if (!disposed) setDiscord(next);
    }, report);
    host.telegramChats().then((next) => {
      if (!disposed) setTelegram(next);
    }, report);
    host.slackWorkspaces().then((next) => {
      if (!disposed) setSlack(next);
    }, report);
    if (picturesWanted) readPictures();
  };
  const readPictures = () => {
    host.pictures().then((next) => {
      if (!disposed) setPictures(next);
    }, report);
  };
  const pictures = () => {
    if (!picturesWanted) {
      picturesWanted = true;
      readPictures();
    }
    return libraryPictures();
  };

  const refresh = (workflowId: string | null, agentId?: string) => {
    if (
      workflowId !== null &&
      agentId !== undefined &&
      hostKey !== undefined &&
      workflowId !== current &&
      writing === 0 &&
      pending === undefined &&
      !summaries().some((summary) => summary.id === workflowId) &&
      agentAskedHere(hostKey, agentId)
    ) {
      playBuild(workflowId, agentId, null);
      open(workflowId);
      return;
    }
    read(workflowId ?? current, agentId).catch(report);
    if (workflowId !== null) return;
    readPlaces();
    readLevels();
    readGitHubCatalog();
    readFolders();
  };

  onSettled(() => {
    const stop = host.onChanged(refresh);
    const stopFolders = host.onFoldersChanged(readFolders);
    window.addEventListener("focus", onFocus);
    return () => {
      stop();
      stopFolders();
      window.removeEventListener("focus", onFocus);
      flush();
      disposed = true;
    };
  });

  untrack(() => {
    readPlaces();
    readLevels();
    readGitHubCatalog();
    readFolders();
  });
  void queued(async () => {
    const asked = untrack(() => requested?.workflowId());
    const remembered = hostKey === undefined ? undefined : readLastWorkflow(hostKey);
    const known = asked ?? (current === "" ? remembered : current);
    if (known !== undefined) {
      if (asked !== undefined) requested?.taken();
      current = known;
      limit = RUN_PAGE;
      const shown = cached(known);
      if (shown && stored()?.detail.summary.id !== known) show(shown);
      if (await readOpening(known)) return;
      if (disposed) return;
    }
    const list = library ?? (await host.workflows.list());
    const wanted = untrack(() => requested?.workflowId());
    if (wanted !== undefined) requested?.taken();
    const found = list.find((summary) => summary.id === wanted) ?? list[0];
    if (found) {
      if (!disposed) await load(found.id, list);
      return;
    }
    const created = await host.workflows.create({ title: t("workflow.canvas.untitled") });
    if (!disposed) await load(created.summary.id);
  }).catch(() => setFailed(true));
  createEffect(
    () => requested?.workflowId(),
    (workflowId) => {
      if (workflowId === undefined || current === "") return;
      requested?.taken();
      if (workflowId === current) return;
      flush();
      closePreview();
      write(async () => {
        const list = await host.workflows.list();
        if (!disposed && list.some((summary) => summary.id === workflowId)) await load(workflowId, list);
      });
    },
  );

  const lock = createMemo((): AppTextKey | undefined => {
    const detail = stored()?.detail;
    if (!detail) return undefined;
    if (detail.needsNewerApp) return "workflow.page.needsNewerApp";
    const known = levels();
    return known && graphAgentIds(detail.graph).some((agentId) => known[agentId] !== "manage")
      ? "workflow.page.manageOnly"
      : undefined;
  });
  const lockToken = createMemo(() => {
    const reason = lock();
    return reason && `${current}\u0000${reason}`;
  });
  createEffect(lockToken, (token) => {
    const reason = untrack(lock);
    if (token && reason) toast.info(t(reason));
  });

  const start = (
    action: WorkflowAnalyticsAction,
    call: (workflowId: string) => Promise<unknown>,
    nodeKind?: WorkflowNodeKind,
  ) => {
    flush();
    const workflowId = current;
    write(() => tracked(action, () => call(workflowId), nodeKind));
  };

  const github: WorkflowGitHubCanvas = {
    catalog: githubCatalog,
    history: () => stored()?.github ?? EMPTY_GITHUB_HISTORY,
    run: (runId) => {
      const entry = stored()?.runs.runs.find((candidate) => candidate.run.id === runId);
      return entry && { number: entry.run.number, status: entry.run.status };
    },
    options: (repository) => {
      const key = repository.toLowerCase();
      const known = githubOptions().get(key);
      if (known || askedOptions.has(key) || !host.githubSupported()) return known;
      askedOptions.add(key);
      host.workflows.githubOptions({ repository }).then(
        (next) => {
          if (!disposed && askedOptions.has(key)) setGitHubOptions((map) => new Map(map).set(key, next));
        },
        (error: unknown) => {
          if (!disposed && askedOptions.has(key)) setGitHubOptions((map) => new Map(map).set(key, NO_OPTIONS));
          report(error);
        },
      );
      return undefined;
    },
    connection: () => connector.detail.props,
    openGitHub: () => {
      awaitingInstall = true;
      connector.detail.props.onOpenInstall();
    },
    opening: connector.busy,
    openItem: (item) => {
      host.openUrl(githubItemUrl(item)).catch(report);
    },
    runLastEvent: (nodeId) => {
      start("run", (workflowId) =>
        host.workflows.githubRunLastEvent({ workflowId, nodeId, requestId: crypto.randomUUID() }),
      );
    },
  };

  const props: WorkflowsControllerProps = {
    get resetKey() {
      return resetKey();
    },
    get build() {
      return build();
    },
    get runs() {
      return stored()?.runs ?? EMPTY_WORKFLOW_RUN_VIEW;
    },
    get versions() {
      return stored()?.versions ?? [];
    },
    get versionPreview() {
      return preview();
    },
    get library() {
      return summaries();
    },
    tabs,
    get folders() {
      return folders();
    },
    onFolderAction: folderAction,
    get opening() {
      return opening() !== undefined;
    },
    onGraphChange: (graph) => {
      edits += 1;
      pending = { workflowId: current, graph };
      clearTimeout(timer);
      timer = setTimeout(flush, SAVE_DELAY_MS);
    },
    onRun: (input) => {
      start("run", (workflowId) =>
        host.workflows.startRun({
          workflowId,
          requestId: crypto.randomUUID(),
          ...(input.fromNodeId === undefined ? {} : { fromNodeId: input.fromNodeId }),
        }),
      );
    },
    onRunStep: (nodeId, takes = 1) => {
      const kind = stored()?.detail.graph.nodes.find((node) => node.id === nodeId)?.kind;
      start(
        "run_step",
        async (workflowId) => {
          for (let take = 0; take < takes; take += 1)
            await host.workflows.runStep({ workflowId, nodeId, requestId: crypto.randomUUID() });
        },
        kind,
      );
    },
    onStopStep: (stepId) => {
      tracked("stop_step", () => host.workflows.stopStep(stepId)).catch(report);
    },
    onStopRun: (runId) => {
      tracked("stop_run", () => host.workflows.stopRun(runId)).catch(report);
    },
    onRetry: (stepId) => {
      tracked("retry_step", () => host.workflows.retryStep({ stepId, requestId: crypto.randomUUID() })).catch(report);
    },
    onDecide: (stepId, approved) =>
      reported(tracked(approved ? "approve" : "reject", () => host.workflows.decide({ stepId, approved }))),
    onRotateWebhookSecret: (nodeId) => {
      flush();
      const workflowId = current;
      return queued(() =>
        tracked("rotate_webhook_secret", () => host.workflows.rotateWebhookSecret({ workflowId, nodeId })),
      ).then((result) => result.secret);
    },
    onLoadOlderRuns: () => {
      limit += RUN_PAGE;
      read(current).catch(report);
    },
    onRestoreVersion: (versionId) => {
      flush();
      const workflowId = current;
      write(async () => {
        reset(await tracked("restore_version", () => host.workflows.restoreVersion({ workflowId, versionId })));
      });
    },
    onPreviewVersion: (versionId) => {
      closePreview();
      if (versionId === null) return;
      const request = previewRequest;
      const workflowId = current;
      host.workflows.versionGraph({ workflowId, versionId }).then((graph) => {
        if (!disposed && request === previewRequest && workflowId === current) setPreview({ versionId, graph });
      }, report);
    },
    onSelect: (workflowId) => {
      open(workflowId);
    },
    onCreate: (input) => {
      flush();
      write(async () => {
        const created = await tracked("create", () => host.workflows.create(input));
        await load(created.summary.id);
      });
    },
    onRename: (workflowId, title) => {
      tracked("rename", () => host.workflows.rename({ workflowId, title })).catch(report);
    },
    get onSetPaused() {
      if (!host.pauseSupported()) return undefined;
      return (workflowId: string, paused: boolean) => {
        host.workflows.setPaused({ workflowId, paused }).catch(report);
      };
    },
    get onExport() {
      if (!host.portableSupported()) return undefined;
      return (workflowId: string) => {
        flush();
        return queued(() => host.workflows.exportFile(workflowId));
      };
    },
    onDelete: (workflowId) => {
      flush();
      return queued(async () => {
        const before = await host.workflows.list();
        const index = before.findIndex((summary) => summary.id === workflowId);
        await tracked("delete", () => host.workflows.delete(workflowId));
        if (hostKey !== undefined) cache.get(hostKey)?.workflows.delete(workflowId);
        if (disposed || workflowId !== current) return;
        const rest = before.filter((summary) => summary.id !== workflowId);
        const ids = untrack(shownTabs);
        const at = ids.indexOf(workflowId);
        const neighbor = [...ids.slice(at + 1), ...ids.slice(0, Math.max(at, 0)).reverse()].find((id) =>
          rest.some((summary) => summary.id === id),
        );
        const next = neighbor ?? rest[Math.min(Math.max(index, 0), rest.length - 1)]?.id;
        const opened = next ?? (await host.workflows.create({ title: t("workflow.canvas.untitled") })).summary.id;
        closePreview();
        await load(opened);
      });
    },
  };

  const uploadPicture = (file: File) =>
    reported(host.uploadPicture(file)).then((row) => {
      setPictures((list) => [row, ...list.filter((candidate) => candidate.id !== row.id)]);
      return row;
    });

  return {
    detail: () => stored()?.detail,
    failed,
    places,
    channels,
    discord,
    telegram,
    slack,
    pictures,
    uploadPicture,
    readOnly: () => lock() !== undefined,
    github,
    props,
  };
}
