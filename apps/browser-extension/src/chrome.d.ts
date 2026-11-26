declare namespace chrome {
  export namespace storage {
    type StoredValue = string | number | boolean | null | StoredValue[] | { [key: string]: StoredValue };
    interface StorageArea {
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
    function open(options: { tabId: number } | { windowId: number }): Promise<void>;
  }
  export namespace runtime {
    const id: string;
    function getURL(path: string): string;
    function getManifest(): { version: string };
    interface MessageSender {
      tab?: tabs.Tab;
      url?: string;
      origin?: string;
    }
    function sendMessage(message: object): Promise<unknown>;
    type MessageListener = (
      message: unknown,
      sender: MessageSender,
      sendResponse: (response: object) => void,
    ) => boolean | undefined;
    const onMessage: {
      addListener(listener: MessageListener): void;
      removeListener(listener: MessageListener): void;
    };
    const onMessageExternal: {
      addListener(listener: MessageListener): void;
      removeListener(listener: MessageListener): void;
    };
    interface Port {
      name: string;
      sender?: MessageSender;
      disconnect(): void;
      postMessage(message: string): void;
      onMessage: { addListener(listener: (message: unknown) => void): void };
      onDisconnect: { addListener(listener: (port: Port) => void): void };
    }
    function connect(info: { name: string }): Port;
    const onConnect: { addListener(listener: (port: Port) => void): void };
    const onStartup: { addListener(listener: () => void): void };
    const onInstalled: {
      addListener(listener: (details: { reason: string; previousVersion?: string }) => void): void;
    };
  }
  export namespace alarms {
    interface Alarm {
      name: string;
    }
    function create(name: string, info: { when: number }): Promise<void>;
    function clear(name: string): Promise<boolean>;
    const onAlarm: { addListener(listener: (alarm: Alarm) => void): void };
  }
  export namespace notifications {
    function create(
      id: string,
      options: { type: "basic"; iconUrl: string; title: string; message: string },
    ): Promise<string>;
    function clear(id: string): Promise<boolean>;
    const onClicked: { addListener(listener: (id: string) => void): void };
  }
  export namespace windows {
    const WINDOW_ID_CURRENT: number;
  }
  export namespace offscreen {
    function createDocument(details: { url: string; reasons: string[]; justification: string }): Promise<void>;
    function closeDocument(): Promise<void>;
    function hasDocument(): Promise<boolean>;
  }
  export namespace tabs {
    interface Tab {
      id?: number;
      url?: string;
      title?: string;
      active: boolean;
      windowId: number;
      groupId: number;
      status?: string;
      lastAccessed?: number;
    }
    function create(properties: {
      url: string;
      windowId?: number;
      active?: boolean;
      openerTabId?: number;
    }): Promise<Tab>;
    function getCurrent(): Promise<Tab | undefined>;
    function get(tabId: number): Promise<Tab>;
    function query(filter: {
      groupId?: number;
      active?: boolean;
      lastFocusedWindow?: boolean;
      currentWindow?: boolean;
    }): Promise<Tab[]>;
    function update(tabId: number, properties: { url?: string; active?: boolean }): Promise<Tab | undefined>;
    function remove(tabId: number): Promise<void>;
    function goBack(tabId: number): Promise<void>;
    function goForward(tabId: number): Promise<void>;
    function reload(tabId: number): Promise<void>;
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
    const onRemoved: {
      addListener(listener: (tabId: number) => void): void;
      removeListener(listener: (tabId: number) => void): void;
    };
    const onActivated: { addListener(listener: (info: { tabId: number; windowId: number }) => void): void };
  }
  export namespace tabGroups {
    const TAB_GROUP_ID_NONE: number;
    interface TabGroup {
      id: number;
      title?: string;
      windowId: number;
    }
    type Color = "grey" | "blue" | "red" | "yellow" | "green" | "pink" | "purple" | "cyan" | "orange";
    function get(groupId: number): Promise<TabGroup>;
    function query(filter: { title?: string; windowId?: number }): Promise<TabGroup[]>;
    function update(groupId: number, properties: { title?: string; color?: Color }): Promise<TabGroup | undefined>;
  }
  namespace _debugger {
    interface Debuggee {
      tabId: number;
    }
    function attach(target: Debuggee, version: string): Promise<void>;
    function detach(target: Debuggee): Promise<void>;
    type ParamValue = string | number | boolean | null | ParamValue[] | { readonly [key: string]: ParamValue };
    type Params = { readonly [key: string]: ParamValue };
    function sendCommand(target: Debuggee, method: string, params?: Params): Promise<unknown>;
    const onDetach: { addListener(listener: (source: { tabId?: number }, reason: string) => void): void };
    const onEvent: {
      addListener(listener: (source: { tabId?: number }, method: string, params?: unknown) => void): void;
    };
  }

  export { _debugger as debugger };
  export namespace downloads {
    interface DownloadItem {
      id: number;
      url: string;
      finalUrl: string;
      referrer: string;
      filename: string;
    }
    function cancel(downloadId: number): Promise<void>;
    const onDeterminingFilename: {
      addListener(listener: (item: DownloadItem, suggest: () => void) => boolean | undefined): void;
    };
  }
  export namespace identity {
    function launchWebAuthFlow(details: {
      url: string;
      interactive: boolean;
      abortOnLoadForNonInteractive?: boolean;
      timeoutMsForNonInteractive?: number;
    }): Promise<string | undefined>;
  }
}
