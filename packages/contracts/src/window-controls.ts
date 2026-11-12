/**
 * The state of a window whose page draws its own window buttons: minimize, maximize or restore, and
 * close. On Windows the app and chat windows have no system title bar, so the page shows these
 * buttons in its top row (`src/main/window-buttons.ts`).
 */
export interface WindowControlsState {
  /** The maximize button shows Restore. */
  maximized: boolean;
  /** A full-screen window shows no window buttons. */
  fullScreen: boolean;
}
