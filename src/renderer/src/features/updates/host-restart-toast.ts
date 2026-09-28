import { toast } from "@openbot/ui";
import { currentText } from "@openbot/ui/text";
import { type Accessor, createEffect, onCleanup } from "solid-js";

export interface HostRestartView {
  id: string;
  name: string;
  online: boolean;
  /** What the host said about its restart into an update (`host-update-v1`). */
  restart: "waiting" | "restarting" | null;
  version: string | null;
}

/**
 * `away` is a restart the member saw the connection drop for; only that one ends with "back online".
 * `expired` is a restart whose host did not come back in time; its notice is closed.
 */
type Phase = "waiting" | "restarting" | "away" | "expired";

/** How long the notice of a restart stays. A host that is not back by then is offline, as any other host. */
const RESTART_NOTICE_MS = 10 * 60_000;

const toastId = (id: string) => `host-restart:${id}`;

/**
 * Tells a member why a joined host goes away: it restarts into an update. The notice stays while the
 * restart waits and while the host is away, and says when the host is back. A host that drops while
 * a restart waits counts as restarting, because the host's last event can be lost in the teardown.
 */
export function createHostRestartToasts(hosts: Accessor<readonly HostRestartView[]>): void {
  const phases = new Map<string, Phase>();
  const expiries = new Map<string, ReturnType<typeof setTimeout>>();
  const stopExpiry = (id: string) => {
    clearTimeout(expiries.get(id));
    expiries.delete(id);
  };
  createEffect(
    () => hosts().map((host) => ({ ...host })),
    (views) => {
      const { t } = currentText();
      const seen = new Set<string>();
      for (const host of views) {
        seen.add(host.id);
        const previous = phases.get(host.id) ?? null;
        const next = nextPhase(previous, host);
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
  if (previous !== null && !host.online) return "away";
  return host.restart;
}
