import type { BrowserTab } from "@openbot/contracts/ipc";
import { createRoot, createSignal, flush } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import { testConversationProps } from "../conversation-test-props";
import type { ConversationProps, RightPanelMode } from "../conversation-types";
import { createBrowserStore } from "./browser-store";

const TAB: BrowserTab = {
  id: "tab-1",
  title: "Example",
  url: "https://example.com/",
  loading: false,
  ownerThreadId: null,
  ownerAgentId: "agent-1",
};

function setup(options: { panel: RightPanelMode; suspended?: boolean }) {
  const [tabs, setTabs] = createSignal<BrowserTab[]>([TAB]);
  const [panel, setPanel] = createSignal<RightPanelMode>(options.panel);
  const setActiveRightPanel = vi.fn((mode: RightPanelMode) => setPanel(() => mode));
  const props: ConversationProps = {
    ...testConversationProps("agent-1"),
    get browserTabs() {
      return tabs();
    },
    browserVisibilitySuspended: options.suspended ?? false,
  };
  const dispose = createRoot((dispose) => {
    createBrowserStore({
      props,
      browserOpenRequests: new Map(),
      browserAddress: () => "",
      setBrowserAddress: () => undefined,
      setBrowserAddressEditing: () => undefined,
      setComposerError: () => undefined,
      panels: { activeRightPanel: panel, setActiveRightPanel },
    });
    return dispose;
  });
  flush();
  return { setTabs, setActiveRightPanel, dispose };
}

describe("browser store", () => {
  it("returns an open expanded browser to previews when its last tab closes", () => {
    const { setTabs, setActiveRightPanel, dispose } = setup({ panel: "browser-expanded" });
    setTabs([]);
    flush();
    expect(setActiveRightPanel).toHaveBeenCalledWith("browser");
    dispose();
  });

  it("keeps the panel when the browser is hidden during a server switch", () => {
    const { setTabs, setActiveRightPanel, dispose } = setup({ panel: "browser-expanded", suspended: true });
    setTabs([]);
    flush();
    expect(setActiveRightPanel).not.toHaveBeenCalled();
    dispose();
  });
});
