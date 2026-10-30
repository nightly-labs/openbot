import type { MachineMetric } from "@openbot/contracts/ipc";
import { Button, IconButton, RadialProgress, X } from "@openbot/ui";
import { Show } from "solid-js";
import { useText } from "../../text";

export interface SidebarMachineCardProps {
  serverName: string;
  /** The metric that is furthest above its level. */
  metric: MachineMetric;
  /** Its use and its alert level, in whole percent. */
  percent: number;
  level: number;
  /** What is still free on the disk or in memory. Unused for CPU. */
  freeBytes: number | null;
  /** The owner or admin who gets the alert, when the sidebar knows the name. */
  recipientName: string | null;
  /** Far above the level: the card is red and has no close button. */
  critical: boolean;
  /** Opens Server settings › Storage. */
  onOpenDetails: () => void;
  /** Hides the card until another alert. */
  onDismiss: () => void;
}

/**
 * A machine metric of the selected server passed its alert level, at the bottom of the sidebar. It
 * uses the card of the storage warning: the ring shows the use, and the button opens Server settings
 * › Storage, where the machine part and its alert levels are.
 */
export function SidebarMachineCard(props: SidebarMachineCardProps) {
  const { t, format } = useText();
  const percent = () => format.percent(props.percent / 100);
  const level = () => format.percent(props.level / 100);
  const title = () =>
    props.metric === "disk"
      ? t("sidebar.machine.diskTitle", { level: level() })
      : props.metric === "memory"
        ? t("sidebar.machine.memoryTitle", { level: level() })
        : t("sidebar.machine.cpuTitle", { level: level() });
  const body = () =>
    props.metric !== "cpu" && props.freeBytes !== null
      ? t("sidebar.machine.freeBody", { server: props.serverName, free: format.fileSize(props.freeBytes) })
      : t("sidebar.machine.cpuBody", { server: props.serverName, percent: percent() });
  return (
    <section
      class="sidebar-mobile-app sidebar-storage"
      data-level={props.critical ? "full" : "low"}
      aria-labelledby="sidebar-machine-title"
    >
      <div class="sidebar-storage-row">
        <RadialProgress
          class="sidebar-storage-ring"
          value={props.percent}
          tone={props.critical ? "danger" : "warning"}
          aria-label={t("sidebar.machine.meterLabel", { server: props.serverName })}
          aria-valuetext={t("sidebar.storage.used", { percent: percent() })}
        >
          <span class="sidebar-storage-percent">{percent()}</span>
        </RadialProgress>
        <div class="sidebar-storage-text">
          <strong id="sidebar-machine-title">{title()}</strong>
          <p class="sidebar-mobile-app-body">{body()}</p>
        </div>
        <Show when={!props.critical}>
          <IconButton
            class="sidebar-mobile-app-dismiss"
            size="icon-xs"
            variant="ghost"
            label={t("sidebar.machine.dismiss")}
            data-cuelume-tap="close"
            onClick={() => props.onDismiss()}
          >
            <X aria-hidden="true" />
          </IconButton>
        </Show>
      </div>
      <Show when={props.recipientName}>
        {(name) => <p class="sidebar-mobile-app-body">{t("sidebar.machine.alertTo", { name: name() })}</p>}
      </Show>
      <Button type="button" variant="outline" size="sm" fullWidth onClick={() => props.onOpenDetails()}>
        {props.metric === "disk" ? t("sidebar.storage.freeUpSpace") : t("sidebar.machine.details")}
      </Button>
    </section>
  );
}
