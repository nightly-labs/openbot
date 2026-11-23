import { Button, IconButton, RadialProgress, X } from "@openbot/ui";
import { Show } from "solid-js";
import { useText } from "../../text";

export type SidebarStorageLevel = "low" | "full";

export interface SidebarStorageCardProps {
  level: SidebarStorageLevel;
  serverName: string;
  freeBytes: number;
  totalBytes: number;
  onFreeUpSpace: () => void;
  onDismiss: () => void;
}

export function SidebarStorageCard(props: SidebarStorageCardProps) {
  const { t, format } = useText();
  const full = () => props.level === "full";
  const usedBytes = () => Math.max(0, props.totalBytes - props.freeBytes);
  const ratio = () => (props.totalBytes > 0 ? usedBytes() / props.totalBytes : 0);
  const percent = () => format.percent(Math.floor(ratio() * 100) / 100);
  const bodyParams = () => ({
    used: format.fileSize(usedBytes()),
    total: format.fileSize(props.totalBytes),
    server: props.serverName,
  });
  return (
    <section
      class="sidebar-mobile-app sidebar-storage"
      data-level={props.level}
      aria-labelledby="sidebar-storage-title"
    >
      <div class="sidebar-storage-row">
        <RadialProgress
          class="sidebar-storage-ring"
          value={Math.floor(ratio() * 100)}
          tone={full() ? "danger" : "warning"}
          aria-label={t("sidebar.storage.meterLabel", { server: props.serverName })}
          aria-valuetext={t("sidebar.storage.used", { percent: percent() })}
        >
          <span class="sidebar-storage-percent">{percent()}</span>
        </RadialProgress>
        <div class="sidebar-storage-text">
          <strong id="sidebar-storage-title">
            {full() ? t("sidebar.storage.fullTitle") : t("sidebar.storage.lowTitle")}
          </strong>
          <p class="sidebar-mobile-app-body">
            {full() ? t("sidebar.storage.fullBody", bodyParams()) : t("sidebar.storage.body", bodyParams())}
          </p>
        </div>
        <Show when={!full()}>
          <IconButton
            class="sidebar-mobile-app-dismiss"
            size="icon-xs"
            variant="ghost"
            label={t("sidebar.storage.dismiss")}
            data-cuelume-tap="close"
            onClick={() => props.onDismiss()}
          >
            <X aria-hidden="true" />
          </IconButton>
        </Show>
      </div>
      <Button type="button" variant="outline" size="sm" fullWidth onClick={() => props.onFreeUpSpace()}>
        {t("sidebar.storage.freeUpSpace")}
      </Button>
    </section>
  );
}
