import { toast } from "@openbot/ui";
import { currentText } from "@openbot/ui/text";
import { type Accessor, createEffect, createSignal, onCleanup } from "solid-js";

export interface HostRestartView {
  id: string;
  name: string;
  online: boolean;
  restart: "waiting" | "restarting" | null;
  version: string | null;
  firstRun?: boolean;
}

type Phase = "waiting" | "restarting" | "away" | "expired";

const RESTART_NOTICE_MS = 10 * 60_000;

const toastId = (id: string) => `host-restart:${id}`;

const [heldServers, setHeldServers] = createSignal<ReadonlySet<string>>(new Set());
const [emptyServers, setEmptyServers] = createSignal<ReadonlySet<string>>(new Set());

export function noteServerAgents(serverId: string, empty: boolean): void {
  setEmptyServers((current) => {
    if (current.has(serverId) === empty) return current;
    const next = new Set(current);
    if (empty) next.add(serverId);
    else next.delete(serverId);
    return next;
  });
}

export function holdHostRestartNotice(serverId: string): () => void {
  setHeldServers((current) => new Set(current).add(serverId));
  return () =>
    setHeldServers((current) => {
      const next = new Set(current);
      next.delete(serverId);
      return next;
    });
}

export function createHostRestartToasts(hosts: Accessor<readonly HostRestartView[]>): void {
  const phases = new Map<string, Phase>();
  const expiries = new Map<string, ReturnType<typeof setTimeout>>();
  const stopExpiry = (id: string) => {
    clearTimeout(expiries.get(id));
    expiries.delete(id);
  };
  createEffect(
    () => {
      const held = heldServers();
      const empty = emptyServers();
      return hosts().map((host) => ({
        ...host,
        firstRun: Boolean(host.firstRun) || held.has(host.id) || (host.firstRun === undefined && empty.has(host.id)),
      }));
    },
    (views) => {
      const { t } = currentText();
      const seen = new Set<string>();
      for (const host of views) {
        seen.add(host.id);
        const previous = phases.get(host.id) ?? null;
        const next = nextPhase(previous, host);
        if (next === "waiting" && host.firstRun) {
          if (previous === "waiting") toast.dismiss(toastId(host.id));
          phases.delete(host.id);
          continue;
        }
        if (next === previous) continue;
        if (next === "restarting" || next === "away") {
          if (!expiries.has(host.id))
            expiries.set(
              host.id,
              setTimeout(() => {
                expiries.delete(host.id);
                phases.set(host.id, "expired");
                toast.dismiss(toastId(host.id));
              }, RESTART_NOTICE_MS),
            );
        } else stopExpiry(host.id);
        if (next === null) {
          phases.delete(host.id);
          toast.dismiss(toastId(host.id));
          if (previous === "away")
            toast.success(t("server.restartNotice.backTitle", { name: host.name }), { id: `${toastId(host.id)}:back` });
          continue;
        }
        phases.set(host.id, next);
        if (next === "away" && previous === "restarting") continue;
        if (next === "waiting")
          toast(
            host.version
              ? t("server.restartNotice.waitingVersionTitle", { name: host.name, version: host.version })
              : t("server.restartNotice.waitingTitle", { name: host.name }),
            {
              id: toastId(host.id),
              description: t("server.restartNotice.waitingDescription"),
              duration: Number.POSITIVE_INFINITY,
            },
          );
        else
          toast.loading(t("server.restartNotice.restartingTitle", { name: host.name }), {
            id: toastId(host.id),
            description: t("server.restartNotice.restartingDescription", { name: host.name }),
            duration: Number.POSITIVE_INFINITY,
          });
      }
      for (const id of [...phases.keys()]) {
        if (seen.has(id)) continue;
        phases.delete(id);
        stopExpiry(id);
        toast.dismiss(toastId(id));
      }
    },
  );
  onCleanup(() => {
    for (const id of expiries.keys()) stopExpiry(id);
    for (const id of phases.keys()) toast.dismiss(toastId(id));
  });
}

function nextPhase(previous: Phase | null, host: HostRestartView): Phase | null {
  if (previous === "expired") return host.online || host.restart === null ? null : "expired";
  if ((previous === "restarting" || previous === "away") && !host.online) return "away";
  return host.restart;
}
