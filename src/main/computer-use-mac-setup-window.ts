import type { ComputerUseMacSetupState, MacPermissionId } from "@openbot/contracts/ipc";
import type { BrowserWindow, NativeImage, WebContents } from "electron";
import type { ComputerUseMacSetupService } from "./computer-use-mac-setup";

export const COMPUTER_USE_PERMISSION_URLS: Record<MacPermissionId, string> = {
  "screen-recording": "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_ScreenCapture",
  accessibility: "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Accessibility",
};

interface ComputerUseMacSetupWindowOptions {
  service: Pick<ComputerUseMacSetupService, "getState" | "requireHelper">;
  createWindow: () => BrowserWindow;
  loadWindow: (window: BrowserWindow, permission: MacPermissionId) => Promise<void>;
  openExternal: (url: string) => Promise<void>;
  revealPath: (path: string) => void;
  loadDragIcon: (path: string) => Promise<NativeImage | string>;
}

export class ComputerUseMacSetupWindowController {
  readonly #options: ComputerUseMacSetupWindowOptions;
  #window: BrowserWindow | null = null;
  #operationGeneration = 0;
  #activeService: ComputerUseMacSetupWindowOptions["service"];

  constructor(options: ComputerUseMacSetupWindowOptions) {
    this.#options = options;
    this.#activeService = options.service;
  }

  get rendererId(): number | null {
    return this.#window && !this.#window.isDestroyed() ? this.#window.webContents.id : null;
  }

  getState(senderId?: number): Promise<ComputerUseMacSetupState> {
    return (senderId === this.rendererId ? this.#activeService : this.#options.service).getState();
  }

  async openHelper(permission: MacPermissionId, path: string, name: string): Promise<ComputerUseMacSetupState> {
    return this.open(permission, {
      requireHelper: async () => ({ path, name }),
      getState: async () => {
        const icon = await this.#options.loadDragIcon(path);
        return {
          status: "available",
          helperName: name,
          helperIconDataUrl: typeof icon === "string" ? null : icon.toDataURL(),
          message: null,
        };
      },
    });
  }

  async open(permission: MacPermissionId, service = this.#options.service): Promise<ComputerUseMacSetupState> {
    const generation = ++this.#operationGeneration;
    const state = await service.getState();
    if (generation !== this.#operationGeneration || state.status !== "available") return state;

    await this.#options.openExternal(COMPUTER_USE_PERMISSION_URLS[permission]);
    if (generation !== this.#operationGeneration) return state;
    this.#activeService = service;
    const window = this.#ensureWindow();
    window.setTitle(`Set up ${state.helperName}`);
    await this.#options.loadWindow(window, permission);
    if (generation === this.#operationGeneration && !window.isDestroyed()) {
      window.show();
      window.focus();
    }
    return state;
  }

  async startDrag(sender: WebContents): Promise<void> {
    if (sender.id !== this.rendererId) throw new Error("Computer Use drag must start from the setup window.");
    const generation = this.#operationGeneration;
    const helper = await this.#activeService.requireHelper();
    const icon = await this.#options.loadDragIcon(helper.path);
    if (generation !== this.#operationGeneration || sender.id !== this.rendererId) return;
    sender.startDrag({ file: helper.path, icon });
  }

  async revealHelper(): Promise<void> {
    const helper = await this.#activeService.requireHelper();
    this.#options.revealPath(helper.path);
  }

  close(): void {
    this.#operationGeneration += 1;
    if (!this.#window || this.#window.isDestroyed()) return;
    this.#window.close();
  }

  #ensureWindow(): BrowserWindow {
    if (this.#window && !this.#window.isDestroyed()) return this.#window;
    const window = this.#options.createWindow();
    this.#window = window;
    window.on("closed", () => {
      if (this.#window === window) this.#window = null;
    });
    return window;
  }
}
