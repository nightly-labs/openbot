// electron-stub.cjs: CommonJS twin of electron-stub.ts for the node_modules shim.
// node_modules/electron/index.js points here while the headless host runs; the
// original file stays as index.js.electron-original next to it (see headless README).

const { homedir } = require("node:os");
const { join } = require("node:path");
const { EventEmitter } = require("node:events");

const appData = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");

class AppStub extends EventEmitter {
  isReady() {
    return true;
  }
  whenReady() {
    return Promise.resolve();
  }
  getName() {
    return "OpenBot";
  }
  setName() {}
  getVersion() {
    return process.env.OPENBOT_HEADLESS_VERSION ?? "0.75.0";
  }
  isPackaged() {
    return true;
  }
  getLocale() {
    return process.env.LC_ALL ?? process.env.LANG ?? "en-US";
  }
  getPath(name) {
    if (name === "userData" || name === "appData" || name === "home") {
      return process.env.OPENBOT_HEADLESS_USER_DATA ?? join(appData, "openbot-headless-test");
    }
    if (name === "temp") return "/tmp";
    return join(appData, "OpenBot");
  }
  setPath() {}
  focus() {}
  quit() {
    process.exit(0);
  }
  exit() {
    process.exit(0);
  }
  requestSingleInstanceLock() {
    return true;
  }
  relaunch() {}
  enableSandbox() {}
  disableHardwareAcceleration() {}
}

const commandLine = {
  getSwitchValue() {
    return "";
  },
  appendSwitch() {},
  hasSwitch() {
    return false;
  },
};

class BrowserWindow {
  constructor() {}
  loadURL() {
    return Promise.resolve();
  }
  loadFile() {
    return Promise.resolve();
  }
  on() {}
  once() {}
  show() {}
  hide() {}
  close() {}
  destroy() {}
  isDestroyed() {
    return true;
  }
  isVisible() {
    return false;
  }
}
BrowserWindow.prototype.webContents = {
  send() {},
  on() {},
  loadURL() {
    return Promise.resolve();
  },
};

class WebContentsView {
  constructor() {}
}
WebContentsView.prototype.webContents = { send() {}, on() {}, loadURL: () => Promise.resolve() };

class BaseWindow {
  constructor() {}
  on() {}
  close() {}
  destroy() {}
  isDestroyed() {
    return true;
  }
}

class Tray {
  constructor() {}
  destroy() {}
  on() {}
}

const ipcMain = { handle() {}, handleOnce() {}, removeHandler() {}, on() {}, once() {}, removeAllListeners() {} };
const ipcRenderer = {
  invoke() {
    return Promise.reject(new Error("no renderer on the headless host"));
  },
  on() {},
  send() {},
};
// "basic_text" mirrors --password-store=basic: the file-key path of the real
// secret-storage-cipher (createKey logs the selected backend; without this the
// first boot logs a TypeError and canPersist() stays false).
const safeStorage = {
  isEncryptionAvailable: () => false,
  getSelectedStorageBackend: () => "basic_text",
};
const desktopCapturer = { getSources: () => Promise.resolve([]) };
const Menu = { buildFromTemplate: () => null, setApplicationMenu() {}, popup() {} };
const Notification = { isSupported: () => false };
const nativeImage = { createFromPath: () => null, createFromBuffer: () => null, createEmpty: () => null };
const net = {
  fetch(input, init) {
    return fetch(input instanceof URL ? input.href : input, { ...init, credentials: "omit", cache: "no-store" });
  },
};
const powerMonitor = {
  getSystemIdleState() {
    return { idle: false };
  },
  on() {},
};
const screen = {
  getPrimaryDisplay() {
    return { bounds: { width: 1280, height: 800 } };
  },
  getAllDisplays() {
    return [];
  },
};
const shell = {
  openExternal() {
    return Promise.resolve();
  },
  openPath() {
    return Promise.resolve("");
  },
  showItemInFolder() {},
};
const systemPreferences = { getMediaAccessStatus: () => "denied" };
const webContents = { fromId: () => null, getAllWebContents: () => [] };
const clipboard = { readText: () => "", writeText() {}, clear() {} };
const contentTracing = { start() {}, stop() {} };
const crashReporter = { start() {}, getUploadsDisabled: () => true };
const session = { defaultSession: { protocol: { registerSchemesAsPrivileged() {}, handle() {} } } };
const protocol = { registerSchemesAsPrivileged() {}, handle() {}, unregisterSchemesAsPrivileged() {} };
const utilityProcess = {
  fork() {
    return { on() {}, kill() {}, send() {} };
  },
};
const nativeTheme = { shouldUseDarkColors: true, on() {} };

module.exports = {
  app: new AppStub(),
  commandLine,
  BrowserWindow,
  WebContentsView,
  BaseWindow,
  Tray,
  ipcMain,
  ipcRenderer,
  safeStorage,
  desktopCapturer,
  Menu,
  Notification,
  nativeImage,
  net,
  powerMonitor,
  screen,
  shell,
  systemPreferences,
  webContents,
  clipboard,
  contentTracing,
  crashReporter,
  session,
  protocol,
  utilityProcess,
  nativeTheme,
};
