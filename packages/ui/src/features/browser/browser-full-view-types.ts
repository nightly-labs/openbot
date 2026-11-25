import type { BrowserControlSession, BrowserTab, BrowserTabAgent, BrowserTabLabel } from "@openbot/contracts/ipc";
import type { AppTranslate } from "@openbot/i18n";
import type { JSX } from "@solidjs/web";
import type { BrowserViewRuntime } from "./BrowserLiveView";
import type { BrowserPageMenu } from "./browser-page-cover";
import type { BrowserHistoryEntry } from "./browser-suggestions";
import type { BrowserShortcutPlatform } from "./browser-view-shortcuts";

export type { BrowserTabLabel } from "@openbot/contracts/ipc";

export interface BrowserTeachBarProps {
  agentName: string;
  startedAt: number | null;
  pending: boolean;
  onStart: () => void;
  onSave: () => void;
  onClose: () => void;
}

export interface BrowserFullViewProps {
  open: boolean;
  pane?: boolean | undefined;
  coveringMenus?: readonly (BrowserPageMenu | undefined)[] | undefined;
  onOpenFullView?: (() => void) | undefined;
  tabs: readonly BrowserTab[];
  activeTab: BrowserTab | undefined;
  history: readonly BrowserHistoryEntry[];
  canReopen: boolean;
  controlForTab: (tab: BrowserTab) => BrowserControlSession | undefined;
  controllerForTab: (tab: BrowserTab) => BrowserTabAgent | undefined;
  ownerForTab: (tab: BrowserTab) => BrowserTabAgent | undefined;
  profileForTab?: ((tab: BrowserTab) => BrowserTabLabel | undefined) | undefined;
  onActivateTab: (tabId: string) => void;
  onCloseTabs: (tabIds: readonly string[]) => void;
  onNewTab: (afterId?: string) => Promise<unknown>;
  onDuplicateTab: (tabId: string) => void;
  onMoveTab: (tabId: string, index: number) => void;
  onReopenTab: () => void;
  onReload: (tabId: string) => void;
  onStop: (tabId: string) => void;
  onNavigate: (tabId: string, direction: "back" | "forward") => void;
  onOpenAddress: (url: string, tabId: string | undefined) => void;
  onSurface: (element: HTMLDivElement | undefined) => void;
  liveViewTabId: string | null;
  liveViewRuntime: BrowserViewRuntime;
  liveViewClipboard: boolean;
  canCloseTabs?: boolean;
  canEnterPip?: boolean;
  canOpenWindow?: boolean;
  detached?: boolean;
  onBack: () => void;
  onEnterPip: () => void;
  onOpenWindow?: (() => void) | undefined;
  onSignInLocally?: ((tabId: string) => void) | undefined;
  macWindowControls?: boolean;
  shortcuts?: BrowserShortcutPlatform | undefined;
  teach?: BrowserTeachBarProps | undefined;
  dock?: JSX.Element;
  dialogs?: JSX.Element;
}

export function browserTabStoppable(tab: BrowserTab | undefined): boolean {
  return tab?.loading === true && tab.canGoBack !== undefined;
}

export function browserTabProfileLabel(t: AppTranslate, profile: BrowserTabLabel): string {
  if (profile.name === null) return t("browser.profiles.agentTabLabel");
  return profile.proxy === undefined
    ? t("browser.profiles.tabLabel", { name: profile.name })
    : t("browser.profiles.tabLabelProxy", { name: profile.name, proxy: profile.proxy });
}
