import SharedFilePreviewPanel from "@openbot/ui/features/conversation/FilePreviewPanel";
import type { ComponentProps } from "@solidjs/web";
import { readPanelWidth, savePanelWidth } from "../../components/panel-width-storage";

const PANEL_STORAGE_KEY = "openbot:browser-panel-width";
const WRAP_LINES_STORAGE_KEY = "openbot:file-preview-wrap-lines";

export default function FilePreviewPanel(
  props: Omit<
    ComponentProps<typeof SharedFilePreviewPanel>,
    "readWidth" | "onResizeEnd" | "onResetWidth" | "readWrapLines" | "onWrapLinesChange"
  >,
) {
  return (
    <SharedFilePreviewPanel
      {...props}
      readWidth={(fallback, min, max) => readPanelWidth(PANEL_STORAGE_KEY, fallback, min, max)}
      onResetWidth={() => window.localStorage.removeItem(PANEL_STORAGE_KEY)}
      onResizeEnd={(width) => savePanelWidth(PANEL_STORAGE_KEY, width)}
      readWrapLines={() => window.localStorage.getItem(WRAP_LINES_STORAGE_KEY) === "true"}
      onWrapLinesChange={(wrap) => window.localStorage.setItem(WRAP_LINES_STORAGE_KEY, String(wrap))}
    />
  );
}
