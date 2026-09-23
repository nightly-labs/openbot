import SharedFilePreviewPanel from "@openbot/ui/features/conversation/FilePreviewPanel";
import type { ComponentProps } from "@solidjs/web";
import { readPanelWidth, savePanelWidth } from "../../components/panel-width-storage";

const PANEL_STORAGE_KEY = "openbot:browser-panel-width";

export default function FilePreviewPanel(
  props: Omit<ComponentProps<typeof SharedFilePreviewPanel>, "readWidth" | "onResizeEnd" | "onResetWidth">,
) {
  return (
    <SharedFilePreviewPanel
      {...props}
      readWidth={(fallback, min, max) => readPanelWidth(PANEL_STORAGE_KEY, fallback, min, max)}
      onResetWidth={() => window.localStorage.removeItem(PANEL_STORAGE_KEY)}
      onResizeEnd={(width) => savePanelWidth(PANEL_STORAGE_KEY, width)}
    />
  );
}
