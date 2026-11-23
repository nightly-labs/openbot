/**
 * The few extension APIs that the side panel and the service worker call. Firefox and Safari serve
 * the same calls under `chrome` too, so this file stays the one place that names them.
 */
declare namespace chrome {
  export namespace storage {
    /** What `chrome.storage` keeps: JSON values. A read is checked before use, as any stored data. */
    type StoredValue = string | number | boolean | null | StoredValue[] | { [key: string]: StoredValue };
    interface StorageArea {
      /** `null` reads every item. */
      get(keys: string | string[] | null): Promise<{ [key: string]: StoredValue }>;
      set(items: { [key: string]: StoredValue }): Promise<void>;
      remove(keys: string | string[]): Promise<void>;
    }
    const local: StorageArea;
    interface StorageChange {
      oldValue?: StoredValue;
      newValue?: StoredValue;
    }
    const onChanged: {
      addListener(listener: (changes: { [key: string]: StorageChange }, area: string) => void): void;
      removeListener(listener: (changes: { [key: string]: StorageChange }, area: string) => void): void;
    };
  }
  export namespace sidePanel {
    function setPanelBehavior(behavior: { openPanelOnActionClick: boolean }): Promise<void>;
    /** Opens the panel in a tab or a window. Chrome allows it only during a user's action. */
    function open(options: { tabId: number } | { windowId: number }): Promise<void>;
  }
  export namespace runtime {
    /** This extension's id, the host of its `https://<id>.chromiumapp.org/` sign-in address. */
    const id: string;
    /** The address of a file of this extension. */
    function getURL(path: string): string;
    interface MessageSender {
      /** The tab of a content script. */
      tab?: tabs.Tab;
      /** The page or worker that sent the message. */
      url?: string;
    }
    /**
     * Messages between the worker, the pages and the content scripts of this extension. A message is
     * JSON from another context, and a content script runs beside a page of the web, so the receiver
     * decodes it.
     */
    function sendMessage(message: object): Promise<unknown>;
    type MessageListener = (
      message: unknown,
      sender: MessageSender,
      sendResponse: (response: object) => void,
    ) => boolean | undefined;
    const onMessage: {
      /** Return true to answer later with `sendResponse`. */
      addListener(listener: MessageListener): void;
      removeListener(listener: MessageListener): void;
    };
    /** A long-lived channel between two contexts. Chrome closes it when either context ends. */
    interface Port {
      name: string;
      sender?: MessageSender;
      disconnect(): void;
      onDisconnect: { addListener(listener: (port: Port) => void): void };
    }
    function connect(info: { name: string }): Port;
    const onConnect: { addListener(listener: (port: Port) => void): void };
    /** The browser started with this extension in its profile. */
    const onStartup: { addListener(listener: () => void): void };
    /** The extension was installed, updated, or loaded again from its folder. */
    const onInstalled: { addListener(listener: () => void): void };
  }
  export namespace alarms {
    interface Alarm {
      name: string;
    }
    /** Wakes the worker at `when` (milliseconds since the epoch), also after the worker stopped. */
    function create(name: string, info: { when: number }): Promise<void>;
    function clear(name: string): Promise<boolean>;
    const onAlarm: { addListener(listener: (alarm: Alarm) => void): void };
  }
  export namespace notifications {
    /** A system notification with the extension's icon. */
    function create(
      id: string,
      options: { type: "basic"; iconUrl: string; title: string; message: string },
    ): Promise<string>;
    function clear(id: string): Promise<boolean>;
    const onClicked: { addListener(listener: (id: string) => void): void };
  }
  export namespace windows {
    /** The window of the caller, where an API takes a window id. */
    const WINDOW_ID_CURRENT: number;
  }
  export namespace offscreen {
    /** A hidden page that the worker keeps for work that needs a page, such as a WebRTC connection. */
    function createDocument(details: { url: string; reasons: string[]; justification: string }): Promise<void>;
    function closeDocument(): Promise<void>;
    function hasDocument(): Promise<boolean>;
  }
  export namespace tabs {
    interface Tab {
      id?: number;
      /** `url` and `title` need the `tabs` permission. */
      url?: string;
      title?: string;
      active: boolean;
      windowId: number;
      /** `tabGroups.TAB_GROUP_ID_NONE` when the tab is in no group. */
      groupId: number;
      /** "loading" or "complete". */
      status?: string;
      /** When the tab was last active, in milliseconds since the epoch. */
      lastAccessed?: number;
    }
    /** Opens a tab. Needs no permission. */
    function create(properties: { url: string; windowId?: number; active?: boolean }): Promise<Tab>;
    /** The tab that runs this page, or undefined outside a tab. */
    function getCurrent(): Promise<Tab | undefined>;
    function get(tabId: number): Promise<Tab>;
    function query(filter: { groupId?: number; active?: boolean; lastFocusedWindow?: boolean }): Promise<Tab[]>;
    function update(tabId: number, properties: { url?: string; active?: boolean }): Promise<Tab | undefined>;
    function remove(tabId: number): Promise<void>;
    function goBack(tabId: number): Promise<void>;
    function goForward(tabId: number): Promise<void>;
    function reload(tabId: number): Promise<void>;
    /** Puts tabs into a group; with no `groupId`, into a new group. Resolves with the group id. */
    function group(options: {
      tabIds: number[];
      groupId?: number;
      createProperties?: { windowId: number };
    }): Promise<number>;
    function ungroup(tabIds: number[]): Promise<void>;
    const onUpdated: {
      addListener(
        listener: (
          tabId: number,
          change: { url?: string; title?: string; groupId?: number; status?: string },
          tab: Tab,
        ) => void,
      ): void;
    };
    const onRemoved: { addListener(listener: (tabId: number) => void): void };
    const onActivated: { addListener(listener: (info: { tabId: number; windowId: number }) => void): void };
  }
  /** The tab groups of the browser. The OpenBot group holds the tabs that agents may use. */
  export namespace tabGroups {
    const TAB_GROUP_ID_NONE: number;
    interface TabGroup {
      id: number;
      title?: string;
      windowId: number;
    }
    type Color = "grey" | "blue" | "red" | "yellow" | "green" | "pink" | "purple" | "cyan" | "orange";
    function get(groupId: number): Promise<TabGroup>;
    function query(filter: { title?: string }): Promise<TabGroup[]>;
    function update(groupId: number, properties: { title?: string; color?: Color }): Promise<TabGroup | undefined>;
  }
  /**
   * The Chrome DevTools Protocol on a tab (`chrome.debugger`). Chrome shows its own bar on the tab's
   * window while the extension is attached. `debugger` is a reserved word, so the namespace has another
   * name and is exported as `chrome.debugger`, as `@types/chrome` does.
   */
  namespace _debugger {
    interface Debuggee {
      tabId: number;
    }
    function attach(target: Debuggee, version: string): Promise<void>;
    function detach(target: Debuggee): Promise<void>;
    /** The JSON parameters of a protocol command. */
    type ParamValue = string | number | boolean | null | ParamValue[] | { readonly [key: string]: ParamValue };
    type Params = { readonly [key: string]: ParamValue };
    /** The answer is the protocol's JSON; the caller decodes it. */
    function sendCommand(target: Debuggee, method: string, params?: Params): Promise<unknown>;
    const onDetach: { addListener(listener: (source: { tabId?: number }, reason: string) => void): void };
    const onEvent: {
      addListener(listener: (source: { tabId?: number }, method: string, params?: unknown) => void): void;
    };
  }

  export { _debugger as debugger };
  /** The browser's downloads. The extension holds a download that an agent may have started. */
  export namespace downloads {
    interface DownloadItem {
      id: number;
      url: string;
      finalUrl: string;
      referrer: string;
      filename: string;
    }
    function cancel(downloadId: number): Promise<void>;
    /**
     * Chrome waits for the file name of a new download. A listener that returns true answers later
     * with `suggest`; Chrome holds the download until then.
     */
    const onDeterminingFilename: {
      addListener(listener: (item: DownloadItem, suggest: () => void) => boolean | undefined): void;
    };
  }
  export namespace identity {
    /** Opens `url` in a sign-in window and resolves with the address that ends it, under `chromiumapp.org`. */
    function launchWebAuthFlow(details: {
      url: string;
      interactive: boolean;
      /** False lets a page that answers after its load (a single-page app) finish with no window. */
      abortOnLoadForNonInteractive?: boolean;
      timeoutMsForNonInteractive?: number;
    }): Promise<string | undefined>;
  }
}
