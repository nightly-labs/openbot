import type { HostUpdateStatus, UpdateRestartMode } from "@openbot/contracts/ipc";
import { toast } from "@openbot/ui";
import {
  type ServerUpdateBusy,
  ServerUpdateDialog,
  type ServerUpdateDownload,
  type ServerUpdateFailure,
  type ServerUpdateStage,
  type ServerUpdateView,
} from "@openbot/ui/features/servers/ServerUpdateDialog";
import { restartReasonKey } from "@openbot/ui/features/updates/restart-reasons";
import { currentText } from "@openbot/ui/text";
import { createEffect, createRoot, createSignal, createStore, onSettled, untrack } from "solid-js";
import type { HostRestartView } from "../updates/host-restart-toast";
import type { HostUpdateCalls } from "./ServerUpdatePanel";

export interface ServerUpdateTarget {
  serverId: string;
  name: string;
  canManage: boolean;
  calls: Pick<HostUpdateCalls, "getUpdateStatus" | "startUpdate" | "cancelUpdate">;
}

interface Flow {
  name: string;
  canManage: boolean;
  status: HostUpdateStatus;
  version: string;
  startedAt: number | null;
  elapsedSeconds: number;
  restarting: boolean;
  wentDown: boolean;
  result: "online" | "failed" | null;
  failure: ServerUpdateFailure | null;
  busy: ServerUpdateBusy | null;
  error: string | null;
}

interface Runtime {
  calls: ServerUpdateTarget["calls"];
  generation: number;
  poll: ReturnType<typeof setTimeout> | undefined;
  clock: ReturnType<typeof setInterval> | undefined;
  limit: ReturnType<typeof setTimeout> | undefined;
  disposeNotice: (() => void) | undefined;
}

const POLL_MS = 1000;
const OFFER_POLL_MS = 15_000;
const RETRY_MS = 5000;
const RESTART_LIMIT_MS = 10 * 60_000;

const [flows, setFlows] = createStore<Record<string, Flow>>({});
const [openId, setOpenId] = createSignal<string | null>(null);
const runtimes = new Map<string, Runtime>();
const [available, setAvailable] = createStore<Record<string, string>>({});
const known = new Map<string, { target: ServerUpdateTarget; status: HostUpdateStatus }>();
let entered: string | null = null;

const noticeId = (serverId: string) => `server-update:${serverId}`;

function offerable(status: HostUpdateStatus): boolean {
  if (status.remoteUpdates !== "allowed" || status.restart || !status.availableVersion) return false;
  return (
    status.phase === "available" ||
    status.phase === "checking" ||
    status.phase === "downloading" ||
    status.phase === "ready" ||
    (status.phase === "error" && status.errorCode === "download_failed")
  );
}

export function followsServerUpdate(serverId: string): boolean {
  return flows[serverId] !== undefined;
}

export function serverUpdateStatus(serverId: string): HostUpdateStatus | null {
  return flows[serverId]?.status ?? null;
}

function updatable(status: HostUpdateStatus): boolean {
  return (
    status.remoteUpdates === "allowed" &&
    status.availableVersion !== null &&
    status.availableVersion !== status.currentVersion &&
    status.phase !== "unsupported" &&
    status.phase !== "up-to-date" &&
    status.errorCode !== "install_failed"
  );
}

function note(target: ServerUpdateTarget, status: HostUpdateStatus): void {
  const id = target.serverId;
  const version = updatable(status) ? status.availableVersion : null;
  if (version) known.set(id, { target, status });
  else known.delete(id);
  if (untrack(() => available[id]) === (version ?? undefined)) return;
  setAvailable((draft) => {
    if (version) draft[id] = version;
    else delete draft[id];
  });
}

async function readStatus(target: ServerUpdateTarget): Promise<HostUpdateStatus | null> {
  try {
    const status = await target.calls.getUpdateStatus(target.serverId);
    note(target, status);
    return status;
  } catch {
    return null;
  }
}

export function serverUpdateBadge(serverId: string): { version: string; running: boolean } | null {
  const flow = flows[serverId];
  if (flow && running(flow)) return { version: flow.version, running: true };
  const version = available[serverId];
  return version ? { version, running: false } : null;
}

export async function checkServerUpdate(target: ServerUpdateTarget): Promise<void> {
  await readStatus(target);
}

export async function offerServerUpdate(target: ServerUpdateTarget | null): Promise<void> {
  entered = target?.serverId ?? null;
  if (!target) return;
  const id = target.serverId;
  if (runtimes.has(id)) return;
  const status = await readStatus(target);
  if (!status || entered !== id || runtimes.has(id) || !offerable(status)) return;
  begin(target, status);
}

export function openServerUpdate(target: ServerUpdateTarget, status: HostUpdateStatus): void {
  note(target, status);
  if (runtimes.has(target.serverId)) {
    show(target.serverId);
    return;
  }
  if (!status.availableVersion) return;
  begin(target, status);
}

export async function showServerUpdate(serverId: string): Promise<void> {
  if (runtimes.has(serverId)) {
    show(serverId);
    return;
  }
  const entry = known.get(serverId);
  if (!entry) return;
  const status = await readStatus(entry.target);
  if (status && updatable(status) && !runtimes.has(serverId)) begin(entry.target, status);
}

function begin(target: ServerUpdateTarget, status: HostUpdateStatus): void {
  const id = target.serverId;
  runtimes.set(id, {
    calls: target.calls,
    generation: 0,
    poll: undefined,
    clock: undefined,
    limit: undefined,
    disposeNotice: undefined,
  });
  const flow: Flow = {
    name: target.name,
    canManage: target.canManage,
    status,
    version: status.availableVersion ?? status.currentVersion,
    startedAt: null,
    elapsedSeconds: 0,
    restarting: false,
    wentDown: false,
    result: null,
    failure: null,
    busy: null,
    error: null,
  };
  setFlows((draft) => {
    draft[id] = { ...flow };
  });
  apply(id, status, flow);
  show(id);
}

function stageOf(flow: Flow): ServerUpdateStage {
  if (flow.result) return flow.result;
  if (flow.wentDown || flow.restarting || flow.status.phase === "installing") return "restarting";
  if (flow.status.restart) return flow.status.phase === "ready" ? "waiting" : "downloading";
  return "offer";
}

function downloadOf(flow: Flow): ServerUpdateDownload {
  const { phase, errorCode, restart } = flow.status;
  if (flow.result === "online" || flow.wentDown || flow.restarting) return "done";
  if (phase === "downloading" || ((phase === "checking" || phase === "available") && restart)) return "running";
  if (phase === "ready" || phase === "installing") return "done";
  return phase === "error" && errorCode === "download_failed" ? "failed" : "pending";
}

function running(flow: Flow): boolean {
  const stage = stageOf(flow);
  return stage === "downloading" || stage === "waiting" || stage === "restarting";
}

function apply(id: string, status: HostUpdateStatus, stored: Flow | undefined = flows[id]): void {
  if (!stored || stored.result) return;
  const runtime = runtimes.get(id);
  if (runtime) note({ serverId: id, name: stored.name, canManage: stored.canManage, calls: runtime.calls }, status);
  const backFromRestart = stored.restarting && restartEnded(status);
  const flow: Flow = {
    ...stored,
    status,
    version: stored.wentDown || backFromRestart ? stored.version : (status.availableVersion ?? stored.version),
  };
  if (flow.wentDown && status.restart && status.phase !== "installing") {
    flow.wentDown = false;
    if (runtime?.limit !== undefined && !flow.restarting) {
      clearTimeout(runtime.limit);
      runtime.limit = undefined;
    }
    setFlows((draft) => {
      const current = draft[id];
      if (current) current.wentDown = false;
    });
  }
  if (flow.wentDown || backFromRestart) {
    setFlows((draft) => {
      const current = draft[id];
      if (current) current.status = status;
    });
    if (status.currentVersion === flow.version) finish(id, "online", null);
    else finish(id, "failed", "version");
    return;
  }
  setFlows((draft) => {
    const current = draft[id];
    if (!current) return;
    current.status = status;
    if (status.availableVersion) current.version = status.availableVersion;
  });
  if (status.errorCode === "install_failed") {
    finish(id, "failed", "install");
    return;
  }
  const started = flow.startedAt !== null;
  if (status.phase === "error" && started) {
    finish(id, "failed", "download");
    return;
  }
  if (!running(flow) && !offerable(status) && status.phase !== "error") {
    end(id);
    return;
  }
  if (running(flow)) startClock(id);
  else stopClock(id);
  schedulePoll(id, flow);
}

function restartEnded(status: HostUpdateStatus): boolean {
  return status.restart === null && status.phase !== "installing" && status.errorCode !== "install_failed";
}

function schedulePoll(id: string, flow: Flow | undefined = flows[id], delay?: number): void {
  const runtime = runtimes.get(id);
  if (!runtime || !flow) return;
  if (runtime.poll !== undefined) clearTimeout(runtime.poll);
  runtime.poll = undefined;
  if (flow.result) return;
  const generation = runtime.generation;
  runtime.poll = setTimeout(
    () => {
      runtime.poll = undefined;
      void read(id, generation);
    },
    delay ??
      (flow.wentDown
        ? RETRY_MS
        : stageOf(flow) === "offer" && downloadOf(flow) !== "running"
          ? OFFER_POLL_MS
          : POLL_MS),
  );
}

async function read(id: string, generation: number): Promise<void> {
  const runtime = runtimes.get(id);
  if (!runtime || runtime.generation !== generation) return;
  try {
    const status = await runtime.calls.getUpdateStatus(id);
    if (runtime.generation === generation) apply(id, status);
  } catch {
    if (runtime.generation === generation) schedulePoll(id, flows[id], RETRY_MS);
  }
}

function startClock(id: string): void {
  const runtime = runtimes.get(id);
  if (!runtime || runtime.clock !== undefined) return;
  const startedAt = Date.now();
  setFlows((draft) => {
    const current = draft[id];
    if (!current) return;
    current.startedAt = startedAt;
    current.elapsedSeconds = 0;
  });
  runtime.clock = setInterval(() => {
    setFlows((draft) => {
      const current = draft[id];
      if (current) current.elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
    });
  }, 1000);
}

function stopClock(id: string): void {
  const runtime = runtimes.get(id);
  if (runtime?.clock !== undefined) clearInterval(runtime.clock);
  if (runtime) runtime.clock = undefined;
  if (flows[id]?.startedAt !== null)
    setFlows((draft) => {
      const current = draft[id];
      if (current) current.startedAt = null;
    });
}

function startRestartLimit(id: string): void {
  const runtime = runtimes.get(id);
  if (!runtime || runtime.limit !== undefined) return;
  runtime.limit = setTimeout(() => {
    runtime.limit = undefined;
    finish(id, "failed", "restart");
  }, RESTART_LIMIT_MS);
}

function stopTimers(runtime: Runtime): void {
  runtime.generation += 1;
  if (runtime.poll !== undefined) clearTimeout(runtime.poll);
  if (runtime.clock !== undefined) clearInterval(runtime.clock);
  if (runtime.limit !== undefined) clearTimeout(runtime.limit);
  runtime.poll = undefined;
  runtime.clock = undefined;
  runtime.limit = undefined;
}

function finish(id: string, result: "online" | "failed", failure: ServerUpdateFailure | null): void {
  const runtime = runtimes.get(id);
  const flow = flows[id];
  if (!runtime || !flow) return;
  stopTimers(runtime);
  setFlows((draft) => {
    const current = draft[id];
    if (!current) return;
    current.result = result;
    current.failure = failure;
    current.busy = null;
    if (result === "online") current.error = null;
  });
  if (openId() === id) return;
  const name = flow.name;
  const version = flow.version;
  const description = failureText({ ...flow, failure });
  end(id);
  setTimeout(() => {
    const { t } = currentText();
    if (result === "online") toast.success(t("server.update.dialog.doneTitle", { name, version }));
    else
      toast.error(t("server.update.dialog.failedTitle", { name }), {
        description,
        report: { operation: "update", source: "system", cause_code: "unknown" },
      });
  }, 0);
}

function failureText(flow: Flow): string | undefined {
  const { t } = currentText();
  switch (flow.failure) {
    case "download":
      return t("server.update.status.downloadFailed", { name: flow.name });
    case "install":
      return t("server.update.status.installFailed", { name: flow.name });
    case "version":
      return t("server.update.dialog.notInstalled", { name: flow.name, current: flow.status.currentVersion });
    case "restart":
      return t("server.update.dialog.restartFailed", { name: flow.name });
    default:
      return undefined;
  }
}

function end(id: string): void {
  const runtime = runtimes.get(id);
  if (runtime) {
    stopTimers(runtime);
    closeNotice(id, runtime);
  }
  runtimes.delete(id);
  if (openId() === id) setOpenId(null);
  setFlows((draft) => {
    delete draft[id];
  });
}

function show(id: string): void {
  const runtime = runtimes.get(id);
  if (runtime) closeNotice(id, runtime);
  setOpenId(id);
}

function closeNotice(id: string, runtime: Runtime): void {
  if (!runtime.disposeNotice) return;
  const dispose = runtime.disposeNotice;
  runtime.disposeNotice = undefined;
  dispose();
  toast.dismiss(noticeId(id));
}

function hide(id: string): void {
  const flow = flows[id];
  if (!flow) return;
  if (!running(flow)) {
    end(id);
    return;
  }
  setOpenId(null);
  const runtime = runtimes.get(id);
  if (!runtime || runtime.disposeNotice) return;
  const parts = createRoot((dispose) => ({ dispose, line: <span>{noticeLine(id)}</span> }));
  runtime.disposeNotice = parts.dispose;
  setTimeout(() => {
    if (runtime.disposeNotice !== parts.dispose) return;
    const { t } = currentText();
    toast(t("server.update.dialog.hiddenTitle", { name: flow.name }), {
      id: noticeId(id),
      description: parts.line,
      duration: Number.POSITIVE_INFINITY,
      action: { label: t("server.update.dialog.show"), onClick: () => show(id) },
      onDismiss: () => {
        if (runtime.disposeNotice === parts.dispose) end(id);
      },
    });
  }, 0);
}

function noticeLine(id: string): string {
  const flow = flows[id];
  if (!flow) return "";
  const { t, format } = currentText();
  switch (stageOf(flow)) {
    case "waiting":
      return flow.status.restart?.waitingFor.length
        ? t("server.update.dialog.restartWaiting", {
            reasons: format.list(flow.status.restart.waitingFor.map((reason) => t(restartReasonKey(reason)))),
          })
        : t("server.update.dialog.restartSoon");
    case "restarting":
      return t("server.update.status.installing", { name: flow.name });
    default:
      return flow.status.progress === null
        ? t("server.update.status.downloadingUnknown", { version: flow.version })
        : t("server.update.status.downloading", {
            version: flow.version,
            progress: format.percent(flow.status.progress / 100),
          });
  }
}

async function act(id: string, busy: ServerUpdateBusy, call: (runtime: Runtime) => Promise<HostUpdateStatus>) {
  const runtime = runtimes.get(id);
  if (!runtime || flows[id]?.busy) return;
  const generation = runtime.generation;
  setFlows((draft) => {
    const current = draft[id];
    if (!current) return;
    current.busy = busy;
    current.error = null;
  });
  try {
    const status = await call(runtime);
    if (runtimes.get(id) !== runtime) return;
    setFlows((draft) => {
      const current = draft[id];
      if (current) current.busy = null;
    });
    if (runtime.generation === generation) apply(id, status);
  } catch (error) {
    if (runtimes.get(id) !== runtime) return;
    const { t, errorMessage } = currentText();
    setFlows((draft) => {
      const current = draft[id];
      if (!current) return;
      current.busy = null;
      if (!current.restarting && !current.wentDown)
        current.error = errorMessage(error, t("server.settings.actionFailed"));
    });
  }
}

function start(id: string, mode: UpdateRestartMode): void {
  const flow = flows[id];
  if (!flow) return;
  if (flow.result)
    setFlows((draft) => {
      const current = draft[id];
      if (!current) return;
      current.result = null;
      current.failure = null;
      current.wentDown = false;
      current.restarting = false;
    });
  void act(id, "start", (runtime) => runtime.calls.startUpdate(mode, id));
}

function follow(hosts: readonly HostRestartView[]): void {
  for (const id of [...runtimes.keys()]) {
    const flow = flows[id];
    if (!flow || flow.result) continue;
    const host = hosts.find((item) => item.id === id);
    if (!host) {
      end(id);
      continue;
    }
    const restarting = flow.restarting || host.restart === "restarting";
    const active = flow.startedAt !== null || flow.status.restart !== null || restarting;
    if (restarting && !flow.restarting) {
      setFlows((draft) => {
        const current = draft[id];
        if (current) current.restarting = true;
      });
      startClock(id);
      startRestartLimit(id);
    }
    if (!host.online && active && !flow.wentDown) {
      setFlows((draft) => {
        const current = draft[id];
        if (current) current.wentDown = true;
      });
      startRestartLimit(id);
      const runtime = runtimes.get(id);
      if (runtime) {
        runtime.generation += 1;
        if (runtime.poll !== undefined) clearTimeout(runtime.poll);
        runtime.poll = undefined;
      }
    } else if (host.online && flow.wentDown) {
      const runtime = runtimes.get(id);
      if (runtime) void read(id, runtime.generation);
    }
  }
}

function viewOf(flow: Flow): ServerUpdateView {
  return {
    name: flow.name,
    currentVersion: flow.status.currentVersion,
    version: flow.version,
    stage: stageOf(flow),
    download: downloadOf(flow),
    progress: flow.status.progress,
    restartMode: flow.status.restart?.mode ?? null,
    waitingFor: flow.status.restart?.waitingFor ?? [],
    failure: flow.failure,
    elapsedSeconds: flow.elapsedSeconds,
  };
}

export function ServerUpdateDialogHost(props: { hosts: readonly HostRestartView[] }) {
  const seenOnline = new Set<string>();
  createEffect(
    () => props.hosts.map((host) => ({ ...host })),
    (hosts) =>
      untrack(() => {
        for (const host of hosts) if (host.online) seenOnline.add(host.id);
        follow(hosts.map((host) => ({ ...host, online: host.online || !seenOnline.has(host.id) })));
      }),
  );
  onSettled(() => {
    for (const id of runtimes.keys()) schedulePoll(id);
    return () => {
      for (const runtime of runtimes.values()) {
        runtime.generation += 1;
        if (runtime.poll !== undefined) clearTimeout(runtime.poll);
        runtime.poll = undefined;
      }
    };
  });
  const current = () => {
    const id = openId();
    const flow = id ? flows[id] : undefined;
    return id && flow ? { id, flow } : null;
  };
  const view = () => {
    const open = current();
    return open ? viewOf(open.flow) : null;
  };
  return (
    <ServerUpdateDialog
      update={view()}
      canManage={current()?.flow.canManage ?? false}
      busy={current()?.flow.busy ?? null}
      error={current()?.flow.error ?? null}
      onStart={(mode) => {
        const id = openId();
        if (id) start(id, mode);
      }}
      onRestartNow={() => {
        const id = openId();
        if (id) void act(id, "now", (runtime) => runtime.calls.startUpdate("now", id));
      }}
      onCancelRestart={() => {
        const id = openId();
        if (id) void act(id, "cancel", (runtime) => runtime.calls.cancelUpdate(id));
      }}
      onHide={() => {
        const id = openId();
        if (id) hide(id);
      }}
      onDone={() => {
        const id = openId();
        if (id) end(id);
      }}
    />
  );
}
