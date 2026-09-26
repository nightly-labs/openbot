// The window that stands beside a System Settings pane while the user grants a permission.

import type { ComputerUsePermissionApp, MacPermissionId } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import type { BrowserWindow, NativeImage } from "electron";
import { applicationBundleName } from "./computer-use-permission-app";

/**
 * The part of a window the controller uses. A real `BrowserWindow` answers all of it, and naming
 * only this much lets a test pass a double without an assertion that hides a type error.
 */
export interface PermissionHelpWindow {
  show(): void;
  close(): void;
  isDestroyed(): boolean;
  on(event: "closed", listener: () => void): unknown;
  /** The drag is refused unless it came from this window, so the controller needs to tell it apart. */
  readonly webContents: { id: number };
}

/**
 * The part of a sender the drag uses. A real `WebContents` answers all of it, and naming only this
 * much keeps the sender check testable without an assertion.
 */
export interface PermissionAppDragSender {
  readonly id: number;
  startDrag(item: { file: string; icon: NativeImage | string }): void;
}

export interface ComputerUsePermissionHelpWindowOptions<W extends PermissionHelpWindow = BrowserWindow> {
  createWindow: () => W;
  loadWindow: (window: W, permission: MacPermissionId, sunshine: boolean) => Promise<void>;
  /** The bundle the user drags into the list, or `null` where there is none to drag. */
  bundlePath: () => string | null;
  bundleIcon: (path: string) => Promise<NativeImage | string>;
  revealPath: (path: string) => void;
}

/**
 * One window, reopened for whichever permission the user asked for.
 *
 * System Settings takes the front when it opens, which leaves the panel that asked for the grant
 * behind it. The steps have to be somewhere the user can still see, so they are here.
 *
 * Every `open` takes a generation. A user who presses one row and then the other while the first
 * load is still running would otherwise end with the window showing the permission they left: the
 * older call finds the generation moved and stops before it shows anything.
 */
export class ComputerUsePermissionHelpWindowController<W extends PermissionHelpWindow = BrowserWindow> {
  readonly #options: ComputerUsePermissionHelpWindowOptions<W>;
  #window: W | null = null;
  #generation = 0;
  #sunshineAppPath: string | null = null;

  constructor(options: ComputerUsePermissionHelpWindowOptions<W>) {
    this.#options = options;
  }

  get open(): boolean {
    return this.#window !== null && !this.#window.isDestroyed();
  }

  async show(permission: MacPermissionId, sunshineAppPath?: string): Promise<void> {
    const generation = ++this.#generation;
    const window = this.#ensureWindow();
    this.#sunshineAppPath = sunshineAppPath ?? null;
    await this.#options.loadWindow(window, permission, sunshineAppPath !== undefined);
    if (generation !== this.#generation || window.isDestroyed()) return;
    // `showInactive` would leave it behind System Settings, which is the one window it has to stand
    // in front of. It carries no input the user has to reach, so taking the front costs them nothing.
    window.show();
  }

  /**
   * What the window draws on the drag card: the name the System Settings list will show, and the
   * icon beside it. The icon is best-effort - a card with no picture still drags.
   */
  async permissionApp(senderId?: number): Promise<ComputerUsePermissionApp | null> {
    const path = this.#bundlePath(senderId);
    if (!path) return null;
    const icon = await this.#options.bundleIcon(path).catch(() => null);
    return {
      name: applicationBundleName(path),
      iconDataUrl: typeof icon === "string" ? icon : (icon?.toDataURL() ?? null),
    };
  }

  /**
   * Hands the bundle to the desktop as a native drag.
   *
   * Every window of the app shares one origin, so the trusted-URL gate cannot tell the help window
   * from the main window: the sender is checked here. A drag started anywhere else would put a file
   * under the pointer of a user who asked for nothing.
   */
  async startDrag(sender: PermissionAppDragSender): Promise<void> {
    if (sender.id !== this.#rendererId) throw new Error("The Computer Use drag must start in the help window.");
    const generation = this.#generation;
    const path = this.#bundlePath(sender.id);
    if (!path) throw new Error(sourceText("error.computerUse.noAppToDrag"));
    const icon = await this.#options.bundleIcon(path);
    if (generation !== this.#generation || sender.id !== this.#rendererId) {
      throw new Error(sourceText("error.computerUse.helpWindowChanged"));
    }
    sender.startDrag({ file: path, icon });
  }

  /** The way past a drag the user cannot make, which is the `+` button in the pane. */
  reveal(senderId?: number): void {
    const path = this.#bundlePath(senderId);
    if (!path) throw new Error(sourceText("error.computerUse.noAppToShow"));
    this.#options.revealPath(path);
  }

  #bundlePath(senderId?: number): string | null {
    return senderId === this.#rendererId && this.#sunshineAppPath ? this.#sunshineAppPath : this.#options.bundlePath();
  }

  get #rendererId(): number | null {
    return this.#window && !this.#window.isDestroyed() ? this.#window.webContents.id : null;
  }

  close(): void {
    // Past every load still running, so none of them shows the window after this.
    this.#generation += 1;
    const window = this.#window;
    this.#window = null;
    this.#sunshineAppPath = null;
    if (window && !window.isDestroyed()) window.close();
  }

  #ensureWindow(): W {
    if (this.#window && !this.#window.isDestroyed()) return this.#window;
    const window = this.#options.createWindow();
    this.#window = window;
    window.on("closed", () => {
      if (this.#window === window) this.#window = null;
    });
    return window;
  }
}
