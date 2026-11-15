import type { BrowserPreview } from "@openbot/contracts/ipc";
import SharedBrowserPreviewSidebar from "@openbot/ui/features/conversation/BrowserPreviewSidebar";
import type { ComponentProps } from "@solidjs/web";
import { readSidePanelWidth, resetSidePanelWidth, saveSidePanelWidth } from "../../components/side-panel-width";
import { conversationPort } from "./conversation-port";

export default function BrowserPreviewSidebar(
  props: Omit<
    ComponentProps<typeof SharedBrowserPreviewSidebar>,
    "capturePreview" | "readWidth" | "saveWidth" | "resetWidth"
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
      readWidth={readSidePanelWidth}
      saveWidth={saveSidePanelWidth}
      resetWidth={resetSidePanelWidth}
    />
  );
}
