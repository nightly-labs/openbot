import type { BrowserPreview } from "@openbot/contracts/ipc";
import SharedBrowserPreviewSidebar from "@openbot/ui/features/conversation/BrowserPreviewSidebar";
import type { ComponentProps } from "@solidjs/web";
import { BROWSER_PREVIEW_WIDTH_KEY, readPanelWidth, savePanelWidth } from "../../components/panel-width-storage";
import { conversationPort } from "./conversation-port";

export default function BrowserPreviewSidebar(
  props: Omit<
    ComponentProps<typeof SharedBrowserPreviewSidebar>,
    "capturePreview" | "readWidth" | "readCustomWidth" | "saveWidth" | "resetWidth"
  > & { capturePreview?: ((tabId: string) => Promise<BrowserPreview>) | null | undefined },
) {
  return (
    <SharedBrowserPreviewSidebar
      {...props}
      capturePreview={
        props.capturePreview === null
          ? undefined
          : (props.capturePreview ?? ((id) => conversationPort().browser.capturePreview(id)))
      }
      readWidth={(fallback, min, max) => readPanelWidth(BROWSER_PREVIEW_WIDTH_KEY, fallback, min, max)}
      readCustomWidth={() => Number.parseFloat(window.localStorage.getItem(BROWSER_PREVIEW_WIDTH_KEY) ?? "")}
      saveWidth={(width) => savePanelWidth(BROWSER_PREVIEW_WIDTH_KEY, width)}
      resetWidth={() => window.localStorage.removeItem(BROWSER_PREVIEW_WIDTH_KEY)}
    />
  );
}
