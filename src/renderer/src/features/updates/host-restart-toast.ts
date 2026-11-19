import { toast } from "@openbot/ui";
import { currentText } from "@openbot/ui/text";
import { type Accessor, createEffect, createSignal, onCleanup } from "solid-js";

export interface HostRestartView {
  id: string;
  name: string;
  online: boolean;
  /** What the host said about its restart into an update (`host-update-v1`). */
  restart: "waiting" | "restarting" | null;
  version: string | null;
  /**
   * A server in its first run: it has no agents yet. Its owner sets it up, and the restart of a staged
   * update does not stop any work, so the notice that the restart waits does not show yet.
   */
  firstRun?: boolean;
}

/**
 * `away` is a restart the member saw the connection drop for; only that one ends with "back online".
 * `expired` is a restart whose host did not come back in time; its notice is closed.
 */
type Phase = "waiting" | "restarting" | "away" | "expired";

/** How long the notice of a restart stays. A host that is not back by then is offline, as any other host. */
const RESTART_NOTICE_MS = 10 * 60_000;

const toastId = (id: string) => `host-restart:${id}`;

const [heldServers, setHeldServers] = createSignal<ReadonlySet<string>>(new Set());
const [emptyServers, setEmptyServers] = createSignal<ReadonlySet<string>>(new Set());

/**
 * Records whether this window saw a server with no agents. The record outlives a server switch, which
 * rebuilds the workspace: a server that the owner leaves during its setup, for example with the close
 * button of its provider step, stays in its first run until this window sees its agents.
 */
export function noteServerAgents(serverId: string, empty: boolean): void {
  setEmptyServers((current) => {
    if (current.has(serverId) === empty) return current;
    const next = new Set(current);
    if (empty) next.add(serverId);
    else next.delete(serverId);
    return next;
  });
}

/**
 * Holds the restart notice of a server whose hosted setup shows in this window: the owner sets the
 * server up there, and the server is not open yet, so this window does not know that it has no agents.
 * The returned function releases the hold.
 */
export function holdHostRestartNotice(serverId: string): () => void {
  setHeldServers((current) => new Set(current).add(serverId));
  return () =>
    setHeldServers((current) => {
      const next = new Set(current);
      next.delete(serverId);
      return next;
    });
}

/**
 * Tells a member why a joined host goes away: it restarts into an update. The notice stays while the
 * restart waits and while the host is away, and says when the host is back. A host that drops while
 * its restart only waits is not called restarting: the machine can stop for another reason, and the
 * connection notice reports that drop.
 */
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
      // A view that knows the agents of its server decides; the record of this window fills the others.
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
          // Not recorded, so the notice shows when the first run ends and the restart still waits.
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
          // A removed schedule closes the notice; a restart that ended also says the host is back. A
          // new id, because the infinite duration of the replaced toast would carry over.
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
  // An expired notice stays closed until the host is back or the restart ends.
  if (previous === "expired") return host.online || host.restart === null ? null : "expired";
  if ((previous === "restarting" || previous === "away") && !host.online) return "away";
  return host.restart;
}
