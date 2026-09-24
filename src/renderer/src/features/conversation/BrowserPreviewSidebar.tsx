import type { BrowserPreview } from "@openbot/contracts/ipc";
import SharedBrowserPreviewSidebar, {
  BrowserPreviewCard as SharedBrowserPreviewCard,
} from "@openbot/ui/features/conversation/BrowserPreviewSidebar";
import type { ComponentProps } from "@solidjs/web";
import { readPanelWidth, savePanelWidth } from "../../components/panel-width-storage";
import { conversationPort } from "./conversation-port";

const STORAGE_KEY = "openbot:browser-preview-panel-width";

export default function BrowserPreviewSidebar(
  props: Omit<
    ComponentProps<typeof SharedBrowserPreviewSidebar>,
    "capturePreview" | "readWidth" | "readCustomWidth" | "saveWidth" | "resetWidth"
  > & { capturePreview?: ((tabId: string) => Promise<BrowserPreview>) | null },
) {
  return (
    <SharedBrowserPreviewSidebar
      {...props}
      capturePreview={
        props.capturePreview === null
          ? undefined
          : (props.capturePreview ?? ((id) => conversationPort().browser.capturePreview(id)))
      }
      readWidth={(fallback, min, max) => readPanelWidth(STORAGE_KEY, fallback, min, max)}
      readCustomWidth={() => Number.parseFloat(window.localStorage.getItem(STORAGE_KEY) ?? "")}
      saveWidth={(width) => savePanelWidth(STORAGE_KEY, width)}
      resetWidth={() => window.localStorage.removeItem(STORAGE_KEY)}
    />
  );
}

export function BrowserPreviewCard(
  props: Omit<ComponentProps<typeof SharedBrowserPreviewCard>, "capturePreview"> & {
    capturePreview?: ((tabId: string) => Promise<BrowserPreview>) | null;
  },
) {
  return (
    <SharedBrowserPreviewCard
      {...props}
      capturePreview={
        props.capturePreview === null
          ? undefined
          : (props.capturePreview ?? ((id) => conversationPort().browser.capturePreview(id)))
      }
    />
  );
}
