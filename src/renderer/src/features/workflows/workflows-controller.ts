import {
  type AgentAccessLevels,
  graphAgentIds,
  type StoredFileRow,
  type WorkflowDetail,
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
/** The workflows that the cache of one host keeps. */
const CACHED_WORKFLOWS = 20;
/** The pause after the last edit before the canvas saves. */
const SAVE_DELAY_MS = 400;

/** The options of a repository that the host could not read. */
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

/** A workflow that the page must open, and the call that marks the request as taken. */
export interface WorkflowRequest {
  workflowId: () => string | undefined;
  taken: () => void;
}

/** The revision and the graph of the host that the canvas edits are on. */
type WorkflowBase = { revision: number; graph: WorkflowGraph };

type WorkflowsControllerProps = Omit<WorkflowCanvasProps, "workflow" | "features" | "frame" | "readOnly" | "catalogs">;

/**
 * The id of the workflow that the page of a host showed last, on this device, so that the first read
 * after a restart gets it with the library. Reading `window.localStorage` throws when the browser
 * blocks storage, so each read and write is in a guard.
 */
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
  } catch {
    // The next first read gets the library before the workflow.
  }
}

/**
 * The state and the callbacks of the canvas over one host. The canvas keeps its edits; this saves
 * them after a pause, one save at a time, each on the revision of the one before. A change from
 * another device or a restore loads the graph again. The first workflow of the host opens; a host
 * with none gets a new one, as the canvas needs a workflow.
 *
 * `analytics` gives the scope of the account that acts. Stories give none. `requested` names a
 * workflow to open in place of the first one, such as the one of a clicked notification. A new
 * request opens its workflow on the open page too. `hostKey` names the host, so that the page shows
 * the workflow of its last visit while it reads the host again.
 */
export function createWorkflowsController(
  host: WorkflowHost,
  analytics?: () => DesktopAnalyticsScope,
  requested?: WorkflowRequest,
  hostKey?: string,
) {
  const { t, errorMessage } = useText();
  /** Reports how a user action ended. No title, text or ID leaves the app. */
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
  /** Shows the error of a call whose caller undoes what it showed. */
  const reported = <T>(call: Promise<T>) =>
    call.catch((error: unknown) => {
      report(error);
      throw error;
    });

  // The workflow of the last visit, or the requested one, shows at once from the cache. The first read
  // replaces it, and a newer revision of the host merges into the canvas. The signals start with it:
  // a write in the body of a component halts Solid.
  const hostCache = hostKey === undefined ? undefined : cache.get(hostKey);
  const firstId = untrack(() => requested?.workflowId()) ?? hostCache?.last;
  const visited = firstId === undefined ? undefined : hostCache?.workflows.get(firstId);
  /** The open workflow as the host has it. Replaced whole after each read. */
  const [stored, setStored] = createSignal<StoredWorkflow | undefined>(visited);
  const [summaries, setSummaries] = createSignal<readonly WorkflowSummary[]>(hostCache?.library ?? []);
  const [places, setPlaces] = createSignal<readonly WorkflowPlace[]>([]);
  const [channels, setChannels] = createSignal<readonly WorkflowChannel[]>([]);
  const [discord, setDiscord] = createSignal<readonly WorkflowDiscordServer[]>([]);
  const [telegram, setTelegram] = createSignal<readonly WorkflowTelegramChat[]>([]);
  const [slack, setSlack] = createSignal<readonly WorkflowSlackWorkspace[]>([]);
  /** The Library pictures that an asset step can use. */
  const [libraryPictures, setPictures] = createSignal<readonly StoredFileRow[]>([]);
  /** Set at the first read of the pictures. The host scans its whole Library for them, which is slow. */
  let picturesWanted = false;
  /** Null while this account manages every agent of the host. */
  const [levels, setLevels] = createSignal<AgentAccessLevels | null>(hostCache?.levels ?? null);
  const [preview, setPreview] = createSignal<{ versionId: string; graph: WorkflowGraph }>();
  const [resetKey, setResetKey] = createSignal(0);
  /** The last change of an agent that the canvas plays. */
  const [build, setBuild] = createSignal<WorkflowBuild>();
  /** Plays a change of `agentId` on the canvas, from `before`, or from an empty canvas for a new workflow. */
  const playBuild = (workflowId: string, agentId: string, before: WorkflowGraph | null) =>
    setBuild((last) => ({ key: (last?.key ?? 0) + 1, workflowId, agentId, before }));

  /** The open workflow. A plain value, so that a callback reads the new one at once. */
  let current = visited?.detail.summary.id ?? "";
  /**
   * The revision and the graph of the host that the canvas edits of each workflow are on: the graph that
   * the canvas loaded or merged last, or the last save of the canvas. A save sends this revision.
   */
  const bases = new Map<string, WorkflowBase>();
  const setBase = (detail: WorkflowDetail) =>
    bases.set(detail.summary.id, { revision: detail.revision, graph: detail.graph });
  if (visited) setBase(visited.detail);
  let limit = RUN_PAGE;
  let disposed = false;
  /** The edit that waits for the pause, and its timer. */
  let pending: { workflowId: string; graph: WorkflowGraph } | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** Counts each edit and each save, so that a read that started before one does not reset the canvas. */
  let edits = 0;
  let writing = 0;
  /** Counts each preview request, so that the graph of an older one does not show. */
  let previewRequest = 0;

  /**
   * Saves, restores and opens go one at a time, so that each save has the revision of the one before.
   * The queue shows the error of a task. `queued` gives the task's promise, so a caller that showed a
   * change can undo it when the task fails.
   */
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

  /** Keeps a workflow that this window read or saved in the cache of the host. */
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
  /** Changes the detail of a workflow on the canvas and in the cache. */
  const putDetail = (workflowId: string, change: (detail: WorkflowDetail) => WorkflowDetail) => {
    const open = stored();
    const value = open?.detail.summary.id === workflowId ? open : cached(workflowId);
    if (!value) return;
    const next = { ...value, detail: change(value.detail) };
    if (value === open) setStored(next);
    remember(next);
  };
  /**
   * Shows a workflow. A workflow that the canvas does not show yet opens on its graph, so the edits are
   * on that graph from then on.
   */
  const show = (value: StoredWorkflow) => {
    if (stored()?.detail.summary.id !== value.detail.summary.id) setBase(value.detail);
    setStored(value);
    remember(value);
  };
  /** Drops the edit of a workflow that waits, as the canvas sends it again on a newer graph. */
  const dropPending = (workflowId: string) => {
    if (pending?.workflowId !== workflowId) return;
    pending = undefined;
    clearTimeout(timer);
    timer = undefined;
  };
  /**
   * Counts the graphs of other devices that each workflow took. A save that waited in the queue while
   * one came is on an older graph, and must not replace the edits of the other device.
   */
  const foreign = new Map<string, number>();
  const foreignCount = (workflowId: string) => foreign.get(workflowId) ?? 0;
  /** Puts the edits on a newer graph of another device. */
  const takeForeign = (next: WorkflowDetail) => {
    setBase(next);
    foreign.set(next.summary.id, foreignCount(next.summary.id) + 1);
    dropPending(next.summary.id);
  };
  /** The graph of the save that runs, so that the read of its own revision does not drop the next edit. */
  let saving: { workflowId: string; json: string } | undefined;
  /** Whether the canvas shows a workflow. The canvas then merges each newer graph and sends it again. */
  const canvasShows = (workflowId: string) => !disposed && stored()?.detail.summary.id === workflowId;

  /** Shows `next` in place of the canvas edits. Undo on the canvas gets them back. */
  const reset = (next: WorkflowDetail) => {
    if (disposed) return;
    takeForeign(next);
    putDetail(next.summary.id, () => next);
    closePreview();
    setResetKey((key) => key + 1);
  };

  /**
   * The GitHub events of the open workflow. A failed read shows no events rather than no workflow:
   * the Events row is a view of the triggers, and the next change reads it again.
   */
  const readGitHubHistory = (workflowId: string) =>
    host.githubSupported()
      ? host.workflows.githubHistory(workflowId).catch(() => EMPTY_GITHUB_HISTORY)
      : Promise.resolve(EMPTY_GITHUB_HISTORY);

  const connector = createGitHubConnector(
    () => host.githubConnector,
    () => host.hostName(),
  );
  /** Undefined while it is read, and for an account that may not read it: only an admin adds GitHub steps. */
  const [githubCatalog, setGitHubCatalog] = createSignal<WorkflowGitHubCatalog>();
  /** The labels and people of each repository that a card asked for, by lower-case name, for this page. */
  const [githubOptions, setGitHubOptions] = createSignal<ReadonlyMap<string, WorkflowGitHubRepositoryOptions>>(
    new Map(),
  );
  const askedOptions = new Set<string>();
  /** Each read replaces the one before it, so a slow answer never overwrites a newer one. */
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
  /** A change on GitHub can give or take repositories, labels and people, so all are read again. */
  const refreshGitHub = () => {
    askedOptions.clear();
    setGitHubOptions(new Map());
    readGitHubCatalog();
  };
  // A connection that starts or ends changes the repositories that the host reaches.
  let connectionState: string | undefined;
  createEffect(
    () => connector.detail.props.status.state,
    (state) => {
      const before = connectionState;
      connectionState = state;
      if (before !== undefined && state !== before) refreshGitHub();
    },
  );
  /** Set when GitHub opened to change the installation. The next window focus reads the repositories again. */
  let awaitingInstall = false;
  const onFocus = () => {
    if (!awaitingInstall) return;
    awaitingInstall = false;
    refreshGitHub();
  };

  /**
   * Reads the library and, for the open workflow, its detail, runs and versions. `agentId`: the agent
   * whose change the read is for. When the change replaces the canvas, the canvas plays it. `listed`:
   * the library that the caller read just before, so that the read does not wait for it again.
   */
  /** The library of the last read. A plain value: a signal gives the new value only after the flush. */
  let library: readonly WorkflowSummary[] | undefined;
  const read = async (workflowId: string, agentId?: string, listed?: readonly WorkflowSummary[]) => {
    const seen = edits;
    // The open workflow is read with the library, not after it, which saves one round trip to a
    // joined server. A workflow that is gone fails its read, and the library then says so.
    const details = workflowId === current ? readDetail(workflowId) : undefined;
    details?.catch(() => undefined);
    const list = listed ?? (await host.workflows.list());
    if (disposed) return;
    library = list;
    setSummaries(list);
    if (hostKey !== undefined) {
      const entry = cache.get(hostKey);
      if (entry) entry.library = list;
      else cache.set(hostKey, { library: list, workflows: new Map() });
    }
    // A delete changes the library too: the delete then opens another workflow.
    if (workflowId !== current || !list.some((summary) => summary.id === workflowId)) return;
    const [next, page, versions, github] = await (details ?? readDetail(workflowId));
    if (disposed || workflowId !== current) return;
    const open = stored()?.detail;
    const shown = open?.summary.id === workflowId ? open : undefined;
    const known = shown && bases.get(workflowId);
    // A read that a save of this canvas overtook is older than the host: the saved graph stays.
    const detail = shown && known && next.revision < known.revision ? shown : next;
    const newer = known !== undefined && next.revision > known.revision;
    const idle = seen === edits && writing === 0 && pending === undefined;
    if (hostKey !== undefined) {
      rememberLastWorkflow(hostKey, workflowId);
      const entry = cache.get(hostKey);
      if (entry) entry.last = workflowId;
    }
    const value = { detail, runs: page, versions, github };
    // A change of an agent on a canvas with no edit plays on the canvas, which then loads it again.
    if (newer && idle && agentId !== undefined && shown) {
      playBuild(workflowId, agentId, shown.graph);
      show(value);
      reset(next);
      return next;
    }
    if (newer) {
      // The echo of the save that runs only moves the base: the edit that waits is on it. The canvas
      // merges another graph with its edits, and sends the merged graph again.
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

  /**
   * Opens a workflow: the cache shows it at once, and the read then gets it from the host. Its new
   * summary id resets the canvas, so the key stays.
   */
  const load = async (workflowId: string, listed?: readonly WorkflowSummary[]) => {
    current = workflowId;
    limit = RUN_PAGE;
    const known = cached(workflowId);
    if (known && !disposed) show(known);
    await read(workflowId, undefined, listed);
  };

  /**
   * Saves an edit on the revision that the canvas edits are on. When another device saved first, the
   * open canvas merges the newer graph with its edits and saves again. The edit of a workflow that the
   * canvas no longer shows merges here. `queuedOn`: the base and the count of other graphs when the
   * edit went into the queue.
   */
  const save = async (
    edit: { workflowId: string; graph: WorkflowGraph },
    queuedOn: { from: WorkflowBase | undefined; seen: number },
  ): Promise<void> => {
    const { workflowId } = edit;
    if (foreignCount(workflowId) !== queuedOn.seen) {
      // A graph of another device came while the edit waited. The canvas merged it and sends again.
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
      // The canvas counts the edit as sent, so it saves with the next edit, or when the page closes.
      pending ??= edit;
      throw error;
    }
    saving = undefined;
    const known = bases.get(workflowId) ?? from;
    if (result.ok) {
      // A read of a newer revision that came first stays.
      if (result.revision <= known.revision) return;
      bases.set(workflowId, { revision: result.revision, graph: edit.graph });
      putDetail(workflowId, (detail) => ({ ...detail, revision: result.revision, graph: edit.graph }));
      return;
    }
    const newer = result.conflict;
    if (newer.revision <= known.revision) return;
    takeForeign(newer);
    putDetail(workflowId, () => newer);
    // After the page closes, the canvas does not send again, so the merge is here.
    if (canvasShows(workflowId)) return;
    const merged = mergeWorkflowGraphs(from.graph, edit.graph, newer.graph);
    if (stableJson(merged) !== stableJson(newer.graph)) {
      await save({ workflowId, graph: merged }, { from: bases.get(workflowId), seen: foreignCount(workflowId) });
    }
  };

  /** Starts the save of the edit that waits. */
  const flush = () => {
    clearTimeout(timer);
    timer = undefined;
    const edit = pending;
    pending = undefined;
    if (!edit) return;
    const queuedOn = { from: bases.get(edit.workflowId), seen: foreignCount(edit.workflowId) };
    write(() => save(edit, queuedOn));
  };

  /** Opens a workflow after the save of the one before. */
  const open = (workflowId: string) => {
    flush();
    closePreview();
    write(() => load(workflowId));
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
  /**
   * The pictures are read when a step first asks for them, not when the page opens: the scan of the
   * host's Library slows the other calls of the host while it runs, and most workflows have no asset step.
   */
  const pictures = () => {
    if (!picturesWanted) {
      picturesWanted = true;
      readPictures();
    }
    return libraryPictures();
  };

  const refresh = (workflowId: string | null, agentId?: string) => {
    // A workflow that an agent makes opens, so the person sees the agent build it. While the person's
    // edit saves, the open workflow stays, and the new one only goes into the library. A request from
    // another device does not change the workflow that this device shows (#11072).
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
  };

  onSettled(() => {
    const stop = host.onChanged(refresh);
    window.addEventListener("focus", onFocus);
    return () => {
      stop();
      window.removeEventListener("focus", onFocus);
      // A pending edit still saves after the page closes.
      flush();
      disposed = true;
    };
  });

  // The host reads the server role once for each call; a change event reads again.
  untrack(() => {
    readPlaces();
    readLevels();
    readGitHubCatalog();
  });
  write(async () => {
    // A known workflow is read with the library. Without one, the library names the first workflow.
    const asked = untrack(() => requested?.workflowId());
    const remembered = hostKey === undefined ? undefined : readLastWorkflow(hostKey);
    const known = asked ?? (current === "" ? remembered : current);
    if (known !== undefined) {
      if (asked !== undefined) requested?.taken();
      current = known;
      limit = RUN_PAGE;
      const shown = cached(known);
      if (shown && stored()?.detail.summary.id !== known) show(shown);
      // A newer revision of the host merges into the canvas, with an edit that the person made on the
      // last visit while the read ran.
      if (await read(known)) return;
      if (disposed) return;
    }
    // A gone workflow: the read got the library already.
    const list = library ?? (await host.workflows.list());
    // Read after the list, so that a request that comes while the list loads opens.
    const wanted = untrack(() => requested?.workflowId());
    if (wanted !== undefined) requested?.taken();
    const found = list.find((summary) => summary.id === wanted) ?? list[0];
    if (found) {
      if (!disposed) await load(found.id, list);
      return;
    }
    // The list does not have the new workflow, so the read gets the library again.
    const created = await host.workflows.create({ title: t("workflow.canvas.untitled") });
    if (!disposed) await load(created.summary.id);
  });
  // A request after the first workflow opened. Before that, the first load reads the request. The
  // list is read again, as a workflow that an agent just made may not be in the library yet.
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

  /**
   * Why the open workflow is read-only, or undefined when this account may change it: it has steps
   * that only a newer app knows, or an agent that this account does not manage. The host checks again.
   */
  const lock = createMemo((): AppTextKey | undefined => {
    const detail = stored()?.detail;
    if (!detail) return undefined;
    if (detail.needsNewerApp) return "workflow.page.needsNewerApp";
    const known = levels();
    return known && graphAgentIds(detail.graph).some((agentId) => known[agentId] !== "manage")
      ? "workflow.page.manageOnly"
      : undefined;
  });
  // The reason shows once each time a workflow opens read-only. The memo stops a read of the same
  // workflow: an effect runs on each change of what its compute function reads.
  const lockToken = createMemo(() => {
    const reason = lock();
    return reason && `${current}\u0000${reason}`;
  });
  createEffect(lockToken, (token) => {
    const reason = untrack(lock);
    if (token && reason) toast.info(t(reason));
  });

  /** Starts a run of the open workflow after the save of its edits. */
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
          // The menus stop loading and show no options. A change on GitHub reads them again.
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
    onRunStep: (nodeId) => {
      // The kind as the host has it: a node that is not saved yet has none.
      const kind = stored()?.detail.graph.nodes.find((node) => node.id === nodeId)?.kind;
      start(
        "run_step",
        (workflowId) => host.workflows.runStep({ workflowId, nodeId, requestId: crypto.randomUUID() }),
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
    // The host makes the address of a trigger that it has, so the secret waits for the save before it.
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
      // The edit that waits saves first, so the version that the restore keeps has it.
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
    onDelete: (workflowId) => {
      flush();
      return queued(async () => {
        const before = await host.workflows.list();
        const index = before.findIndex((summary) => summary.id === workflowId);
        await tracked("delete", () => host.workflows.delete(workflowId));
        if (hostKey !== undefined) cache.get(hostKey)?.workflows.delete(workflowId);
        if (disposed || workflowId !== current) return;
        const rest = before.filter((summary) => summary.id !== workflowId);
        const next = rest[Math.min(Math.max(index, 0), rest.length - 1)];
        const opened = next?.id ?? (await host.workflows.create({ title: t("workflow.canvas.untitled") })).summary.id;
        closePreview();
        await load(opened);
      });
    },
  };

  /** Sends a picture to the host and puts it first in the Library. The toast shows why it failed. */
  const uploadPicture = (file: File) =>
    reported(host.uploadPicture(file)).then((row) => {
      setPictures((list) => [row, ...list.filter((candidate) => candidate.id !== row.id)]);
      return row;
    });

  return {
    detail: () => stored()?.detail,
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
